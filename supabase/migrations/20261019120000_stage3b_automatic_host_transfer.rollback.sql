-- =====================================================================
-- UNDO for 20261019120000_stage3b_automatic_host_transfer.sql
-- Removes automatic transfer and leases; restores the Stage 1 leave_room.
-- Room and member data is not touched.
-- =====================================================================

begin;

drop function if exists public.auto_transfer_host(text);
drop function if exists public.renew_connection_lease(text);

-- Stage 1 leave_room (hand-off to the longest-present member)
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
revoke execute on function public.leave_room(text) from public, anon;
grant execute on function public.leave_room(text) to authenticated;

drop function if exists public.wp_lease_is_live(text, text);
drop function if exists public.wp_lease_ttl();
drop table if exists public.room_connection_leases;

notify pgrst, 'reload schema';

commit;
