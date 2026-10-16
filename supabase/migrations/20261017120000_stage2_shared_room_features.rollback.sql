-- =====================================================================
-- UNDO for 20261017120000_stage2_shared_room_features.sql
-- =====================================================================
-- WARNING: this DELETES all Stage 2 data (chat history, queues, polls,
-- votes, playback state) because it drops the Stage 2 tables.
-- Stage 1 tables (rooms, room_members) and their rows are not touched.
-- =====================================================================

begin;

drop policy if exists "Watch party room channels are closed to anon" on realtime.messages;
drop policy if exists "Watch party room channels are members only" on realtime.messages;
drop policy if exists "Watch party members can join room channels" on realtime.messages;
drop policy if exists "Watch party members can send on room channels" on realtime.messages;

drop function if exists public.vote_poll(text, bigint, integer);
drop function if exists public.close_poll(text, bigint);
drop function if exists public.create_poll(text, text, text[]);
drop function if exists public.playlist_move(text, bigint, integer);
drop function if exists public.playlist_remove(text, bigint);
drop function if exists public.playlist_add(text, text);
drop function if exists public.send_message(text, text);
drop function if exists public.set_playback(text, text, boolean, double precision);
drop function if exists public.server_time();
drop function if exists public.wp_member_room(text, boolean);

drop table if exists public.room_poll_votes;
drop table if exists public.room_polls;
drop table if exists public.room_playlist_items;
drop table if exists public.room_messages;
drop table if exists public.room_playback;

notify pgrst, 'reload schema';

commit;
