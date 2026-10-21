-- CRM OS → FundOS handoff
-- CRM OS owns marketing leads. Once a lead is qualified, CRM OS posts it to
-- /api/intake with an org API key; FundOS creates (or updates) the investor at
-- 'qualified' and owns the relationship from there.

-- Pipeline now starts at 'qualified'. Old enum values stay for compatibility.
update investors set stage = 'qualified' where stage in ('lead', 'contacted');
alter table investors alter column stage set default 'qualified';

alter table investors add column if not exists external_source text;
alter table investors add column if not exists external_id text;
create unique index if not exists investors_external_ref
  on investors (organization_id, external_source, external_id)
  where external_id is not null;
create index if not exists investors_email_lower on investors (organization_id, lower(email));

-- API keys: only a SHA-256 hash is stored. The plaintext is shown once at creation.
create table intake_keys (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  label            text not null,
  key_prefix       text not null,            -- first 8 chars, to recognise a key in the UI
  key_hash         text not null unique,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz
);
alter table intake_keys enable row level security;
create policy intake_keys_read on intake_keys for select
  using (member_role_in(organization_id) in ('owner','admin'));
-- No insert/update/delete policies: keys are managed only through the functions below.

create or replace function hash_key(k text) returns text
language sql immutable as $$ select encode(sha256(convert_to(k, 'UTF8')), 'hex') $$;

create or replace function create_intake_key(p_org uuid, p_label text) returns text
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if coalesce(member_role_in(p_org) in ('owner','admin'), false) is not true then
    raise exception 'Only an owner or admin can create API keys';
  end if;
  if coalesce(length(trim(p_label)), 0) = 0 then raise exception 'Give the key a label'; end if;
  k := 'fos_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into intake_keys (organization_id, label, key_prefix, key_hash, created_by)
  values (p_org, left(trim(p_label), 80), left(k, 12), hash_key(k), auth.uid());
  return k;
end $$;
revoke execute on function create_intake_key(uuid, text) from public, anon;
grant execute on function create_intake_key(uuid, text) to authenticated;

create or replace function revoke_intake_key(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select organization_id into org from intake_keys where id = p_id;
  if org is null or coalesce(member_role_in(org) in ('owner','admin'), false) is not true then
    raise exception 'Key not found';
  end if;
  update intake_keys set revoked_at = now() where id = p_id and revoked_at is null;
end $$;
revoke execute on function revoke_intake_key(uuid) from public, anon;
grant execute on function revoke_intake_key(uuid) to authenticated;

-- Called by the /api/intake route with the caller's key. Never moves an existing
-- investor's stage or overwrites fields FundOS staff have already filled in.
create or replace function intake_investor(
  p_key text,
  p_source text,
  p_external_id text,
  p_name text,
  p_email text,
  p_phone text default null,
  p_investor_type text default null,
  p_target_amount numeric default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  key_row intake_keys;
  inv investors;
  itype investor_type;
  created boolean := false;
begin
  select * into key_row from intake_keys where key_hash = hash_key(coalesce(p_key, '')) and revoked_at is null;
  if key_row.id is null then raise exception 'invalid_key' using errcode = '28000'; end if;

  if coalesce(length(trim(p_name)), 0) = 0 or length(p_name) > 200 then raise exception 'name is required (max 200 chars)'; end if;
  if p_email is not null and (length(p_email) > 254 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'invalid email'; end if;
  if p_target_amount is not null and (p_target_amount <= 0 or p_target_amount > 1e12) then raise exception 'invalid target_amount'; end if;
  if length(coalesce(p_source, '')) > 50 or length(coalesce(p_external_id, '')) > 100 or length(coalesce(p_note, '')) > 4000 then
    raise exception 'field too long';
  end if;
  begin
    itype := coalesce(p_investor_type, 'individual')::investor_type;
  exception when invalid_text_representation then itype := 'other';
  end;

  -- Match on the CRM's id first, then on email.
  if p_external_id is not null then
    select * into inv from investors
     where organization_id = key_row.organization_id and external_source = coalesce(p_source, 'crm_os') and external_id = p_external_id;
  end if;
  if inv.id is null and p_email is not null then
    select * into inv from investors
     where organization_id = key_row.organization_id and lower(email) = lower(p_email)
     order by created_at limit 1;
  end if;

  if inv.id is null then
    insert into investors (organization_id, display_name, investor_type, email, phone, stage, source,
                           target_amount, external_source, external_id)
    values (key_row.organization_id, trim(p_name), itype, lower(p_email), p_phone, 'qualified',
            coalesce(p_source, 'crm_os'), p_target_amount, coalesce(p_source, 'crm_os'), p_external_id)
    returning * into inv;
    created := true;
  else
    update investors set
      external_source = coalesce(external_source, coalesce(p_source, 'crm_os')),
      external_id     = coalesce(external_id, p_external_id),
      email           = coalesce(email, lower(p_email)),
      phone           = coalesce(phone, p_phone),
      target_amount   = coalesce(target_amount, p_target_amount)
    where id = inv.id;
  end if;

  insert into investor_activities (organization_id, investor_id, kind, body)
  values (key_row.organization_id, inv.id, 'handoff',
          case when created then 'Handed off from ' else 'Re-sent from ' end || coalesce(p_source, 'CRM OS')
          || coalesce(E'\n' || p_note, ''));

  update intake_keys set last_used_at = now() where id = key_row.id;
  return jsonb_build_object('investor_id', inv.id, 'created', created, 'stage', inv.stage);
end $$;
revoke execute on function intake_investor(text, text, text, text, text, text, text, numeric, text) from public;
grant execute on function intake_investor(text, text, text, text, text, text, text, numeric, text) to anon, authenticated;
