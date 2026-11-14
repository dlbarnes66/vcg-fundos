-- 1) Deleting sample or test investors now also clears capital-call allocations and the
--    compliance reminders their (fake) commitments created. Adds a one-at-a-time delete.
-- 2) "Future raise" list: investors who can't join the current 506(c) raise (not accredited,
--    couldn't verify) are kept as contacts for a later 506(b) raise, with the facts counsel
--    needs for Rule 152(a)(1): how you first met, and when and how a substantive
--    relationship was established.

-- ───────────── Future raise (506(b)) contacts ─────────────
alter table investors
  add column if not exists held_at                     timestamptz,
  add column if not exists held_reason                 text check (held_reason in ('not_accredited', 'could_not_verify', 'not_now', 'other')),
  add column if not exists first_contact_public        boolean,   -- first heard of VCG through public advertising (website, social, webinar, ads)
  add column if not exists relationship_established_on date,      -- when you first evaluated their finances and sophistication
  add column if not exists relationship_basis          text;      -- how (meeting, call, referral from someone who knows them…)
create index if not exists investors_held on investors (organization_id) where held_at is not null;

-- ───────────── Removing investors (internal) ─────────────
-- Not callable directly; used by purge_demo_data and delete_investor_record.
create or replace function remove_investors(p_org uuid, ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int := coalesce(array_length(ids, 1), 0); funds_hit uuid[];
begin
  if n = 0 then return 0; end if;
  select array_agg(distinct fund_id) into funds_hit from commitments where investor_id = any(ids);

  -- capital_transactions is append-only; allow these deletes only inside this function.
  alter table capital_transactions disable trigger capital_txn_no_update;
  delete from capital_transactions where investor_id = any(ids) and reverses_id is not null;
  delete from capital_transactions where investor_id = any(ids);
  alter table capital_transactions enable trigger capital_txn_no_update;

  -- Capital calls: drop their allocations; a call left with nobody in it goes, others shrink to match.
  delete from capital_call_allocations where investor_id = any(ids);
  delete from capital_calls c where c.organization_id = p_org
     and not exists (select 1 from capital_call_allocations a where a.call_id = c.id);
  update capital_calls c set total_amount = s.total
    from (select call_id, sum(amount) total from capital_call_allocations group by call_id) s
   where s.call_id = c.id and c.organization_id = p_org and c.total_amount <> s.total;

  delete from subscriptions where investor_id = any(ids);
  delete from commitments where investor_id = any(ids);
  delete from documents where investor_id = any(ids);
  delete from memberships m using investors i
   where i.id = any(ids) and m.organization_id = p_org and m.user_id = i.portal_user_id and m.role = 'investor';
  delete from investors where id = any(ids);

  -- Compliance reminders those commitments created, unless already filed / closed.
  delete from compliance_items ci
   where ci.organization_id = p_org and ci.fund_id = any(coalesce(funds_hit, '{}')) and ci.status = 'open'
     and ci.kind in ('form_d_initial', 'form_d_amendment')
     and not exists (select 1 from commitments c where c.fund_id = ci.fund_id and c.status = 'accepted');
  delete from compliance_items ci
   where ci.organization_id = p_org and ci.fund_id = any(coalesce(funds_hit, '{}')) and ci.status = 'open'
     and ci.kind = 'state_notice'
     and not exists (
       select 1 from commitments c join investors i on i.id = c.investor_id
         left join subscriptions s on s.fund_id = c.fund_id and s.investor_id = c.investor_id
        where c.fund_id = ci.fund_id and c.status = 'accepted'
          and coalesce(s.residence_state, i.home_state, '??') = ci.state);
  return n;
end $$;
revoke execute on function remove_investors(uuid, uuid[]) from public, anon, authenticated;

-- Sample data (emails ending @example.com). Owner only, typed confirmation.
create or replace function purge_demo_data(p_org uuid, p_confirm text) returns int
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; n int;
begin
  if member_role_in(p_org) is distinct from 'owner' or not mfa_ok(p_org) then raise exception 'Only an owner can do this'; end if;
  if p_confirm is distinct from 'DELETE DEMO DATA' then raise exception 'Type DELETE DEMO DATA to confirm'; end if;
  select array_agg(id) into ids from investors where organization_id = p_org and email ilike '%@example.com';
  n := remove_investors(p_org, ids);
  if n > 0 then
    insert into audit_events (organization_id, actor_id, action, target_table, detail)
    values (p_org, auth.uid(), 'purge_demo', 'investors', jsonb_build_object('investors_removed', n));
  end if;
  return n;
end $$;
revoke execute on function purge_demo_data(uuid, text) from public, anon;
grant execute on function purge_demo_data(uuid, text) to authenticated;

-- One test or mistaken investor. Owner only; type the investor's name exactly to confirm.
create or replace function delete_investor_record(p_org uuid, p_investor uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public as $$
declare inv investors;
begin
  if member_role_in(p_org) is distinct from 'owner' or not mfa_ok(p_org) then raise exception 'Only an owner can do this'; end if;
  select * into inv from investors where id = p_investor and organization_id = p_org;
  if inv.id is null then raise exception 'Investor not found'; end if;
  if p_confirm is distinct from inv.display_name then raise exception 'Type the investor name exactly to confirm'; end if;
  perform remove_investors(p_org, array[inv.id]);
  insert into audit_events (organization_id, actor_id, action, target_table, target_id, detail)
  values (p_org, auth.uid(), 'delete_investor', 'investors', inv.id,
          jsonb_build_object('name', inv.display_name, 'email', inv.email));
end $$;
revoke execute on function delete_investor_record(uuid, uuid, text) from public, anon;
grant execute on function delete_investor_record(uuid, uuid, text) to authenticated;
