-- =====================================================================
-- Watch Party — Stage 4a: YouTube videos in rooms
-- =====================================================================
-- Requires Stages 1–3b. Changes no existing rows.
--
-- YouTube videos are shared like catalog movies, using the movie id
-- "yt:<11-character YouTube video ID>". Only IDs are stored, never URLs or
-- HTML; the app builds the official YouTube player from the ID.
--
-- What this migration adds:
--   * Server-side validation of every shared movie id (room playback,
--     queue, rooms.current_movie_id): either a catalog id
--     (lowercase letters, digits, dashes) or "yt:" + a valid YouTube ID.
--     NOT VALID: existing rows are not re-checked.
--   * room_playlist_items.title (optional, 1–200 characters): the YouTube
--     title, stored once by the host so everyone sees the same name.
--   * playlist_add_video(code, movie_id, title): host-only, like
--     playlist_add, plus the title (control characters removed).
--
-- Existing functions (set_playback, playlist_add, …) are unchanged; the
-- new rules apply to them through the constraints.
--
-- Safety: one transaction; pre-flight and post-flight checks; re-runnable.
-- Undo: 20261020120000_stage4a_youtube_videos.rollback.sql
-- =====================================================================

begin;

do $$
declare
  problem text;
begin
  if to_regprocedure('public.auto_transfer_host(text)') is null then
    raise exception 'Pre-flight: run the Stage 1, 2, 3 and 3b migrations first';
  end if;

  select string_agg(p.proname, ', ') into problem
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('playlist_add_video', 'wp_is_valid_movie_id')
    and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'watch-party:%';
  if problem is not null then
    raise exception 'Pre-flight: functions already exist with these names: %', problem;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Movie id rule
-- ---------------------------------------------------------------------
create or replace function public.wp_is_valid_movie_id(p_movie_id text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_movie_id ~ '^(yt:[A-Za-z0-9_-]{11}|[a-z0-9][a-z0-9-]{0,63})$', false)
$$;
comment on function public.wp_is_valid_movie_id(text) is 'watch-party: catalog id or yt:<YouTube video ID>';

do $$
declare
  rule record;
begin
  -- Inline regex (not the function) so constraints never depend on
  -- function permissions of whoever writes the row.
  for rule in
    select * from (values
      ('room_playback', 'room_playback_movie_id_format', 'movie_id'),
      ('room_playlist_items', 'room_playlist_items_movie_id_format', 'movie_id'),
      ('rooms', 'rooms_current_movie_id_format', 'current_movie_id')
    ) as r(tbl, name, col)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = rule.name and conrelid = ('public.' || rule.tbl)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I check (%I ~ %L) not valid',
        rule.tbl, rule.name, rule.col, '^(yt:[A-Za-z0-9_-]{11}|[a-z0-9][a-z0-9-]{0,63})$');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Title for queued videos
-- ---------------------------------------------------------------------
alter table public.room_playlist_items add column if not exists title text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'room_playlist_items_title_length' and conrelid = 'public.room_playlist_items'::regclass
  ) then
    alter table public.room_playlist_items
      add constraint room_playlist_items_title_length
      check (title is null or char_length(title) between 1 and 200) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Host adds a video with its title
-- ---------------------------------------------------------------------
create or replace function public.playlist_add_video(p_code text, p_movie_id text, p_title text)
returns public.room_playlist_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
  clean_title text;
  result public.room_playlist_items;
begin
  target := public.wp_member_room(p_code, true); -- signed in, member, host

  if not public.wp_is_valid_movie_id(p_movie_id) then
    raise exception 'That is not a valid video.' using errcode = '22023';
  end if;

  -- Plain text only: drop control characters, collapse spaces, trim
  clean_title := btrim(regexp_replace(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g'));
  if clean_title = '' then
    clean_title := null;
  elsif char_length(clean_title) > 200 then
    clean_title := left(clean_title, 200);
  end if;

  if (select count(*) from public.room_playlist_items p where p.room_id = target.id) >= 50 then
    raise exception 'The queue is full (50 titles).' using errcode = '54000';
  end if;

  begin
    insert into public.room_playlist_items (room_id, movie_id, position, added_by, added_by_name, title)
    values (
      target.id, p_movie_id,
      coalesce((select max(p.position) from public.room_playlist_items p where p.room_id = target.id), 0) + 1,
      uid,
      (select m.name from public.room_members m where m.room_id = target.id and m.user_id = uid),
      clean_title
    )
    returning * into result;
  exception when unique_violation then
    raise exception 'That video is already in the queue.' using errcode = '23505';
  end;

  return result;
end
$$;
comment on function public.playlist_add_video(text, text, text) is 'watch-party: host-only queue add with title';

revoke execute on function public.playlist_add_video(text, text, text), public.wp_is_valid_movie_id(text) from public, anon, authenticated;
grant execute on function public.playlist_add_video(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Post-flight
-- ---------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.room_playlist_items', 'INSERT')
     or has_table_privilege('authenticated', 'public.room_playlist_items', 'UPDATE') then
    raise exception 'Post-flight: browsers can write the queue directly';
  end if;
  if not public.wp_is_valid_movie_id('yt:dQw4w9WgXcQ') or not public.wp_is_valid_movie_id('movie-1')
     or public.wp_is_valid_movie_id('yt:<script>') or public.wp_is_valid_movie_id('https://evil.example') then
    raise exception 'Post-flight: movie id rule is wrong';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
