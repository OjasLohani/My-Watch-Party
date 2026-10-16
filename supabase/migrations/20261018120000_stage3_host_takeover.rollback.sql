-- =====================================================================
-- UNDO for 20261018120000_stage3_host_takeover.sql
-- Data is not touched.
-- =====================================================================

begin;

drop function if exists public.claim_host(text);
drop function if exists public.touch_room(text);

-- Restore the Stage 1 column right
grant update (last_seen_at) on table public.room_members to authenticated;

notify pgrst, 'reload schema';

commit;
