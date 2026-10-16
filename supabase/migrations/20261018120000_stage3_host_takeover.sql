-- =====================================================================
-- Watch Party — Stage 3: recover rooms whose host disappeared
-- =====================================================================
-- Requires Stage 1 and Stage 2. Changes no existing rows.
--
-- Problem: only the host can control playback or hand host over. If the
-- host's laptop sleeps or their connection dies, nobody can ever
-- control the room again.
--
-- What this migration adds:
--   * room_presence_heartbeats: one row per member per room holding the
--     server time of their last heartbeat. It is NOT published to
--     Realtime (so heartbeats do not trigger member-list reloads) and
--     browsers cannot read or write it.
--   * touch_room(code): members call it every ~30 s; the server records
--     now() for the CALLER only (identity from auth.uid()).
--   * claim_host(code): a member may take over as host only if the
--     current host has shown no activity for 3 minutes, or has left.
--   * Browsers can no longer write room_members.last_seen_at directly
--     (Stage 1 allowed it), so nobody can fake "still online".
--     Name / avatar / colour stay editable.
--
-- What a heartbeat proves: that the host's signed-in app was open and
-- able to reach the server. It does NOT prove they are watching or that
-- their video is playing.
--
-- Host activity = the most recent of:
--   their heartbeat, their room_members.last_seen_at, when they joined,
--   the room's updated_at (set when someone becomes host — create,
--   transfer, automatic hand-off, claim — and on host movie changes),
--   their last playback command, their last chat message.
-- So a new host, a host who just received the role, or a host using an
-- app version without heartbeats but still controlling playback or
-- chatting, is protected for 3 minutes after that activity.
--
-- Takeover rules:
--   * host still a member, activity within 3 min  -> refused
--   * host still a member, older activity          -> allowed
--   * host still a member, NO activity recorded    -> allowed (only possible
--     for rows not created by these functions, which always set times)
--   * host no longer a member (left / account deleted) -> allowed
--   * legacy room (host id is not a Supabase user id)  -> refused
--
-- Concurrency: claim_host, transfer_host, leave_room and set_playback
-- lock the room row (FOR NO KEY UPDATE), so they run one after another.
-- touch_room takes a FOR SHARE lock on the room row, which conflicts
-- with those: a heartbeat is either committed before a claim reads the
-- host's activity, or waits until the claim has finished.
--
-- Safety: one transaction; pre-flight and post-flight checks; safe to
-- re-run (also over the earlier version of this migration).
-- Undo: 20261018120000_stage3_host_takeover.rollback.sql
-- =====================================================================

begin;

do $$
declare
  problem text;
begin
  if to_regprocedure('public.wp_member_room(text,boolean)') is null then
    raise exception 'Pre-flight: run the Stage 1 and Stage 2 migrations first';
  end if;

  select string_agg(p.proname, ', ') into problem
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('touch_room', 'claim_host')
    and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'watch-party:%';
  if problem is not null then
    raise exception 'Pre-flight: functions already exist with these names: %', problem;
  end if;

  if to_regclass('public.room_presence_heartbeats') is not null
     and coalesce(obj_description(to_regclass('public.room_presence_heartbeats'), 'pg_class'), '') not like 'watch-party:%' then
    raise exception 'Pre-flight: a table named room_presence_heartbeats already exists';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Heartbeat table (room_id uses the same type as rooms.id)
-- ---------------------------------------------------------------------
do $$
declare
  rid text;
begin
  select format_type(a.atttypid, a.atttypmod) into rid
  from pg_attribute a
  where a.attrelid = 'public.rooms'::regclass and a.attname = 'id';

  execute format($sql$
    create table if not exists public.room_presence_heartbeats (
      room_id %1$s not null references public.rooms (id) on delete cascade,
      user_id text not null,
      last_seen_at timestamptz not null,
      primary key (room_id, user_id)
    )$sql$, rid);
end $$;

comment on table public.room_presence_heartbeats is 'watch-party: server-stamped member heartbeats (not published to Realtime)';

-- Only the functions below use it: RLS on, no policies, no browser rights.
alter table public.room_presence_heartbeats enable row level security;
revoke all on table public.room_presence_heartbeats from public, anon, authenticated;

-- Make sure it is not part of Realtime (would broadcast every heartbeat)
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public'
               and tablename = 'room_presence_heartbeats') then
    alter publication supabase_realtime drop table public.room_presence_heartbeats;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Heartbeat: the caller's own row, server time
