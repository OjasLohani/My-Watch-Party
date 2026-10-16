-- =====================================================================
-- Watch Party — Stage 1: secure rooms & membership
-- =====================================================================
-- What this migration does (in plain words):
--   * Keeps every existing row in `rooms` and `room_members`. Nothing is
--     deleted, rewritten or converted. Column types are not changed.
--   * Removes the old "allow everyone" (USING true) RLS policies and
--     replaces them with member-only read access.
--   * Blocks direct INSERT / UPDATE / DELETE from browsers. Rooms are
--     created, joined, left and handed over only through the functions
--     below, which check permissions inside the database.
--   * Identity comes from Supabase Auth (anonymous sign-in). New rows
--     store auth.uid() as text in the existing TEXT columns.
--   * Legacy rows (made-up "usr_..." ids) stay in the table but are not
--     reachable from the app: no signed-in user owns those ids, and no
--     function ever updates them.
--
-- Safety:
--   * The whole file runs in one transaction: it applies completely or
--     not at all.
--   * Pre-flight checks stop the migration with a clear message if the
--     live schema or permissions differ from what it needs.
--   * New CHECK constraints are added NOT VALID: existing rows are not
--     checked, only rows inserted or updated afterwards.
--   * Safe to re-run: every step checks before it changes anything.
--
-- Undo: see 20261016120000_secure_rooms_and_membership.rollback.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pre-flight checks (read-only; abort on anything unexpected)
-- ---------------------------------------------------------------------
do $$
declare
  problem text;
begin
  -- 0a. All columns the app uses must exist.
  select string_agg(req.t || '.' || req.c, ', ') into problem
  from (values
    ('rooms', 'id'), ('rooms', 'code'), ('rooms', 'name'), ('rooms', 'description'),
    ('rooms', 'host_id'), ('rooms', 'current_movie_id'), ('rooms', 'is_private'),
    ('rooms', 'created_at'), ('rooms', 'updated_at'),
    ('room_members', 'id'), ('room_members', 'room_id'), ('room_members', 'user_id'),
    ('room_members', 'name'), ('room_members', 'avatar'), ('room_members', 'color'),
    ('room_members', 'is_host'), ('room_members', 'last_seen_at'), ('room_members', 'created_at')
  ) as req(t, c)
  where not exists (
    select 1 from information_schema.columns ic
    where ic.table_schema = 'public' and ic.table_name = req.t and ic.column_name = req.c
  );
  if problem is not null then
    raise exception 'Pre-flight: missing columns: %', problem;
  end if;

  -- 0b. Identity / code columns must be TEXT (we store auth.uid() as text).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'rooms' and column_name in ('host_id', 'code'))
        or (table_name = 'room_members' and column_name = 'user_id'))
      and data_type <> 'text'
  ) then
    raise exception 'Pre-flight: rooms.host_id, rooms.code and room_members.user_id must be TEXT';
  end if;

  -- 0c. Primary keys must fill themselves in (we never send an id).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('rooms', 'room_members')
      and column_name = 'id' and column_default is null and is_identity = 'NO'
  ) then
    raise exception 'Pre-flight: rooms.id or room_members.id has no default value';
  end if;

  -- 0d. No other required column may be left without a value.
  select string_agg(ic.table_name || '.' || ic.column_name, ', ') into problem
  from information_schema.columns ic
  where ic.table_schema = 'public' and ic.table_name in ('rooms', 'room_members')
    and ic.is_nullable = 'NO' and ic.column_default is null
    and ic.is_identity = 'NO' and ic.is_generated = 'NEVER'
    and ic.column_name not in ('id', 'code', 'name', 'description', 'host_id', 'current_movie_id',
                               'is_private', 'created_at', 'updated_at', 'room_id', 'user_id',
                               'avatar', 'color', 'is_host', 'last_seen_at');
  if problem is not null then
    raise exception 'Pre-flight: unexpected required columns without defaults: %', problem;
  end if;

  -- 0e. Data must already satisfy the unique rules we may add.
  if exists (select 1 from public.room_members group by room_id, user_id having count(*) > 1) then
    raise exception 'Pre-flight: duplicate (room_id, user_id) rows exist in room_members';
  end if;
  if exists (select 1 from public.rooms group by code having count(*) > 1) then
    raise exception 'Pre-flight: duplicate room codes exist in rooms';
  end if;

  -- 0f. The functions run as the role executing this script. That role
  --     must be able to see every row despite RLS, and read auth.users.
  if exists (
    select 1 from pg_class c
    where c.oid in ('public.rooms'::regclass, 'public.room_members'::regclass)
      and not (
        (select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = current_user)
        or (pg_has_role(current_user, c.relowner, 'USAGE') and not c.relforcerowsecurity)
      )
  ) then
    raise exception 'Pre-flight: role % cannot bypass RLS on rooms/room_members', current_user;
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'Pre-flight: auth.uid() not found (is this a Supabase database?)';
  end if;
  if to_regclass('auth.users') is null or not has_table_privilege('auth.users', 'select') then
    raise exception 'Pre-flight: role % cannot read auth.users', current_user;
  end if;

  -- 0g. Do not overwrite functions with our names that someone else wrote.
  select string_agg(p.proname, ', ') into problem
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('create_room', 'join_room', 'leave_room', 'transfer_host', 'set_room_movie',
                      'wp_my_room_ids', 'wp_generate_room_code', 'wp_check_profile',
                      'wp_is_auth_user')
    and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'watch-party:%';
  if problem is not null then
    raise exception 'Pre-flight: functions already exist with these names: %', problem;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Keys, relationships and indexes (only added when missing)
