-- =====================================================================
-- Watch Party — Stage 3: recover rooms whose host disappeared
-- =====================================================================
-- Requires Stage 1 and Stage 2. Changes no existing rows or tables.
--
-- Problem: only the host can control playback or hand host over. If the
-- host's laptop sleeps or their connection dies, nobody can ever
-- control the room again.
--
-- What this migration adds:
--   * touch_room(code): members call it every ~30 s; the SERVER records
--     last_seen_at = now() for the caller's membership.
--   * claim_host(code): a member may take over as host only if the
--     current host has not been seen for 3 minutes (or is gone).
--   * Removes the direct UPDATE right on room_members.last_seen_at
--     (granted in Stage 1), so nobody can fake "still online" by writing
--     a future timestamp. Name / avatar / colour stay editable.
--
-- Safety: one transaction; pre-flight checks; safe to re-run.
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
end $$;

-- Members' "still here" signal, stamped with the server clock.
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
  target := public.wp_member_room(p_code, false);
  update public.room_members m
  set last_seen_at = now()
  where m.room_id = target.id and m.user_id = uid;
end
$$;
comment on function public.touch_room(text) is 'watch-party: member heartbeat (server time)';

-- Take over as host when the current host is gone or silent for 3 min.
create or replace function public.claim_host(p_code text)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
  host_seen timestamptz;
begin
  if uid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  -- Lock the room so a claim cannot race a transfer or another claim
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

  select m.last_seen_at into host_seen
  from public.room_members m
  where m.room_id = target.id and m.user_id = target.host_id;

  if found and host_seen > now() - interval '3 minutes' then
    raise exception 'The host is still connected. Ask them to transfer host instead.' using errcode = '42501';
  end if;

  update public.rooms set host_id = uid, updated_at = now()
  where id = target.id
  returning * into target;
  update public.room_members set is_host = (user_id = uid) where room_id = target.id;

  return target;
end
$$;
comment on function public.claim_host(text) is 'watch-party: take over from an absent host';

revoke execute on function public.touch_room(text), public.claim_host(text) from public, anon;
grant execute on function public.touch_room(text), public.claim_host(text) to authenticated;

-- last_seen_at is now written only by the server (touch_room).
revoke update (last_seen_at) on table public.room_members from authenticated;

notify pgrst, 'reload schema';

commit;
