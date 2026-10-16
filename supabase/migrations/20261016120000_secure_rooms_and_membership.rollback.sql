-- =====================================================================
-- UNDO for 20261016120000_secure_rooms_and_membership.sql
-- =====================================================================
-- Only run this if the migration must be reverted.
--
-- WARNING: this restores the previous OPEN access ("USING (true)"),
-- which lets anyone with the publishable key read and change all rooms.
--
-- Data is not touched. The unique keys, foreign key and indexes added by
-- the migration are kept, because they only protect existing data.
-- =====================================================================

begin;

-- Remove the new policies.
drop policy if exists "Members can view their rooms" on public.rooms;
drop policy if exists "Members can view fellow members" on public.room_members;
drop policy if exists "Members can update their own profile" on public.room_members;

-- Remove the NOT VALID data rules.
alter table public.rooms drop constraint if exists rooms_host_id_is_auth_user;
alter table public.rooms drop constraint if exists rooms_code_format;
alter table public.rooms drop constraint if exists rooms_name_length;
alter table public.rooms drop constraint if exists rooms_current_movie_id_length;
alter table public.room_members drop constraint if exists room_members_user_id_is_auth_user;
alter table public.room_members drop constraint if exists room_members_name_length;
alter table public.room_members drop constraint if exists room_members_color_hex;
alter table public.room_members drop constraint if exists room_members_avatar_https;

-- Remove the functions.
drop function if exists public.create_room(text, text, boolean, text, text, text);
drop function if exists public.join_room(text, text, text, text);
drop function if exists public.leave_room(text);
drop function if exists public.transfer_host(text, text);
drop function if exists public.set_room_movie(text, text);
drop function if exists public.wp_generate_room_code();
drop function if exists public.wp_my_room_ids();
drop function if exists public.wp_is_auth_user(text);
drop function if exists public.wp_check_profile(text, text, text);

-- Restore open access (the previous behaviour).
grant select, insert, update, delete on table public.rooms, public.room_members to anon, authenticated;

create policy "Legacy open access" on public.rooms
  for all to anon, authenticated using (true) with check (true);
create policy "Legacy open access" on public.room_members
  for all to anon, authenticated using (true) with check (true);

commit;
