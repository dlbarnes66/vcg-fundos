-- VCG FundOS — initial schema
-- Multi-tenant from day one: every business table carries organization_id and is
-- protected by row-level security. Money is numeric(18,2), never float.
-- Capital transactions are append-only: corrections are made with reversal rows.

-- ───────────────────────────── Enums ─────────────────────────────
create type member_role as enum ('owner', 'admin', 'investor_relations', 'viewer', 'investor');
create type investor_type as enum ('individual', 'joint', 'trust', 'llc', 'partnership', 'corporation', 'ira', 'other');
create type pipeline_stage as enum (
  'lead', 'contacted', 'qualified', 'due_diligence', 'soft_circled',
  'docs_sent', 'committed', 'funded', 'declined'
);
create type accreditation_status as enum ('not_started', 'pending', 'verified', 'expired', 'rejected');
create type commitment_status as enum ('pending', 'accepted', 'cancelled');
create type capital_txn_kind as enum ('contribution', 'distribution', 'return_of_capital', 'fee', 'reversal');
create type doc_visibility as enum ('internal', 'all_investors', 'investor');
create type fund_status as enum ('draft', 'raising', 'closed', 'operating', 'wound_down');

-- ───────────────────────────── Tenancy ─────────────────────────────
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create table memberships (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            member_role not null,
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index on memberships (user_id);

-- ───────────────────────────── Funds ─────────────────────────────
create table funds (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  name              text not null,
  offering_type     text not null default 'Reg D 506(c)',
  status            fund_status not null default 'raising',
  currency          char(3) not null default 'USD',
  target_size       numeric(18,2) not null check (target_size > 0),
  min_commitment    numeric(18,2) not null default 0 check (min_commitment >= 0),
  pref_rate         numeric(7,4) not null default 0,   -- 0.0700 = 7%
  mgmt_fee_rate     numeric(7,4) not null default 0,   -- 0.0200 = 2%
  -- Waterfall tiers above the pref live here as versioned config, not code.
  terms             jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (organization_id, id)
);

-- ───────────────────────────── Investors / CRM ─────────────────────────────
create table investors (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references organizations(id) on delete cascade,
  display_name              text not null,
  investor_type             investor_type not null default 'individual',
  email                     text,
  phone                     text,
  stage                     pipeline_stage not null default 'lead',
  accreditation_status      accreditation_status not null default 'not_started',
  accreditation_verified_at date,
  accreditation_expires_at  date,
  source                    text,
  target_amount             numeric(18,2),
  next_follow_up            date,
  notes                     text,
  portal_user_id            uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (organization_id, id)
);
create index on investors (organization_id, stage);
create unique index investors_portal_user_once on investors (organization_id, portal_user_id) where portal_user_id is not null;

create table investor_activities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  investor_id      uuid not null,
  kind             text not null default 'note',  -- note | call | email | meeting | stage_change
  body             text not null,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, investor_id) references investors(organization_id, id) on delete cascade
);
create index on investor_activities (investor_id, created_at desc);

-- ───────────────────────────── Commitments ─────────────────────────────
create table commitments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  fund_id          uuid not null,
  investor_id      uuid not null,
  amount           numeric(18,2) not null check (amount > 0),
  status           commitment_status not null default 'pending',
  signed_at        date,
  created_at       timestamptz not null default now(),
  -- Composite FKs make cross-tenant links impossible.
  foreign key (organization_id, fund_id) references funds(organization_id, id) on delete restrict,
  foreign key (organization_id, investor_id) references investors(organization_id, id) on delete restrict
);
create index on commitments (fund_id);

-- 506(c) guardrail: a commitment can only be accepted from a verified, unexpired investor.
create or replace function check_commitment_accreditation() returns trigger
language plpgsql as $$
declare inv investors;
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    select * into inv from investors where id = new.investor_id;
    if inv.accreditation_status <> 'verified'
       or (inv.accreditation_expires_at is not null and inv.accreditation_expires_at < current_date) then
      raise exception 'Investor accreditation must be verified (and unexpired) before accepting a commitment';
    end if;
  end if;
  return new;
