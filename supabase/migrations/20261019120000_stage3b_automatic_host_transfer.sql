-- =====================================================================
-- Watch Party — Stage 3b: automatic host transfer on disconnect
-- =====================================================================
-- Requires Stage 1, 2 and 3. Changes no existing rows. Earlier migration
-- files are not modified; leave_room is redefined here (same signature).
--
-- How it works (server-authoritative connection leases):
--   * Every member's app calls renew_connection_lease(code) every ~4 s.
--     The SERVER records now() for the caller (identity from auth.uid()).
--   * A member is "connected" while their lease was renewed within the
--     last 12 seconds (wp_lease_ttl()). Only the server clock is used.
--   * Any member may call auto_transfer_host(code) at any time. The
--     server ignores everything the caller believes (Presence, "host is
--     gone" flags, online lists) and transfers ONLY if the host's own
--     lease has expired (or the host has left). It then chooses the
--     successor itself: the longest-present member with a live lease.
--     If the host is still connected the call changes nothing.
--   * Hosts on an older app version never create a lease, so they are
--     never transferred automatically (the Stage 3 claim_host 3-minute
--     rule stays as the fallback for them).
--
-- Limitations (by design, see docs/SECURITY.md):
--   * A lease proves the host's app recently reached the server. A host
--     whose browser is frozen/suspended (phone app switch, Memory Saver)
--     or whose network drops for ~12 s is indistinguishable from a
--     crashed host and loses hosting.
--   * Transfer needs at least one connected member to call
--     auto_transfer_host (the app does this automatically); with nobody
--     connected the room simply waits.
--
-- Concurrency: auto_transfer_host, leave_room, transfer_host and
-- claim_host lock the room row FOR NO KEY UPDATE; renewals take FOR
-- SHARE, so a renewal is committed before a transfer reads the lease or
-- waits until the transfer is done. Several guests calling at the same
-- time are applied one after another: the first transfers, the rest see
-- a connected host and change nothing. Exactly one host_id exists.
--
-- Safety: one transaction; pre-flight and post-flight checks; re-runnable.
-- Undo: 20261019120000_stage3b_automatic_host_transfer.rollback.sql
-- =====================================================================

begin;

do $$
declare
  problem text;
begin
  if to_regprocedure('public.claim_host(text)') is null
     or to_regclass('public.room_presence_heartbeats') is null then
    raise exception 'Pre-flight: run the Stage 1, 2 and 3 migrations first';
  end if;

  select string_agg(p.proname, ', ') into problem
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('renew_connection_lease', 'auto_transfer_host', 'wp_lease_ttl',
                      'wp_lease_is_live', 'leave_room')
    and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'watch-party:%';
  if problem is not null then
    raise exception 'Pre-flight: functions already exist with these names: %', problem;
  end if;

  if to_regclass('public.room_connection_leases') is not null
     and coalesce(obj_description(to_regclass('public.room_connection_leases'), 'pg_class'), '') not like 'watch-party:%' then
    raise exception 'Pre-flight: a table named room_connection_leases already exists';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Lease table (private: not readable/writable by browsers, not in Realtime)
-- ---------------------------------------------------------------------
do $$
declare
  rid text;
begin
  select format_type(a.atttypid, a.atttypmod) into rid
  from pg_attribute a
  where a.attrelid = 'public.rooms'::regclass and a.attname = 'id';

  execute format($sql$
    create table if not exists public.room_connection_leases (
      room_id %1$s not null references public.rooms (id) on delete cascade,
      user_id text not null,
      renewed_at timestamptz not null,
      primary key (room_id, user_id)
    )$sql$, rid);
end $$;

comment on table public.room_connection_leases is 'watch-party: server-stamped connection leases (automatic host transfer)';
alter table public.room_connection_leases enable row level security;
revoke all on table public.room_connection_leases from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public'
               and tablename = 'room_connection_leases') then
    alter publication supabase_realtime drop table public.room_connection_leases;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Lease helpers
-- ---------------------------------------------------------------------
-- How long a lease stays live after its last renewal. The app renews
-- every 4 s (src/lib/hostLease.ts), so 12 s tolerates two lost renewals
-- plus network delay, and a page refresh.
create or replace function public.wp_lease_ttl()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '12 seconds' $$;
comment on function public.wp_lease_ttl() is 'watch-party: connection lease lifetime';

create or replace function public.wp_lease_is_live(p_room_id text, p_user_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.room_connection_leases l
    where l.room_id::text = p_room_id and l.user_id = p_user_id
      and l.renewed_at > now() - public.wp_lease_ttl()
  )
$$;
comment on function public.wp_lease_is_live(text, text) is 'watch-party: internal lease check';

