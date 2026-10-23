-- Document Studio: AI-assisted drafts of fund documents, and consistency checks.
-- Drafts are always drafts until an owner records counsel's approval; approved
-- versions are locked. New edits go into a new version.

create type doc_kind as enum (
  'ppm', 'lpa', 'subscription_agreement', 'investor_questionnaire', 'capital_call_notice', 'side_letter'
);
create type draft_status as enum ('draft', 'in_review', 'approved', 'superseded');

create table doc_drafts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  fund_id           uuid not null,
  kind              doc_kind not null,
  version           int not null default 1,
  status            draft_status not null default 'draft',
  terms_snapshot    jsonb not null,                    -- the fund data this version was drafted from
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  sent_to_counsel_at timestamptz,
  approved_by_name  text,                              -- counsel's name, as recorded by the owner
  approved_at       timestamptz,
  approval_note     text,
  unique (fund_id, kind, version),
  unique (organization_id, id),
  foreign key (organization_id, fund_id) references funds(organization_id, id) on delete cascade,
  -- An approved version must carry counsel's name and date (and keeps them if later superseded).
  check (status <> 'approved' or (approved_at is not null and approved_by_name is not null)),
  check (approved_at is null or status in ('approved', 'superseded'))
);

create table doc_sections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  draft_id         uuid not null,
  position         int not null,
  key              text not null,
  heading          text not null,
  content          text,
  missing          text[] not null default '{}',       -- [[MISSING: …]] items found in the content
  ai_generated     boolean not null default false,
  edited_by_human  boolean not null default false,
  updated_at       timestamptz not null default now(),
  unique (draft_id, key),
  foreign key (organization_id, draft_id) references doc_drafts(organization_id, id) on delete cascade
);

create table doc_checks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  fund_id          uuid not null,
  sources          jsonb not null,                     -- [{type:'document'|'draft', id, title}]
  findings         jsonb not null,                     -- [{severity, topic, where, says, expected, explanation}]
  summary          text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, fund_id) references funds(organization_id, id) on delete cascade
);
create index on doc_checks (fund_id, created_at desc);

-- Approved / superseded drafts are frozen; sections of a non-editable draft can't change.
create or replace function lock_frozen_drafts() returns trigger language plpgsql as $$
begin
  if old.status in ('approved', 'superseded') then
    if new.status = 'superseded' and old.status = 'approved' and
       (new.approved_at, new.approved_by_name, new.version) is not distinct from (old.approved_at, old.approved_by_name, old.version) then
      return new; -- an approved version may later be marked superseded, nothing else
    end if;
    raise exception 'This version is % and can no longer be changed. Start a new version.', old.status;
  end if;
  return new;
end $$;
create trigger doc_drafts_lock before update on doc_drafts for each row execute function lock_frozen_drafts();

create or replace function lock_frozen_sections() returns trigger language plpgsql as $$
declare st draft_status;
begin
  select status into st from doc_drafts where id = coalesce(new.draft_id, old.draft_id);
  if st in ('approved', 'superseded') then
    raise exception 'This version is % and its sections can no longer be changed.', st;
  end if;
  return coalesce(new, old);
end $$;
create trigger doc_sections_lock before insert or update or delete on doc_sections
  for each row execute function lock_frozen_sections();

-- Only an owner may record counsel approval (and the people named must be real; this is a record, not a signature).
create or replace function guard_draft_approval() returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
     and coalesce(member_role_in(new.organization_id) = 'owner', false) is not true then
    raise exception 'Only an owner can record counsel approval';
  end if;
  return new;
end $$;
create trigger doc_drafts_approval before update on doc_drafts for each row execute function guard_draft_approval();

create trigger audit_doc_drafts after insert or update or delete on doc_drafts for each row execute function write_audit();
create trigger audit_doc_checks after insert on doc_checks for each row execute function write_audit();

alter table doc_drafts   enable row level security;
alter table doc_sections enable row level security;
alter table doc_checks   enable row level security;

-- Staff can read. Owner/admin draft and check. Investors never see drafts.
create policy drafts_read  on doc_drafts for select using (is_staff(organization_id));
create policy drafts_write on doc_drafts for insert with check (can_post_capital(organization_id));
create policy drafts_upd   on doc_drafts for update using (can_post_capital(organization_id)) with check (can_post_capital(organization_id));
create policy drafts_del   on doc_drafts for delete using (member_role_in(organization_id) = 'owner' and status in ('draft', 'in_review'));

create policy sections_read  on doc_sections for select using (is_staff(organization_id));
create policy sections_write on doc_sections for insert with check (can_post_capital(organization_id));
create policy sections_upd   on doc_sections for update using (can_post_capital(organization_id)) with check (can_post_capital(organization_id));

create policy checks_read  on doc_checks for select using (is_staff(organization_id));
create policy checks_write on doc_checks for insert with check (can_post_capital(organization_id) and created_by = auth.uid());