end $$;
create trigger commitments_accreditation before insert or update on commitments
  for each row execute function check_commitment_accreditation();

-- ───────────────────────────── Capital transactions (append-only) ─────────────────────────────
create table capital_transactions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  fund_id          uuid not null,
  investor_id      uuid not null,
  kind             capital_txn_kind not null,
  -- Always positive; the kind gives the direction. Reversals carry the original's amount.
  amount           numeric(18,2) not null check (amount > 0),
  effective_date   date not null,
  memo             text,
  reverses_id      uuid references capital_transactions(id),
  posted_by        uuid references auth.users(id),
  posted_at        timestamptz not null default now(),
  foreign key (organization_id, fund_id) references funds(organization_id, id) on delete restrict,
  foreign key (organization_id, investor_id) references investors(organization_id, id) on delete restrict,
  check ((kind = 'reversal') = (reverses_id is not null))
);
create index on capital_transactions (fund_id, investor_id, effective_date);
create unique index capital_txn_reversed_once on capital_transactions (reverses_id) where reverses_id is not null;

create or replace function forbid_capital_txn_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'capital_transactions is append-only; post a reversal instead';
end $$;

create trigger capital_txn_no_update before update or delete on capital_transactions
  for each row execute function forbid_capital_txn_mutation();

-- A reversal must match the transaction it reverses (same fund, investor, amount).
create or replace function check_reversal() returns trigger
language plpgsql as $$
declare orig capital_transactions;
begin
  if new.kind <> 'reversal' then return new; end if;
  select * into orig from capital_transactions where id = new.reverses_id;
  if orig.id is null then raise exception 'reversed transaction not found'; end if;
  if orig.kind = 'reversal' then raise exception 'cannot reverse a reversal'; end if;
  if orig.fund_id <> new.fund_id or orig.investor_id <> new.investor_id
     or orig.amount <> new.amount or orig.organization_id <> new.organization_id then
    raise exception 'reversal must match original fund, investor and amount';
  end if;
  return new;
end $$;

create trigger capital_txn_check_reversal before insert on capital_transactions
  for each row execute function check_reversal();

-- ───────────────────────────── Documents ─────────────────────────────
create table documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  fund_id          uuid,
  investor_id      uuid,
  title            text not null,
  category         text not null default 'general', -- offering | subscription | report | tax | notice | general
  visibility       doc_visibility not null default 'internal',
  storage_path     text not null unique,            -- <org_id>/<uuid>-<filename> in the private 'documents' bucket
  size_bytes       bigint,
  uploaded_by      uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, fund_id) references funds(organization_id, id) on delete set null (fund_id),
  foreign key (organization_id, investor_id) references investors(organization_id, id) on delete cascade,
  check ((visibility = 'investor') = (investor_id is not null))
);
create index on documents (organization_id, created_at desc);

create table document_access_log (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  document_id      uuid not null references documents(id) on delete cascade,
  user_id          uuid not null references auth.users(id),
  accessed_at      timestamptz not null default now()
);

-- ───────────────────────────── Audit ─────────────────────────────
create table audit_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  actor_id         uuid,
  action           text not null,
  target_table     text not null,
  target_id        text,
  detail           jsonb,
  created_at       timestamptz not null default now()
);
create index on audit_events (organization_id, created_at desc);

