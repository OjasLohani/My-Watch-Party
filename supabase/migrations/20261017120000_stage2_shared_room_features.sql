-- =====================================================================
-- Watch Party — Stage 2: synchronized playback, chat, queue, polls,
-- and private Realtime channels
-- =====================================================================
-- Requires the Stage 1 migration (20261016120000_secure_rooms_and_membership).
--
-- What this migration does (in plain words):
--   * Adds five NEW tables. Existing tables and rows are not changed.
--       room_playback        one row per room: what is playing and where
--       room_messages        chat history
--       room_playlist_items  the shared screening queue
--       room_polls           polls (one active poll per room)
--       room_poll_votes      one vote per person per poll
--   * Members of a room can READ its rows. Nobody can write directly:
--     every change goes through a function below that checks the
--     caller is a member (or the host, for host-only actions).
--   * Realtime: only members of a room may join its private channel
--     "room:<room id>" (used for reactions and online presence), and
--     database change events respect the read rules above.
--
-- Safety: one transaction; pre-flight checks; safe to re-run.
-- Undo: 20261017120000_stage2_shared_room_features.rollback.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pre-flight checks
-- ---------------------------------------------------------------------
do $$
declare
  problem text;
begin
  if to_regprocedure('public.wp_my_room_ids()') is null
     or to_regprocedure('public.join_room(text,text,text,text)') is null then
    raise exception 'Pre-flight: run the Stage 1 migration first';
  end if;

  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise exception 'Pre-flight: realtime.messages / realtime.topic() not found (Supabase Realtime Authorization)';
  end if;

  -- Do not take over tables or functions with our names that we did not create.
  select string_agg(c.relname, ', ') into problem
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('room_playback', 'room_messages', 'room_playlist_items', 'room_polls', 'room_poll_votes')
    and coalesce(obj_description(c.oid, 'pg_class'), '') not like 'watch-party:%';
  if problem is not null then
    raise exception 'Pre-flight: tables already exist with these names: %', problem;
  end if;

  select string_agg(p.proname, ', ') into problem
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('server_time', 'set_playback', 'send_message', 'playlist_add', 'playlist_remove',
                      'playlist_move', 'create_poll', 'close_poll', 'vote_poll', 'wp_member_room')
    and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'watch-party:%';
  if problem is not null then
    raise exception 'Pre-flight: functions already exist with these names: %', problem;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Tables (room_id uses the same type as rooms.id, whatever it is)
-- ---------------------------------------------------------------------
do $$
declare
  rid text;
begin
  select format_type(a.atttypid, a.atttypmod) into rid
  from pg_attribute a
  where a.attrelid = 'public.rooms'::regclass and a.attname = 'id';

  execute format($sql$
    create table if not exists public.room_playback (
      room_id %1$s primary key references public.rooms (id) on delete cascade,
      movie_id text not null check (char_length(movie_id) between 1 and 64),
      is_playing boolean not null default false,
      position_sec double precision not null default 0
        check (position_sec >= 0 and position_sec <= 86400),
      playback_rate real not null default 1 check (playback_rate > 0 and playback_rate <= 4),
      version bigint not null default 1,
      updated_at_ms double precision not null,
      updated_by text not null
    )$sql$, rid);

  execute format($sql$
    create table if not exists public.room_messages (
      id bigint generated always as identity primary key,
      room_id %1$s not null references public.rooms (id) on delete cascade,
      user_id text not null,
      user_name text not null,
      user_avatar text not null default '',
      user_color text not null default '#94A3B8',
      body text not null check (char_length(body) between 1 and 500),
      created_at timestamptz not null default now()
    )$sql$, rid);

  execute format($sql$
    create table if not exists public.room_playlist_items (
      id bigint generated always as identity primary key,
      room_id %1$s not null references public.rooms (id) on delete cascade,
      movie_id text not null check (char_length(movie_id) between 1 and 64),
      position integer not null,
      added_by text not null,
      added_by_name text not null,
      created_at timestamptz not null default now(),
      unique (room_id, movie_id)
    )$sql$, rid);

  execute format($sql$
    create table if not exists public.room_polls (
      id bigint generated always as identity primary key,
      room_id %1$s not null references public.rooms (id) on delete cascade,
      question text not null check (char_length(question) between 1 and 200),
      options text[] not null check (array_length(options, 1) between 2 and 6),
      is_active boolean not null default true,
      created_by text not null,
      created_at timestamptz not null default now()
    )$sql$, rid);

  execute format($sql$
    create table if not exists public.room_poll_votes (
      poll_id bigint not null references public.room_polls (id) on delete cascade,
      room_id %1$s not null references public.rooms (id) on delete cascade,
      user_id text not null,
      option_index integer not null check (option_index >= 0),
      created_at timestamptz not null default now(),
      primary key (poll_id, user_id)
    )$sql$, rid);
