-- Two-factor enforcement, notification recipients, and demo-data cleanup.

-- ───────────── Two-factor (MFA) ─────────────
alter table organizations add column if not exists require_staff_mfa boolean not null default false;

-- True unless the org requires MFA and this session hasn't completed it (Supabase sets aal2 after a TOTP check).
create or replace function mfa_ok(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((select require_staff_mfa from organizations where id = org), false)
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Money and approvals need MFA when the org requires it.
create or replace function can_post_capital(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(member_role_in(org) in ('owner','admin'), false) and mfa_ok(org)
$$;

drop policy if exists wire_owner_write on fund_wire_instructions;
create policy wire_owner_write on fund_wire_instructions for all
  using (member_role_in(organization_id) = 'owner' and mfa_ok(organization_id))
  with check (member_role_in(organization_id) = 'owner' and mfa_ok(organization_id));

-- Owner toggles the requirement. Turning it on requires the owner's own session to be aal2 (no lock-outs).
create or replace function set_require_staff_mfa(p_org uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if member_role_in(p_org) is distinct from 'owner' then raise exception 'Only an owner can change this'; end if;
  if p_on and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Set up two-factor on your own account and sign in with it first, so you are not locked out.';
  end if;
  update organizations set require_staff_mfa = p_on where id = p_org;
end $$;
revoke execute on function set_require_staff_mfa(uuid, boolean) from public, anon;
grant execute on function set_require_staff_mfa(uuid, boolean) to authenticated;

-- ───────────── Notifications ─────────────
-- Owner/admin emails to notify about a subscription. Callable by that subscription's investor or by staff.
create or replace function subscription_notify_emails(p_sub uuid) returns setof text
language plpgsql stable security definer set search_path = public as $$
declare s subscriptions;
begin
  select * into s from subscriptions where id = p_sub;
  if s.id is null or not (s.investor_id in (select my_investor_ids()) or is_staff(s.organization_id)) then
    raise exception 'Not allowed';
  end if;
  return query
    select u.email::text from memberships m join auth.users u on u.id = m.user_id
     where m.organization_id = s.organization_id and m.role in ('owner','admin') and u.email is not null;
end $$;
revoke execute on function subscription_notify_emails(uuid) from public, anon;
grant execute on function subscription_notify_emails(uuid) to authenticated;

-- Staff can look up an investor's portal email to notify them (any staff writer, not just owner/admin).
create or replace function portal_email(p_investor_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare org uuid; uid uuid;
begin
  select organization_id, portal_user_id into org, uid from investors where id = p_investor_id;
  if org is null or coalesce(can_write(org), false) is not true then raise exception 'Not allowed'; end if;
  return (select email from auth.users where id = uid);
end $$;

-- ───────────── Demo data cleanup ─────────────
-- Removes the synthetic sample investors (emails ending @example.com) and everything attached to them.
-- Owner only, and the caller must type the confirmation phrase.
create or replace function purge_demo_data(p_org uuid, p_confirm text) returns int
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; n int;
begin
  if member_role_in(p_org) is distinct from 'owner' or not mfa_ok(p_org) then raise exception 'Only an owner can do this'; end if;
  if p_confirm is distinct from 'DELETE DEMO DATA' then raise exception 'Type DELETE DEMO DATA to confirm'; end if;
  select array_agg(id) into ids from investors where organization_id = p_org and email ilike '%@example.com';
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then return 0; end if;

  -- capital_transactions is append-only; allow these deletes only inside this function.
  alter table capital_transactions disable trigger capital_txn_no_update;
  delete from capital_transactions where investor_id = any(ids) and reverses_id is not null;
  delete from capital_transactions where investor_id = any(ids);
  alter table capital_transactions enable trigger capital_txn_no_update;

  delete from subscriptions where investor_id = any(ids);
  delete from commitments where investor_id = any(ids);
  delete from documents where investor_id = any(ids);
  delete from memberships m using investors i
   where i.id = any(ids) and m.organization_id = p_org and m.user_id = i.portal_user_id and m.role = 'investor';
  delete from investors where id = any(ids);

  insert into audit_events (organization_id, actor_id, action, target_table, detail)
  values (p_org, auth.uid(), 'purge_demo', 'investors', jsonb_build_object('investors_removed', n));
  return n;
end $$;
revoke execute on function purge_demo_data(uuid, text) from public, anon;
grant execute on function purge_demo_data(uuid, text) to authenticated;