create or replace function write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb; org uuid;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org := (rec->>'organization_id')::uuid;
  insert into audit_events (organization_id, actor_id, action, target_table, target_id, detail)
  values (org, auth.uid(), lower(tg_op), tg_table_name, rec->>'id',
          case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', rec) else rec end);
  return null;
end $$;

create trigger audit_investors   after insert or update or delete on investors            for each row execute function write_audit();
create trigger audit_commitments after insert or update or delete on commitments          for each row execute function write_audit();
create trigger audit_capital     after insert                     on capital_transactions for each row execute function write_audit();
create trigger audit_documents   after insert or update or delete on documents            for each row execute function write_audit();
create trigger audit_funds       after insert or update or delete on funds                for each row execute function write_audit();

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger investors_touch before update on investors for each row execute function touch_updated_at();

-- ───────────────────────────── Access helpers ─────────────────────────────
create or replace function member_role_in(org uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from memberships where organization_id = org and user_id = auth.uid()
$$;

create or replace function is_staff(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(member_role_in(org) in ('owner','admin','investor_relations','viewer'), false)
$$;

create or replace function can_write(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(member_role_in(org) in ('owner','admin','investor_relations'), false)
$$;

create or replace function can_post_capital(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(member_role_in(org) in ('owner','admin'), false)
$$;

-- The investor record(s) linked to the signed-in portal user.
create or replace function my_investor_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from investors where portal_user_id = auth.uid()
$$;

-- ───────────────────────────── Row-level security ─────────────────────────────
alter table organizations        enable row level security;
alter table memberships          enable row level security;
alter table funds                enable row level security;
alter table investors            enable row level security;
alter table investor_activities  enable row level security;
alter table commitments          enable row level security;
alter table capital_transactions enable row level security;
alter table documents            enable row level security;
alter table document_access_log  enable row level security;
alter table audit_events         enable row level security;

create policy org_read on organizations for select using (member_role_in(id) is not null);

create policy membership_self on memberships for select
  using (user_id = auth.uid() or member_role_in(organization_id) in ('owner','admin'));
create policy membership_admin on memberships for all
  using (member_role_in(organization_id) = 'owner') with check (member_role_in(organization_id) = 'owner');

-- Funds: staff read/write; investors read funds they have committed to.
create policy funds_staff_read on funds for select using (is_staff(organization_id));
create policy funds_investor_read on funds for select using (
  exists (select 1 from commitments c where c.fund_id = funds.id and c.investor_id in (select my_investor_ids())));
create policy funds_write on funds for all
  using (member_role_in(organization_id) in ('owner','admin'))
  with check (member_role_in(organization_id) in ('owner','admin'));

-- Investors: staff see all in org; an LP sees only their own record.
create policy investors_staff_read on investors for select using (is_staff(organization_id));
create policy investors_self_read on investors for select using (portal_user_id = auth.uid());
create policy investors_write on investors for insert with check (can_write(organization_id));
create policy investors_update on investors for update using (can_write(organization_id)) with check (can_write(organization_id));
create policy investors_delete on investors for delete using (member_role_in(organization_id) in ('owner','admin'));

create policy activities_read on investor_activities for select using (is_staff(organization_id));
create policy activities_write on investor_activities for insert with check (can_write(organization_id));

create policy commitments_staff_read on commitments for select using (is_staff(organization_id));
create policy commitments_self_read on commitments for select using (investor_id in (select my_investor_ids()));
create policy commitments_write on commitments for insert with check (can_write(organization_id));
create policy commitments_update on commitments for update using (can_write(organization_id)) with check (can_write(organization_id));

-- Capital: only owner/admin can post; no update/delete policy exists (and the trigger blocks it anyway).
create policy capital_staff_read on capital_transactions for select using (is_staff(organization_id));
create policy capital_self_read on capital_transactions for select using (investor_id in (select my_investor_ids()));
create policy capital_post on capital_transactions for insert
  with check (can_post_capital(organization_id) and posted_by = auth.uid());

create policy documents_staff_read on documents for select using (is_staff(organization_id));
create policy documents_investor_read on documents for select using (
  (visibility = 'investor' and investor_id in (select my_investor_ids()))
  or (visibility = 'all_investors' and exists (
        select 1 from investors i where i.organization_id = documents.organization_id and i.portal_user_id = auth.uid())));
create policy documents_write on documents for insert with check (can_write(organization_id));
create policy documents_delete on documents for delete using (member_role_in(organization_id) in ('owner','admin'));

create policy doc_log_insert on document_access_log for insert with check (user_id = auth.uid());
create policy doc_log_read on document_access_log for select using (member_role_in(organization_id) in ('owner','admin'));

create policy audit_read on audit_events for select using (member_role_in(organization_id) in ('owner','admin'));

-- ───────────────────────────── Capital account view ─────────────────────────────
-- security_invoker: the view obeys the caller's RLS, so LPs only see their own rows.
create view capital_accounts with (security_invoker = true) as
with tx as (
  select t.organization_id, t.fund_id, t.investor_id,
         coalesce(r.kind, t.kind) as base_kind,
         case when t.kind = 'reversal' then -t.amount else t.amount end as signed_amount
  from capital_transactions t
  left join capital_transactions r on r.id = t.reverses_id
),
agg as (
  select organization_id, fund_id, investor_id,
    sum(signed_amount) filter (where base_kind = 'contribution')      as contributed,
    sum(signed_amount) filter (where base_kind = 'distribution')      as distributed,
    sum(signed_amount) filter (where base_kind = 'return_of_capital') as capital_returned,
    sum(signed_amount) filter (where base_kind = 'fee')               as fees
  from tx group by 1,2,3
),
cm as (
  select organization_id, fund_id, investor_id, sum(amount) as committed
  from commitments where status = 'accepted' group by 1,2,3
)
select
  coalesce(cm.organization_id, agg.organization_id) as organization_id,
  coalesce(cm.fund_id, agg.fund_id)                 as fund_id,
  coalesce(cm.investor_id, agg.investor_id)         as investor_id,
  coalesce(cm.committed, 0)          as committed,
  coalesce(agg.contributed, 0)       as contributed,
  coalesce(cm.committed, 0) - coalesce(agg.contributed, 0) as unfunded,
  coalesce(agg.distributed, 0)       as distributed,
  coalesce(agg.capital_returned, 0)  as capital_returned,
  coalesce(agg.fees, 0)              as fees,
  coalesce(agg.contributed, 0) - coalesce(agg.capital_returned, 0) as net_invested_capital
from cm full outer join agg
  on cm.fund_id = agg.fund_id and cm.investor_id = agg.investor_id;

-- ───────────────────────────── Storage ─────────────────────────────
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
  on conflict (id) do nothing;

-- Objects live at <organization_id>/<file>. Uploads: writers in that org.
create policy docs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and can_write(((storage.foldername(name))[1])::uuid));

-- Reads: only if the caller can see the matching documents row (RLS applies in the subquery).
create policy docs_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and exists (select 1 from documents d where d.storage_path = storage.objects.name));

create policy docs_remove on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and member_role_in(((storage.foldername(name))[1])::uuid) in ('owner','admin'));

-- ───────────────────────────── Portal access ─────────────────────────────
-- Owner/admin links an invited auth user (by email) to an investor record and grants
-- the 'investor' role. Invite the user first: Supabase dashboard → Authentication → Invite.
create or replace function link_portal_user(p_investor_id uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid; uid uuid; existing member_role;
begin
  select organization_id into org from investors where id = p_investor_id;
  if org is null then raise exception 'Investor not found'; end if;
  if coalesce(member_role_in(org) in ('owner','admin'), false) is not true then
    raise exception 'Only an owner or admin can grant portal access';
  end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'No user with that email. Invite them in Supabase Auth first.'; end if;
  select role into existing from memberships where organization_id = org and user_id = uid;
  if existing is not null and existing <> 'investor' then
    raise exception 'That email belongs to a staff member';
  end if;
  insert into memberships (organization_id, user_id, role) values (org, uid, 'investor')
    on conflict (organization_id, user_id) do nothing;
  update investors set portal_user_id = uid where id = p_investor_id;
end $$;
revoke execute on function link_portal_user(uuid, text) from public, anon;
grant execute on function link_portal_user(uuid, text) to authenticated;

-- ───────────────────────────── Bootstrap ─────────────────────────────
-- Run once from the SQL editor after you sign up:  select bootstrap_owner('you@example.com');
create or replace function bootstrap_owner(owner_email text, org_name text default 'Venture Collective Group', org_slug text default 'vcg')
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid; org uuid;
begin
  select id into uid from auth.users where email = owner_email;
  if uid is null then raise exception 'No auth user with email %', owner_email; end if;
  insert into organizations (name, slug) values (org_name, org_slug)
    on conflict (slug) do update set name = excluded.name returning id into org;
  insert into memberships (organization_id, user_id, role) values (org, uid, 'owner')
    on conflict (organization_id, user_id) do update set role = 'owner';
  return org;
end $$;
revoke execute on function bootstrap_owner(text, text, text) from public, anon, authenticated;