end $$;

comment on table public.room_playback is 'watch-party: shared playback state per room';
comment on table public.room_messages is 'watch-party: room chat history';
comment on table public.room_playlist_items is 'watch-party: shared screening queue';
comment on table public.room_polls is 'watch-party: room polls';
comment on table public.room_poll_votes is 'watch-party: one vote per user per poll';

create index if not exists room_messages_room_id_id_idx on public.room_messages (room_id, id desc);
create index if not exists room_messages_rate_idx on public.room_messages (room_id, user_id, created_at);
create index if not exists room_playlist_items_room_position_idx on public.room_playlist_items (room_id, position);
create index if not exists room_polls_room_id_idx on public.room_polls (room_id);
create unique index if not exists room_polls_one_active_per_room on public.room_polls (room_id) where is_active;
create index if not exists room_poll_votes_room_id_idx on public.room_poll_votes (room_id);

-- ---------------------------------------------------------------------
-- 2. Row Level Security: members read; nobody writes directly
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['room_playback', 'room_messages', 'room_playlist_items', 'room_polls', 'room_poll_votes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Members can view" on public.%I', t);
    execute format(
      'create policy "Members can view" on public.%I for select to authenticated '
      'using (room_id::text in (select public.wp_my_room_ids()))', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Functions
-- ---------------------------------------------------------------------
-- Same rules as Stage 1: SECURITY DEFINER with checks inside, caller
-- identity only from auth.uid(), empty search_path, qualified names.

-- 3a. Internal: the room for a code, if the caller is a member (and,
--     when p_host_only, its host). Host actions lock the room row so
--     they cannot race a host transfer.
create or replace function public.wp_member_room(p_code text, p_host_only boolean)
returns public.rooms
language plpgsql
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
begin
  if uid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  if p_host_only then
    select * into target from public.rooms r
    where r.code = upper(btrim(coalesce(p_code, ''))) for no key update;
  else
    select * into target from public.rooms r
    where r.code = upper(btrim(coalesce(p_code, '')));
  end if;

  if not found or not exists (
    select 1 from public.room_members m where m.room_id = target.id and m.user_id = uid
  ) then
    raise exception 'You are not a member of this room.' using errcode = '42501';
  end if;
  if p_host_only and target.host_id is distinct from uid then
    raise exception 'Only the host can do that.' using errcode = '42501';
  end if;
  return target;
end
$$;
comment on function public.wp_member_room(text, boolean) is 'watch-party: internal membership / host check';

-- 3b. Server clock in epoch milliseconds (clients estimate their offset).
create or replace function public.server_time()
returns double precision
language sql
volatile
set search_path = ''
as $$
  select extract(epoch from clock_timestamp()) * 1000
$$;
comment on function public.server_time() is 'watch-party: server clock (epoch ms) for playback sync';

-- 3c. Host sets the shared playback state. The server stamps the time
--     and bumps the version, so every viewer computes the same timeline.
create or replace function public.set_playback(
  p_code text,
  p_movie_id text,
  p_is_playing boolean,
  p_position double precision
)
returns public.room_playback
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
  result public.room_playback;
begin
  target := public.wp_member_room(p_code, true);

  if coalesce(p_movie_id, '') = '' or char_length(p_movie_id) > 64 then
    raise exception 'Invalid movie.' using errcode = '22023';
  end if;
  -- Rejects NULL, negative, NaN (NaN sorts above every number) and > 24 h.
  if p_position is null or not (p_position >= 0 and p_position <= 86400) then
    raise exception 'Invalid playback position.' using errcode = '22023';
  end if;

  insert into public.room_playback
    (room_id, movie_id, is_playing, position_sec, version, updated_at_ms, updated_by)
  values
    (target.id, p_movie_id, coalesce(p_is_playing, false), p_position, 1,
     extract(epoch from clock_timestamp()) * 1000, uid)
  on conflict (room_id) do update
    set movie_id = excluded.movie_id,
        is_playing = excluded.is_playing,
        position_sec = excluded.position_sec,
        version = public.room_playback.version + 1,
        updated_at_ms = excluded.updated_at_ms,
        updated_by = excluded.updated_by
  returning * into result;

  if target.current_movie_id is distinct from p_movie_id then
    update public.rooms set current_movie_id = p_movie_id, updated_at = now() where id = target.id;
  end if;

  return result;
end
$$;
comment on function public.set_playback(text, text, boolean, double precision) is 'watch-party: host-only playback control';

-- 3d. Send a chat message. Name / avatar / colour come from the
--     sender's membership row, so nobody can post as someone else.
create or replace function public.send_message(p_code text, p_body text)
returns public.room_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
  sender public.room_members;
  result public.room_messages;
begin
  target := public.wp_member_room(p_code, false);

  p_body := btrim(coalesce(p_body, ''));
  if char_length(p_body) not between 1 and 500 then
    raise exception 'Messages must be 1–500 characters.' using errcode = '22023';
  end if;

  if (select count(*) from public.room_messages m
      where m.room_id = target.id and m.user_id = uid
        and m.created_at > now() - interval '10 seconds') >= 10 then
    raise exception 'You are sending messages too quickly.' using errcode = '54000';
  end if;

  select * into sender from public.room_members m where m.room_id = target.id and m.user_id = uid;

  insert into public.room_messages (room_id, user_id, user_name, user_avatar, user_color, body)
  values (target.id, uid, sender.name, coalesce(sender.avatar, ''), coalesce(sender.color, '#94A3B8'), p_body)
  returning * into result;

  return result;
end
$$;
comment on function public.send_message(text, text) is 'watch-party: member-only chat';

-- 3e. Queue: host adds, removes and reorders.
create or replace function public.playlist_add(p_code text, p_movie_id text)
returns public.room_playlist_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
  result public.room_playlist_items;
begin
  target := public.wp_member_room(p_code, true);

  if coalesce(p_movie_id, '') = '' or char_length(p_movie_id) > 64 then
    raise exception 'Invalid movie.' using errcode = '22023';
  end if;
  if (select count(*) from public.room_playlist_items p where p.room_id = target.id) >= 50 then
    raise exception 'The queue is full (50 titles).' using errcode = '54000';
  end if;

  begin
    insert into public.room_playlist_items (room_id, movie_id, position, added_by, added_by_name)
    values (
      target.id, p_movie_id,
      coalesce((select max(p.position) from public.room_playlist_items p where p.room_id = target.id), 0) + 1,
      uid,
      (select m.name from public.room_members m where m.room_id = target.id and m.user_id = uid)
    )
    returning * into result;
  exception when unique_violation then
    raise exception 'That movie is already in the queue.' using errcode = '23505';
  end;

  return result;
end
$$;
comment on function public.playlist_add(text, text) is 'watch-party: host-only queue add';

create or replace function public.playlist_remove(p_code text, p_item_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms;
begin
  target := public.wp_member_room(p_code, true);
  delete from public.room_playlist_items p where p.id = p_item_id and p.room_id = target.id;
  if not found then
    raise exception 'Queue item not found.' using errcode = 'P0002';
  end if;
end
$$;
comment on function public.playlist_remove(text, bigint) is 'watch-party: host-only queue remove';

create or replace function public.playlist_move(p_code text, p_item_id bigint, p_direction integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms;
  item public.room_playlist_items;
  neighbour public.room_playlist_items;
begin
  target := public.wp_member_room(p_code, true);
  if p_direction is null or p_direction not in (-1, 1) then
    raise exception 'Direction must be -1 (up) or 1 (down).' using errcode = '22023';
  end if;

  select * into item from public.room_playlist_items p
  where p.id = p_item_id and p.room_id = target.id;
  if not found then
    raise exception 'Queue item not found.' using errcode = 'P0002';
  end if;

  if p_direction < 0 then
    select * into neighbour from public.room_playlist_items p
    where p.room_id = target.id and p.position < item.position
    order by p.position desc limit 1;
  else
    select * into neighbour from public.room_playlist_items p
    where p.room_id = target.id and p.position > item.position
    order by p.position asc limit 1;
  end if;
  if not found then
    return; -- already first / last
  end if;

  update public.room_playlist_items set position = neighbour.position where id = item.id;
  update public.room_playlist_items set position = item.position where id = neighbour.id;
end
$$;
comment on function public.playlist_move(text, bigint, integer) is 'watch-party: host-only queue reorder';

-- 3f. Polls: host creates and closes; members vote once.
create or replace function public.create_poll(p_code text, p_question text, p_options text[])
returns public.room_polls
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
  clean_options text[];
  result public.room_polls;
begin
  target := public.wp_member_room(p_code, true);

  p_question := btrim(coalesce(p_question, ''));
  if char_length(p_question) not between 1 and 200 then
    raise exception 'The question must be 1–200 characters.' using errcode = '22023';
  end if;

  select array_agg(btrim(o) order by ord) into clean_options
  from unnest(coalesce(p_options, '{}'::text[])) with ordinality as t(o, ord)
  where btrim(coalesce(o, '')) <> '';
  if coalesce(array_length(clean_options, 1), 0) not between 2 and 6 then
    raise exception 'A poll needs 2–6 options.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(clean_options) o where char_length(o) > 80) then
    raise exception 'Options must be at most 80 characters.' using errcode = '22023';
  end if;

  -- One active poll per room: close the previous one.
  update public.room_polls set is_active = false where room_id = target.id and is_active;

  insert into public.room_polls (room_id, question, options, created_by)
  values (target.id, p_question, clean_options, uid)
  returning * into result;
  return result;
end
$$;
comment on function public.create_poll(text, text, text[]) is 'watch-party: host-only poll creation';

create or replace function public.close_poll(p_code text, p_poll_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.rooms;
begin
  target := public.wp_member_room(p_code, true);
  update public.room_polls set is_active = false where id = p_poll_id and room_id = target.id;
end
$$;
comment on function public.close_poll(text, bigint) is 'watch-party: host-only poll close';

create or replace function public.vote_poll(p_code text, p_poll_id bigint, p_option integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
  poll public.room_polls;
begin
  target := public.wp_member_room(p_code, false);

  select * into poll from public.room_polls p
  where p.id = p_poll_id and p.room_id = target.id and p.is_active;
  if not found then
    raise exception 'This poll is closed or does not exist.' using errcode = 'P0002';
  end if;
  if p_option is null or p_option < 0 or p_option >= array_length(poll.options, 1) then
    raise exception 'Invalid option.' using errcode = '22023';
  end if;

  begin
    insert into public.room_poll_votes (poll_id, room_id, user_id, option_index)
    values (poll.id, target.id, uid, p_option);
  exception when unique_violation then
    raise exception 'You have already voted in this poll.' using errcode = '23505';
  end;
end
$$;
comment on function public.vote_poll(text, bigint, integer) is 'watch-party: member vote (once per poll)';

-- ---------------------------------------------------------------------
-- 4. Who may call the functions
-- ---------------------------------------------------------------------
revoke execute on function
  public.wp_member_room(text, boolean),
  public.server_time(),
  public.set_playback(text, text, boolean, double precision),
  public.send_message(text, text),
  public.playlist_add(text, text),
  public.playlist_remove(text, bigint),
  public.playlist_move(text, bigint, integer),
  public.create_poll(text, text, text[]),
  public.close_poll(text, bigint),
  public.vote_poll(text, bigint, integer)
from public, anon, authenticated;

grant execute on function
  public.server_time(),
  public.set_playback(text, text, boolean, double precision),
  public.send_message(text, text),
  public.playlist_add(text, text),
  public.playlist_remove(text, bigint),
  public.playlist_move(text, bigint, integer),
  public.create_poll(text, text, text[]),
  public.close_poll(text, bigint),
  public.vote_poll(text, bigint, integer)
to authenticated;

-- ---------------------------------------------------------------------
-- 5. Realtime Authorization for private channels "room:<room id>"
-- ---------------------------------------------------------------------
-- Only members of the room may join (receive) or send broadcast /
-- presence messages on its channel. Other existing realtime policies
-- are left untouched.
drop policy if exists "Watch party members can join room channels" on realtime.messages;
create policy "Watch party members can join room channels"
  on realtime.messages for select
  to authenticated
  using (
    split_part((select realtime.topic()), ':', 1) = 'room'
    and split_part((select realtime.topic()), ':', 2) in (select public.wp_my_room_ids())
  );

drop policy if exists "Watch party members can send on room channels" on realtime.messages;
create policy "Watch party members can send on room channels"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and split_part((select realtime.topic()), ':', 1) = 'room'
    and split_part((select realtime.topic()), ':', 2) in (select public.wp_my_room_ids())
  );

-- ---------------------------------------------------------------------
-- 6. Publish change events for the new tables
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['room_playback', 'room_messages', 'room_playlist_items', 'room_polls', 'room_poll_votes']
    loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
