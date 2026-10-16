-- =====================================================================
-- UNDO for 20261020120000_stage4a_youtube_videos.sql
-- WARNING: removes the stored titles of queued YouTube videos (the
-- videos stay in the queue and keep playing; titles are looked up again).
-- =====================================================================

begin;

drop function if exists public.playlist_add_video(text, text, text);
alter table public.room_playback drop constraint if exists room_playback_movie_id_format;
alter table public.room_playlist_items drop constraint if exists room_playlist_items_movie_id_format;
alter table public.rooms drop constraint if exists rooms_current_movie_id_format;
alter table public.room_playlist_items drop constraint if exists room_playlist_items_title_length;
alter table public.room_playlist_items drop column if exists title;
drop function if exists public.wp_is_valid_movie_id(text);

notify pgrst, 'reload schema';

commit;