-- ---------------------------------------------------------------------
-- 3. Renew the caller's lease (also counts as a Stage 3 heartbeat)
-- ---------------------------------------------------------------------
create or replace function public.renew_connection_lease(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
begin
  target := public.wp_member_room(p_code, false); -- signed in + member

  -- Serialize with transfers (see header)
  perform 1 from public.rooms r where r.id = target.id for share;

  insert into public.room_connection_leases (room_id, user_id, renewed_at)
  values (target.id, uid, now())
  on conflict (room_id, user_id) do update set renewed_at = excluded.renewed_at;

  -- Keep the Stage 3 activity record current as well (max once per 10 s)
  insert into public.room_presence_heartbeats (room_id, user_id, last_seen_at)
  values (target.id, uid, now())
  on conflict (room_id, user_id) do update
    set last_seen_at = excluded.last_seen_at
    where public.room_presence_heartbeats.last_seen_at < excluded.last_seen_at - interval '10 seconds';
end
$$;
comment on function public.renew_connection_lease(text) is 'watch-party: renew the caller''s connection lease';

-- ---------------------------------------------------------------------
-- 4. Automatic transfer: server decides eligibility and successor
-- ---------------------------------------------------------------------
create or replace function public.auto_transfer_host(p_code text)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
  host_is_member boolean;
  host_has_lease boolean;
  successor text;
begin
  if uid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  select * into target from public.rooms r
  where r.code = upper(btrim(coalesce(p_code, '')))
  for no key update;
  if not found or not exists (
    select 1 from public.room_members m where m.room_id = target.id and m.user_id = uid
  ) then
    raise exception 'You are not a member of this room.' using errcode = '42501';
  end if;

  -- Legacy rooms: never touched
  if target.host_id is null
     or target.host_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return target;
  end if;

  host_is_member := exists (
    select 1 from public.room_members m where m.room_id = target.id and m.user_id = target.host_id
  );

  if host_is_member then
    host_has_lease := exists (
      select 1 from public.room_connection_leases l
      where l.room_id = target.id and l.user_id = target.host_id
    );
    -- Host on an app version without leases: no automatic transfer
    if not host_has_lease then
      return target;
    end if;
    -- Host still connected: nothing to do
    if public.wp_lease_is_live(target.id::text, target.host_id) then
      return target;
    end if;
  end if;

  -- Host disconnected (lease expired) or gone: longest-present member
  -- with a live lease takes over. Deterministic: join time, then id.
  select m.user_id into successor
  from public.room_members m
  join public.room_connection_leases l on l.room_id = m.room_id and l.user_id = m.user_id
  where m.room_id = target.id
    and m.user_id is distinct from target.host_id
    and l.renewed_at > now() - public.wp_lease_ttl()
    and public.wp_is_auth_user(m.user_id)
  order by m.created_at, m.id
  limit 1;

  if successor is null then
    return target; -- nobody connected to hand over to
  end if;

  update public.rooms set host_id = successor, updated_at = now()
  where id = target.id
  returning * into target;
  update public.room_members set is_host = (user_id = successor) where room_id = target.id;

  return target;
end
$$;
comment on function public.auto_transfer_host(text) is 'watch-party: hand host over when the host''s lease expired';

-- ---------------------------------------------------------------------
-- 5. leave_room: hand over to a CONNECTED member first
-- ---------------------------------------------------------------------
-- Same behaviour as Stage 1, except the successor is chosen among
-- members with a live lease before falling back to the longest-present
-- member, and the leaver's lease is removed.
create or replace function public.leave_room(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
  next_host text;
begin
  if uid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  select * into target from public.rooms r
  where r.code = upper(btrim(coalesce(p_code, '')))
  for no key update;
  if not found then
    return;
  end if;

  delete from public.room_members m where m.room_id = target.id and m.user_id = uid;
  delete from public.room_connection_leases l where l.room_id = target.id and l.user_id = uid;

  if target.host_id = uid then
    select m.user_id into next_host
    from public.room_members m
    left join public.room_connection_leases l on l.room_id = m.room_id and l.user_id = m.user_id
    where m.room_id = target.id and public.wp_is_auth_user(m.user_id)
    order by (l.renewed_at > now() - public.wp_lease_ttl()) is true desc, m.created_at, m.id
    limit 1;

    if next_host is not null then
      update public.rooms set host_id = next_host, updated_at = now() where id = target.id;
      update public.room_members set is_host = (user_id = next_host) where room_id = target.id;
    end if;
  end if;
end
$$;
comment on function public.leave_room(text) is 'watch-party: leave a room (hand-off prefers connected members)';

-- ---------------------------------------------------------------------
-- 6. Who may call what
-- ---------------------------------------------------------------------
revoke execute on function
  public.wp_lease_ttl(),
  public.wp_lease_is_live(text, text),
  public.renew_connection_lease(text),
  public.auto_transfer_host(text),
  public.leave_room(text)
from public, anon, authenticated;

grant execute on function
  public.renew_connection_lease(text),
  public.auto_transfer_host(text),
  public.leave_room(text)
to authenticated;

-- ---------------------------------------------------------------------
-- 7. Post-flight
-- ---------------------------------------------------------------------
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.room_connection_leases', 'SELECT')
       or has_table_privilege(r, 'public.room_connection_leases', 'INSERT')
       or has_table_privilege(r, 'public.room_connection_leases', 'UPDATE')
       or has_table_privilege(r, 'public.room_connection_leases', 'DELETE') then
      raise exception 'Post-flight: % can access room_connection_leases directly', r;
    end if;
    if has_column_privilege(r, 'public.rooms', 'host_id', 'UPDATE') then
      raise exception 'Post-flight: % can update rooms.host_id directly', r;
    end if;
    if has_column_privilege(r, 'public.room_members', 'is_host', 'UPDATE') then
      raise exception 'Post-flight: % can update room_members.is_host directly', r;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.auto_transfer_host(text)', 'EXECUTE') then
    raise exception 'Post-flight: anon can call auto_transfer_host';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
