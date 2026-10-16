-- =====================================================================
-- UNDO for 20261018120000_stage3_host_takeover.sql
-- Room and member data is not touched; only heartbeat timestamps (which
-- exist only for this feature) are removed.
-- =====================================================================

begin;

drop function if exists public.claim_host(text);
drop function if exists public.touch_room(text);
drop table if exists public.room_presence_heartbeats;

-- Restore the Stage 1 column rights
revoke update on table public.room_members from public, anon, authenticated;
grant update (name, avatar, color, last_seen_at) on table public.room_members to authenticated;

notify pgrst, 'reload schema';

commit;
