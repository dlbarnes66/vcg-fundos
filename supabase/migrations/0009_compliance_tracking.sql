-- Compliance calendar and per-investor document tracking.
-- Deadlines are generated from facts in FundOS (first accepted commitment, investor home state).
-- The federal Form D rule (15 days after first sale) is fixed; state rules vary, so state items
-- are created as reminders to confirm with counsel, not as legal determinations.

-- Investor home state (residence for individuals; principal place of business for entities).
alter table investors add column if not exists home_state char(2);
alter table subscriptions add column if not exists residence_state char(2);

create type compliance_kind as enum ('form_d_initial', 'form_d_amendment', 'state_notice', 'custom');
create type compliance_status as enum ('open', 'done', 'not_required');

create table compliance_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  fund_id          uuid not null,
  kind             compliance_kind not null,
  state            char(2),
  title            text not null,
  due_date         date not null,
  basis            text,                 -- why this item exists / how the date was set
  status           compliance_status not null default 'open',
  reference        text,                 -- filing / confirmation number
  completed_on     date,
  completed_by     uuid references auth.users(id),
  notes            text,
  created_at       timestamptz not null default now(),
  foreign key (organization_id, fund_id) references funds(organization_id, id) on delete cascade
);
-- One auto item per fund per kind/state (custom items are unlimited).
create unique index compliance_auto_once on compliance_items (fund_id, kind, coalesce(state, ''))
  where kind <> 'custom' and kind <> 'form_d_amendment';
create index on compliance_items (organization_id, status, due_date);
create trigger audit_compliance after insert or update or delete on compliance_items for each row execute function write_audit();

alter table compliance_items enable row level security;
create policy compliance_read on compliance_items for select using (is_staff(organization_id));
create policy compliance_write on compliance_items for insert with check (can_write(organization_id));
create policy compliance_update on compliance_items for update using (can_write(organization_id)) with check (can_write(organization_id));
create policy compliance_delete on compliance_items for delete using (member_role_in(organization_id) in ('owner','admin') and kind = 'custom');

create or replace function next_business_day(d date) returns date language sql immutable as $$
  select case extract(isodow from d) when 6 then d + 2 when 7 then d + 1 else d end
$$;