-- ---------------------------------------------------------------------
do $$
begin
  -- 1a. One membership row per user per room (needed for "join again"
  --     via ON CONFLICT). Only a plain, non-partial unique index counts.
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.room_members'::regclass and i.indisunique
      and i.indpred is null and i.indexprs is null
      and (select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = any (i.indkey)) = array['room_id', 'user_id']
  ) then
    alter table public.room_members
      add constraint room_members_room_id_user_id_key unique (room_id, user_id);
  end if;

  -- 1b. Room codes are unique.
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.rooms'::regclass and i.indisunique
      and i.indpred is null and i.indexprs is null
      and (select array_agg(a.attname::text)
           from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = any (i.indkey)) = array['code']
  ) then
    alter table public.rooms add constraint rooms_code_key unique (code);
  end if;

  -- 1c. Members belong to a room; deleting a room removes its members.
  --     NOT VALID: existing rows are not re-checked.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.room_members'::regclass and contype = 'f'
      and confrelid = 'public.rooms'::regclass
  ) and (
    select format_type(a.atttypid, a.atttypmod) from pg_attribute a
    where a.attrelid = 'public.room_members'::regclass and a.attname = 'room_id'
  ) = (
    select format_type(a.atttypid, a.atttypmod) from pg_attribute a
    where a.attrelid = 'public.rooms'::regclass and a.attname = 'id'
  ) then
    alter table public.room_members
      add constraint room_members_room_id_fkey foreign key (room_id)
      references public.rooms (id) on delete cascade not valid;
  end if;
end $$;

create index if not exists room_members_user_id_idx on public.room_members (user_id);
create index if not exists rooms_host_id_idx on public.rooms (host_id);

-- ---------------------------------------------------------------------
-- 2. Data rules for NEW or CHANGED rows (NOT VALID: old rows unchecked)
-- ---------------------------------------------------------------------
-- Note: PostgreSQL checks these on every UPDATE of a row, so a legacy
-- row could not be edited without also fixing it. Nothing in the app or
-- in the functions below ever updates a legacy row (they only touch rows
-- of rooms whose host is a real Supabase user).
do $$
declare
  rule record;
