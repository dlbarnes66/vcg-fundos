-- In-app team management and invites.
-- Invite links are created server-side; these functions decide who may join and with what role.

-- Staff list with emails (auth.users is not readable by the app directly).
create or replace function org_members(p_org uuid)
returns table (user_id uuid, email text, role member_role, last_sign_in_at timestamptz, joined_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(member_role_in(p_org) in ('owner','admin'), false) is not true then
    raise exception 'Only an owner or admin can view the team';
  end if;
  return query
    select m.user_id, u.email::text, m.role, u.last_sign_in_at, m.created_at
    from memberships m join auth.users u on u.id = m.user_id
    where m.organization_id = p_org and m.role <> 'investor'
    order by m.created_at;
end $$;
revoke execute on function org_members(uuid) from public, anon;
grant execute on function org_members(uuid) to authenticated;

-- Add (or change) a staff member. Owners may grant any staff role; admins may grant
-- investor_relations or viewer only. The auth user must already exist (the invite creates it).
create or replace function add_staff_member(p_org uuid, p_email text, p_role member_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare me member_role; uid uuid; existing member_role;
begin
  me := member_role_in(p_org);
  if me is null or me not in ('owner','admin') then raise exception 'Only an owner or admin can add team members'; end if;
  if p_role = 'investor' then raise exception 'Use investor portal access for investors'; end if;
  if p_role in ('owner','admin') and me <> 'owner' then raise exception 'Only an owner can add owners or admins'; end if;

  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No user with that email yet'; end if;
  select role into existing from memberships where organization_id = p_org and user_id = uid;
  if existing = 'investor' then raise exception 'That email is an investor login. Use a different email for team access.'; end if;
  if existing = 'owner' and p_role <> 'owner' and me <> 'owner' then raise exception 'Only an owner can change an owner'; end if;

  insert into memberships (organization_id, user_id, role) values (p_org, uid, p_role)
    on conflict (organization_id, user_id) do update set role = excluded.role;
  return uid;
end $$;
revoke execute on function add_staff_member(uuid, text, member_role) from public, anon;
grant execute on function add_staff_member(uuid, text, member_role) to authenticated;

create or replace function set_member_role(p_org uuid, p_user uuid, p_role member_role)
returns void language plpgsql security definer set search_path = public as $$
declare cur member_role;
begin
  if member_role_in(p_org) is distinct from 'owner' then raise exception 'Only an owner can change roles'; end if;
  if p_role = 'investor' then raise exception 'Not a staff role'; end if;
  select role into cur from memberships where organization_id = p_org and user_id = p_user;
  if cur is null or cur = 'investor' then raise exception 'Team member not found'; end if;
  if cur = 'owner' and p_role <> 'owner'
     and (select count(*) from memberships where organization_id = p_org and role = 'owner') = 1 then
    raise exception 'There must always be at least one owner';
  end if;
  update memberships set role = p_role where organization_id = p_org and user_id = p_user;
end $$;
revoke execute on function set_member_role(uuid, uuid, member_role) from public, anon;
grant execute on function set_member_role(uuid, uuid, member_role) to authenticated;

create or replace function remove_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cur member_role;
begin
  if member_role_in(p_org) is distinct from 'owner' then raise exception 'Only an owner can remove people'; end if;
  select role into cur from memberships where organization_id = p_org and user_id = p_user;
  if cur is null then raise exception 'Member not found'; end if;
  if cur = 'owner' and (select count(*) from memberships where organization_id = p_org and role = 'owner') = 1 then
    raise exception 'You cannot remove the last owner';
  end if;
  if cur = 'investor' then
    update investors set portal_user_id = null where organization_id = p_org and portal_user_id = p_user;
  end if;
  delete from memberships where organization_id = p_org and user_id = p_user;
end $$;
revoke execute on function remove_member(uuid, uuid) from public, anon;
grant execute on function remove_member(uuid, uuid) to authenticated;

-- Owner/admin only: does an auth user exist for this email? Used to pick invite vs. login link.
create or replace function user_exists(p_org uuid, p_email text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(member_role_in(p_org) in ('owner','admin'), false) is not true then raise exception 'Not allowed'; end if;
  return exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
end $$;
revoke execute on function user_exists(uuid, text) from public, anon;
grant execute on function user_exists(uuid, text) to authenticated;

-- Email of an investor's portal login (owner/admin only), for re-sending sign-in links.
create or replace function portal_email(p_investor_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare org uuid; uid uuid;
begin
  select organization_id, portal_user_id into org, uid from investors where id = p_investor_id;
  if org is null or coalesce(member_role_in(org) in ('owner','admin'), false) is not true then raise exception 'Not allowed'; end if;
  return (select email from auth.users where id = uid);
end $$;
revoke execute on function portal_email(uuid) from public, anon;
grant execute on function portal_email(uuid) to authenticated;