-- When a commitment is accepted: first one creates the Form D item; a new home state creates a state reminder.
create or replace function compliance_on_commitment() returns trigger
language plpgsql security definer set search_path = public as $$
declare sale date; st char(2); inv investors;
begin
  if new.status <> 'accepted' or (tg_op = 'UPDATE' and old.status = 'accepted') then return new; end if;
  sale := coalesce(new.signed_at, current_date);
  select * into inv from investors where id = new.investor_id;

  insert into compliance_items (organization_id, fund_id, kind, title, due_date, basis)
  values (new.organization_id, new.fund_id, 'form_d_initial', 'File Form D with the SEC',
          next_business_day(sale + 15),
          'Due 15 calendar days after the first sale (first accepted commitment on ' || sale || '). Confirm the date of first sale with counsel.')
  on conflict do nothing;

  select coalesce(s.residence_state, inv.home_state) into st
    from (select 1) x left join subscriptions s on s.fund_id = new.fund_id and s.investor_id = new.investor_id;
  if st is null then
    insert into compliance_items (organization_id, fund_id, kind, state, title, due_date, basis)
    values (new.organization_id, new.fund_id, 'state_notice', '??',
            'Home state unknown for an accepted investor',
            current_date + 3,
            'Add the home state on ' || inv.display_name || '''s record so the right state notice filing can be tracked.')
    on conflict do nothing;
  else
    insert into compliance_items (organization_id, fund_id, kind, state, title, due_date, basis)
    values (new.organization_id, new.fund_id, 'state_notice', st,
            'State notice filing: ' || st,
            next_business_day(sale + 15),
            'First accepted investor from ' || st || ' on ' || sale || '. Many states require a Form D notice filing and fee within 15 days of the first sale there; some require none or differ. Confirm with counsel and mark Not required if so.')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger commitments_compliance after insert or update on commitments
  for each row execute function compliance_on_commitment();

-- When the initial Form D (or an amendment) is marked done, schedule the annual amendment.
create or replace function compliance_on_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.kind in ('form_d_initial', 'form_d_amendment') then
    insert into compliance_items (organization_id, fund_id, kind, title, due_date, basis)
    values (new.organization_id, new.fund_id, 'form_d_amendment', 'Annual Form D amendment',
            next_business_day((coalesce(new.completed_on, current_date) + interval '1 year')::date),
            'Required annually, on or before the anniversary of the most recent Form D filing, while the offering continues. Mark Not required once the offering has closed and counsel confirms.');
  end if;
  return new;
end $$;
create trigger compliance_schedule_amendment after update on compliance_items
  for each row execute function compliance_on_done();

-- When a "state unknown" item exists and the state is later set, the next acceptance from that state creates the proper item;
-- staff can also add custom items (e.g. state renewals) from the Compliance page.

-- LP onboarding now captures home state.
drop function if exists lp_save_profile(uuid, text, investor_type, text, text, text, text, text, text);
create or replace function lp_save_profile(
  p_sub uuid, p_legal_name text, p_type investor_type, p_address text, p_phone text,
  p_entity_details text, p_signer_name text, p_signer_title text, p_beneficial_owners text, p_state text
) returns void language plpgsql security definer set search_path = public as $$
declare s subscriptions;
begin
  s := my_editable_subscription(p_sub);
  if coalesce(length(trim(p_legal_name)), 0) < 2 then raise exception 'Legal name is required'; end if;
  if coalesce(length(trim(p_address)), 0) < 5 then raise exception 'Address is required'; end if;
  if upper(coalesce(p_state, '')) !~ '^[A-Z]{2}$' then raise exception 'Choose your state'; end if;
  if p_type not in ('individual', 'joint', 'ira') and coalesce(length(trim(p_signer_name)), 0) < 2 then
    raise exception 'Entities need an authorized signer';
  end if;
  update subscriptions set
    legal_name = left(trim(p_legal_name), 200), investor_type = p_type, address = left(trim(p_address), 500),
    phone = left(p_phone, 50), entity_details = left(p_entity_details, 1000), signer_name = left(p_signer_name, 200),
    signer_title = left(p_signer_title, 200), beneficial_owners = left(p_beneficial_owners, 2000),
    residence_state = upper(p_state), profile_done_at = now()
  where id = p_sub;
end $$;
revoke execute on function lp_save_profile(uuid, text, investor_type, text, text, text, text, text, text, text) from public, anon;
grant execute on function lp_save_profile(uuid, text, investor_type, text, text, text, text, text, text, text) to authenticated;

-- Approval copies the state to the investor record (before the commitment is created, so the trigger sees it).
create or replace function copy_state_on_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.residence_state is not null then
    update investors set home_state = coalesce(home_state, new.residence_state) where id = new.investor_id;
  end if;
  return new;
end $$;
create trigger subscriptions_copy_state after update on subscriptions
  for each row execute function copy_state_on_approval();

-- ───────────── Per-investor document tracking ─────────────
-- All staff (not just owner/admin) can see who opened what, for follow-ups.
drop policy if exists doc_log_read on document_access_log;
create policy doc_log_read on document_access_log for select using (is_staff(organization_id));

create or replace view document_opens with (security_invoker = true) as
select l.organization_id, l.document_id, d.title, d.category, i.id as investor_id, i.display_name as investor_name,
       count(*)::int as opens, min(l.accessed_at) as first_opened, max(l.accessed_at) as last_opened
  from document_access_log l
  join documents d on d.id = l.document_id
  join investors i on i.portal_user_id = l.user_id and i.organization_id = l.organization_id
 group by 1, 2, 3, 4, 5, 6;