-- ---------------------------------------------------------------------
create or replace function public.touch_room(p_code text)
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

  -- Serialize with claim_host / transfer_host / leave_room (see header)
  perform 1 from public.rooms r where r.id = target.id for share;

  insert into public.room_presence_heartbeats (room_id, user_id, last_seen_at)
  values (target.id, uid, now())
  on conflict (room_id, user_id) do update
    set last_seen_at = excluded.last_seen_at
    -- at most one write per 10 s per member, however often it is called
    where public.room_presence_heartbeats.last_seen_at < excluded.last_seen_at - interval '10 seconds';
end
$$;
comment on function public.touch_room(text) is 'watch-party: member heartbeat (server time, caller only)';

-- ---------------------------------------------------------------------
-- 3. Take over from an absent host
-- ---------------------------------------------------------------------
create or replace function public.claim_host(p_code text)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
  host_is_member boolean;
  host_active_at timestamptz;
begin
  if uid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  -- Lock the room: claims, transfers, leaves and heartbeats run one at a time
  select * into target from public.rooms r
  where r.code = upper(btrim(coalesce(p_code, '')))
  for no key update;
  if not found or not exists (
    select 1 from public.room_members m where m.room_id = target.id and m.user_id = uid
  ) then
    raise exception 'You are not a member of this room.' using errcode = '42501';
  end if;

  if target.host_id = uid then
    return target;
  end if;

  if target.host_id is null
     or target.host_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'This room was created before secure accounts were added and cannot be taken over.'
      using errcode = 'P0001';
  end if;

  host_is_member := exists (
    select 1 from public.room_members m where m.room_id = target.id and m.user_id = target.host_id
  );

  if host_is_member then
    -- greatest() ignores NULLs; NULL only if no activity is recorded at all
    host_active_at := greatest(
      (select h.last_seen_at from public.room_presence_heartbeats h
        where h.room_id = target.id and h.user_id = target.host_id),
      (select m.last_seen_at::timestamptz from public.room_members m
        where m.room_id = target.id and m.user_id = target.host_id),
      (select m.created_at::timestamptz from public.room_members m
        where m.room_id = target.id and m.user_id = target.host_id),
      target.updated_at::timestamptz,
      (select to_timestamp(p.updated_at_ms / 1000.0) from public.room_playback p
        where p.room_id = target.id and p.updated_by = target.host_id),
      (select max(c.created_at) from public.room_messages c
        where c.room_id = target.id and c.user_id = target.host_id)
    );

    if host_active_at is not null and host_active_at > now() - interval '3 minutes' then
      raise exception 'The host is still connected. Ask them to transfer host instead.' using errcode = '42501';
    end if;
  end if;

  update public.rooms set host_id = uid, updated_at = now()
  where id = target.id
  returning * into target;
  update public.room_members set is_host = (user_id = uid) where room_id = target.id;

  return target;
end
$$;
comment on function public.claim_host(text) is 'watch-party: take over from an absent host';

-- ---------------------------------------------------------------------
-- 4. Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.touch_room(text), public.claim_host(text) from public, anon;
grant execute on function public.touch_room(text), public.claim_host(text) to authenticated;

-- last_seen_at is no longer writable from browsers. Revoking the
-- TABLE-level UPDATE right also removes every column-level UPDATE grant
-- (PostgreSQL rule), so this covers a table-wide grant someone may have
-- added by hand as well as Stage 1's column grant. Then re-grant only
-- the profile columns.
revoke update on table public.room_members from public, anon, authenticated;
grant update (name, avatar, color) on table public.room_members to authenticated;

-- ---------------------------------------------------------------------
-- 5. Post-flight: verify the result (abort and undo everything if not)
-- ---------------------------------------------------------------------
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.room_members', 'UPDATE') then
      raise exception 'Post-flight: % still has table-wide UPDATE on room_members', r;
    end if;
    if has_column_privilege(r, 'public.room_members', 'last_seen_at', 'UPDATE') then
      raise exception 'Post-flight: % can still update room_members.last_seen_at', r;
    end if;
    if has_column_privilege(r, 'public.room_members', 'is_host', 'UPDATE') then
      raise exception 'Post-flight: % can update room_members.is_host', r;
    end if;
    if has_table_privilege(r, 'public.room_presence_heartbeats', 'SELECT')
       or has_table_privilege(r, 'public.room_presence_heartbeats', 'INSERT')
       or has_table_privilege(r, 'public.room_presence_heartbeats', 'UPDATE') then
      raise exception 'Post-flight: % can access room_presence_heartbeats directly', r;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.room_members', 'name', 'UPDATE') then
    raise exception 'Post-flight: members can no longer edit their name';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