begin
  for rule in
    select * from (values
      ('rooms', 'rooms_host_id_is_auth_user',
         'check (host_id ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'')'),
      ('rooms', 'rooms_code_format',
         'check (code ~ ''^[A-Z]{2,10}-[2-9A-HJKMNP-Z]{6}$'')'),
      ('rooms', 'rooms_name_length',
         'check (char_length(btrim(name)) between 1 and 80)'),
      ('rooms', 'rooms_current_movie_id_length',
         'check (char_length(current_movie_id) between 1 and 64)'),
      ('room_members', 'room_members_user_id_is_auth_user',
         'check (user_id ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'')'),
      ('room_members', 'room_members_name_length',
         'check (char_length(btrim(name)) between 1 and 40)'),
      ('room_members', 'room_members_color_hex',
         'check (color ~ ''^#[0-9A-Fa-f]{6}$'')'),
      ('room_members', 'room_members_avatar_https',
         'check (avatar = '''' or (avatar ~ ''^https://'' and char_length(avatar) <= 500))')
    ) as r(tbl, name, def)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = rule.name and conrelid = ('public.' || rule.tbl)::regclass
    ) then
      execute format('alter table public.%I add constraint %I %s not valid', rule.tbl, rule.name, rule.def);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Row Level Security: replace the open policies
-- ---------------------------------------------------------------------
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

-- Remove EVERY existing policy on these two tables (the old USING (true)
-- ones). Dropping a policy removes a rule, never data. Each removed
-- policy name is printed as a NOTICE so you can see what was replaced.
do $$
declare
  pol record;
begin
  for pol in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('rooms', 'room_members')
  loop
    raise notice 'Dropping policy "%" on %', pol.policyname, pol.tablename;
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- Helper: the room ids the current user is a member of.
-- SECURITY DEFINER lets policies use it without re-triggering the
-- room_members policy (which would otherwise loop forever). It only ever
-- returns the caller's own memberships.
create or replace function public.wp_my_room_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select m.room_id::text
  from public.room_members m
  where m.user_id = (select auth.uid())::text
$$;
comment on function public.wp_my_room_ids() is 'watch-party: room ids the signed-in user belongs to (used by RLS)';

-- rooms: members can read their rooms. No write policies at all.
create policy "Members can view their rooms"
  on public.rooms for select
  to authenticated
  using (id::text in (select public.wp_my_room_ids()));

-- room_members: members can see everyone in rooms they belong to.
create policy "Members can view fellow members"
  on public.room_members for select
  to authenticated
  using (room_id::text in (select public.wp_my_room_ids()));

-- room_members: users may edit only their own row (and, via column
-- grants below, only name / avatar / color / last_seen_at).
create policy "Members can update their own profile"
  on public.room_members for update
  to authenticated
  using (user_id = (select auth.uid())::text)
  with check (user_id = (select auth.uid())::text);

-- ---------------------------------------------------------------------
-- 4. Table privileges for browser roles
-- ---------------------------------------------------------------------
-- public        = every role (default grants) → nothing
-- anon          = not signed in at all        → nothing
-- authenticated = signed in (guests included) → read, plus limited
--                 self-edits. All other writes go through functions.
revoke all on table public.rooms, public.room_members from public, anon, authenticated;
grant select on table public.rooms, public.room_members to authenticated;
grant update (name, avatar, color, last_seen_at) on table public.room_members to authenticated;

-- ---------------------------------------------------------------------
-- 5. Server-side room operations
-- ---------------------------------------------------------------------
-- Public functions are SECURITY DEFINER (they bypass RLS, so each one
-- checks permissions itself), take the caller's identity only from
-- auth.uid() (never from a parameter), and use an empty search_path
-- (blocks hijacking by look-alike objects; every name is qualified).

-- 5a. Internal: is this text the id of an existing Supabase Auth user?
create or replace function public.wp_is_auth_user(p_user_id text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_user_id is null
     or p_user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (select 1 from auth.users u where u.id = p_user_id::uuid);
end
$$;
comment on function public.wp_is_auth_user(text) is 'watch-party: internal auth user existence check';

-- 5b. Internal: validate the profile a user shows in a room.
create or replace function public.wp_check_profile(p_display_name text, p_avatar text, p_color text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 40 then
    raise exception 'Display name must be 1–40 characters.' using errcode = '22023';
  end if;
  if coalesce(p_avatar, '') <> ''
     and (p_avatar !~ '^https://' or char_length(p_avatar) > 500) then
    raise exception 'Avatar must be an https:// image URL.' using errcode = '22023';
  end if;
  if coalesce(p_color, '') !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Color must look like #8B5CF6.' using errcode = '22023';
  end if;
end
$$;
comment on function public.wp_check_profile(text, text, text) is 'watch-party: internal profile validation';

-- 5c. Internal: random, hard-to-guess room code such as FILM-7K3QX9.
--     31 symbols ^ 6 ≈ 887 million codes per prefix. Uses the
--     cryptographically random gen_random_uuid() as its byte source.
create or replace function public.wp_generate_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  prefixes constant text[] := array['FILM', 'CAMPUS', 'CINE', 'INDIE', 'NEON', 'VIBE'];
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  result text;
begin
  -- Bytes 6 and 8 of a UUID carry fixed version/variant bits, so only
  -- the fully random bytes 0 and 10–15 are used.
  result := prefixes[1 + get_byte(bytes, 0) % array_length(prefixes, 1)] || '-';
  for i in 10..15 loop
    result := result || substr(alphabet, 1 + get_byte(bytes, i) % length(alphabet), 1);
  end loop;
  return result;
end
$$;
comment on function public.wp_generate_room_code() is 'watch-party: internal room code generator';

-- 5d. Create a room. The caller always becomes its host.
create or replace function public.create_room(
  p_name text,
  p_movie_id text,
  p_is_private boolean,
  p_display_name text,
  p_avatar text,
  p_color text
)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  new_room public.rooms;
  attempt int := 0;
begin
  if uid is null then
    raise exception 'You must be signed in to create a room.' using errcode = '28000';
  end if;

  p_name := btrim(coalesce(p_name, ''));
  p_display_name := btrim(coalesce(p_display_name, ''));
  if char_length(p_name) not between 1 and 80 then
    raise exception 'Room name must be 1–80 characters.' using errcode = '22023';
  end if;
  if coalesce(p_movie_id, '') = '' or char_length(p_movie_id) > 64 then
    raise exception 'Invalid movie.' using errcode = '22023';
  end if;
  perform public.wp_check_profile(p_display_name, p_avatar, p_color);

  -- Light abuse limit: at most 10 new rooms per user per hour. The
  -- per-user lock stops parallel requests from slipping past the count.
  perform pg_advisory_xact_lock(hashtext('watch-party:create_room:' || uid));
  if (select count(*) from public.rooms r
      where r.host_id = uid and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many rooms created recently. Please wait a while.' using errcode = '54000';
  end if;

  loop
    attempt := attempt + 1;
    begin
      insert into public.rooms
        (code, name, description, host_id, current_movie_id, is_private, created_at, updated_at)
      values
        (public.wp_generate_room_code(), p_name,
         'Synchronized screening hosted by ' || p_display_name || '.',
         uid, p_movie_id, coalesce(p_is_private, false), now(), now())
      returning * into new_room;
      exit;
    exception when unique_violation then
      if attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.room_members
    (room_id, user_id, name, avatar, color, is_host, last_seen_at, created_at)
  values
    (new_room.id, uid, p_display_name, coalesce(p_avatar, ''), p_color, true, now(), now());

  return new_room;
end
$$;
comment on function public.create_room(text, text, boolean, text, text, text) is 'watch-party: create a room; caller becomes host';

-- 5e. Join a room by code. Host status comes from rooms.host_id only.
create or replace function public.join_room(
  p_code text,
  p_display_name text,
  p_avatar text,
  p_color text
)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  clean_code text := upper(btrim(coalesce(p_code, '')));
  target public.rooms;
begin
  if uid is null then
    raise exception 'You must be signed in to join a room.' using errcode = '28000';
  end if;

  p_display_name := btrim(coalesce(p_display_name, ''));
  perform public.wp_check_profile(p_display_name, p_avatar, p_color);

  -- Lock the room row so concurrent joins are counted one at a time
  -- (keeps the member limit exact). NO KEY UPDATE does not block the
  -- foreign-key checks of the member insert below.
  select * into target from public.rooms r where r.code = clean_code for no key update;
  if not found then
    raise exception 'No room found with code "%".', clean_code using errcode = 'P0002';
  end if;

  -- Legacy rooms (host is not a real Supabase user) cannot be joined.
  if not public.wp_is_auth_user(target.host_id) then
    raise exception 'This room was created before secure accounts were added and can no longer be joined.'
      using errcode = 'P0001';
  end if;

  -- Room size limit (requirement is 10+ concurrent viewers).
  if not exists (select 1 from public.room_members m where m.room_id = target.id and m.user_id = uid)
     and (select count(*) from public.room_members m where m.room_id = target.id) >= 50 then
    raise exception 'This room is full.' using errcode = '54000';
  end if;

  insert into public.room_members
    (room_id, user_id, name, avatar, color, is_host, last_seen_at, created_at)
  values
    (target.id, uid, p_display_name, coalesce(p_avatar, ''), p_color, target.host_id = uid, now(), now())
  on conflict (room_id, user_id) do update
    set name = excluded.name,
        avatar = excluded.avatar,
        color = excluded.color,
        is_host = excluded.is_host,
        last_seen_at = now();

  return target;
end
$$;
comment on function public.join_room(text, text, text, text) is 'watch-party: join a room by code';

-- 5f. Leave a room. Removes only the caller. If the host leaves and
--     others remain, the longest-present member becomes host.
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

  if target.host_id = uid then
    select m.user_id into next_host
    from public.room_members m
    where m.room_id = target.id and public.wp_is_auth_user(m.user_id)
    order by m.created_at, m.id
    limit 1;

    if next_host is not null then
      update public.rooms set host_id = next_host, updated_at = now() where id = target.id;
      update public.room_members set is_host = (user_id = next_host) where room_id = target.id;
    end if;
  end if;
end
$$;
comment on function public.leave_room(text) is 'watch-party: leave a room (auto host hand-off)';

-- 5g. Hand host to another member. Only the current host may do this,
--     and only to a member who is a real, existing Supabase user.
create or replace function public.transfer_host(p_code text, p_new_host_id text)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
begin
  if uid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  select * into target from public.rooms r
  where r.code = upper(btrim(coalesce(p_code, '')))
  for no key update;
  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;
  if target.host_id is distinct from uid then
    raise exception 'Only the current host can transfer host controls.' using errcode = '42501';
  end if;
  if p_new_host_id is null or not exists (
    select 1 from public.room_members m where m.room_id = target.id and m.user_id = p_new_host_id
  ) then
    raise exception 'That person is not a member of this room.' using errcode = 'P0002';
  end if;
  if not public.wp_is_auth_user(p_new_host_id) then
    raise exception 'That person''s guest account no longer exists.' using errcode = 'P0002';
  end if;
  if p_new_host_id = uid then
    return target;
  end if;

  update public.rooms set host_id = p_new_host_id, updated_at = now()
  where id = target.id
  returning * into target;
  update public.room_members set is_host = (user_id = p_new_host_id) where room_id = target.id;

  return target;
end
$$;
comment on function public.transfer_host(text, text) is 'watch-party: host-only host transfer';

-- 5h. Change the room's current movie. Host only.
create or replace function public.set_room_movie(p_code text, p_movie_id text)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := (select auth.uid())::text;
  target public.rooms;
begin
  if uid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  if coalesce(p_movie_id, '') = '' or char_length(p_movie_id) > 64 then
    raise exception 'Invalid movie.' using errcode = '22023';
  end if;

  select * into target from public.rooms r
  where r.code = upper(btrim(coalesce(p_code, '')))
  for no key update;
  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;
  if target.host_id is distinct from uid then
    raise exception 'Only the host can change the movie.' using errcode = '42501';
  end if;

  update public.rooms set current_movie_id = p_movie_id, updated_at = now()
  where id = target.id
  returning * into target;

  return target;
end
$$;
comment on function public.set_room_movie(text, text) is 'watch-party: host-only movie change';

-- ---------------------------------------------------------------------
-- 6. Who may call the functions
-- ---------------------------------------------------------------------
-- PostgreSQL (and Supabase's default privileges) let roles call new
-- functions automatically; lock that down explicitly.
revoke execute on function
  public.wp_my_room_ids(),
  public.wp_is_auth_user(text),
  public.wp_check_profile(text, text, text),
  public.wp_generate_room_code(),
  public.create_room(text, text, boolean, text, text, text),
  public.join_room(text, text, text, text),
  public.leave_room(text),
  public.transfer_host(text, text),
  public.set_room_movie(text, text)
from public, anon, authenticated;

-- Browsers (signed-in guests) may call only these. wp_my_room_ids is
-- needed because the RLS policies call it as the signed-in user.
grant execute on function
  public.wp_my_room_ids(),
  public.create_room(text, text, boolean, text, text, text),
  public.join_room(text, text, text, text),
  public.leave_room(text),
  public.transfer_host(text, text),
  public.set_room_movie(text, text)
to authenticated;

-- ---------------------------------------------------------------------
-- 7. Realtime: make sure both tables publish change events
--    (your inspection says they already do; this is a no-op then).
--    Events respect the SELECT policies above.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms') then
      alter publication supabase_realtime add table public.rooms;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_members') then
      alter publication supabase_realtime add table public.room_members;
    end if;
  end if;
end $$;

-- Ask Supabase's API layer to pick up the new functions immediately.
notify pgrst, 'reload schema';

commit;
