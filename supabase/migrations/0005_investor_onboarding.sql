-- Investor onboarding: profile, W-9, offering-document acknowledgement, accreditation
-- evidence, click-to-sign subscription, and staff review.
-- LPs act only through the lp_* functions below (they validate ownership and step order).

create type subscription_status as enum ('in_progress', 'submitted', 'changes_requested', 'approved', 'declined');

-- Per-fund onboarding settings.
alter table funds add column if not exists subscription_doc_id uuid references documents(id) on delete set null;

-- Wire instructions live apart from funds so LPs only see them after acceptance.
create table fund_wire_instructions (
  fund_id          uuid primary key,
  organization_id  uuid not null,
  instructions     text not null,
  verify_phone     text,                     -- number investors call to confirm before wiring
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, fund_id) references funds(organization_id, id) on delete cascade
);

create table subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null,
  fund_id                uuid not null,
  investor_id            uuid not null,
  status                 subscription_status not null default 'in_progress',

  -- Step 1: profile (no SSNs/EINs here — those are on the uploaded W-9)
  legal_name             text,
  investor_type          investor_type,
  address                text,
  phone                  text,
  entity_details         text,              -- state/date of formation, etc.
  signer_name            text,
  signer_title           text,
  beneficial_owners      text,              -- 25%+ owners for entities
  profile_done_at        timestamptz,

  -- Step 2: W-9
  w9_document_id         uuid references documents(id) on delete set null,

  -- Step 3: offering documents read
  docs_ack               jsonb,             -- [{id,title}] acknowledged
  docs_ack_at            timestamptz,

  -- Step 4: accreditation
  accreditation_basis    text,              -- income | net_worth | professional | entity_assets | entity_owners | other
  accreditation_document_id uuid references documents(id) on delete set null,
  accreditation_note     text,

  -- Step 5: subscription and signature (ESIGN/UETA evidence)
  amount                 numeric(18,2),
  esign_consent_at       timestamptz,
  signature_name         text,
  signed_at              timestamptz,
  signed_by              uuid references auth.users(id),
  signed_ip              text,
  signed_user_agent      text,
  signed_doc_sha256      text,              -- fingerprint of the exact template signed
  signed_packet_id       uuid references documents(id) on delete set null,

  submitted_at           timestamptz,
  reviewed_by            uuid references auth.users(id),
  reviewed_at            timestamptz,
  review_note            text,
  commitment_id          uuid references commitments(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (fund_id, investor_id),
  unique (organization_id, id),
  foreign key (organization_id, fund_id) references funds(organization_id, id) on delete cascade,
  foreign key (organization_id, investor_id) references investors(organization_id, id) on delete cascade
);
create index on subscriptions (organization_id, status);
create trigger subscriptions_touch before update on subscriptions for each row execute function touch_updated_at();
create trigger audit_subscriptions after insert or update or delete on subscriptions for each row execute function write_audit();
create trigger audit_wire after insert or update or delete on fund_wire_instructions for each row execute function write_audit();

alter table subscriptions enable row level security;
alter table fund_wire_instructions enable row level security;

create policy subs_staff_read on subscriptions for select using (is_staff(organization_id));
create policy subs_self_read  on subscriptions for select using (investor_id in (select my_investor_ids()));
create policy subs_staff_insert on subscriptions for insert with check (can_write(organization_id));
create policy subs_staff_update on subscriptions for update using (can_post_capital(organization_id)) with check (can_post_capital(organization_id));
-- No LP insert/update policies: LPs change their subscription only through lp_* functions.

create policy wire_staff_read on fund_wire_instructions for select using (is_staff(organization_id));
create policy wire_owner_write on fund_wire_instructions for all
  using (member_role_in(organization_id) = 'owner') with check (member_role_in(organization_id) = 'owner');
create policy wire_lp_read on fund_wire_instructions for select using (
  exists (select 1 from commitments c
          where c.fund_id = fund_wire_instructions.fund_id and c.status = 'accepted'
            and c.investor_id in (select my_investor_ids())));

-- LPs can see a fund they've been invited to subscribe to (not just funds they've committed to).
create policy funds_subscriber_read on funds for select using (
  exists (select 1 from subscriptions s where s.fund_id = funds.id and s.investor_id in (select my_investor_ids())));

-- LP uploads go only to <org>/lp/<their investor id>/… and are visible only to them and staff.
create policy docs_lp_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[2] = 'lp'
    and ((storage.foldername(name))[3])::uuid in (select my_investor_ids())
  );
create policy documents_lp_insert on documents for insert with check (
  visibility = 'investor'
  and investor_id in (select my_investor_ids())
  and storage_path like organization_id::text || '/lp/' || investor_id::text || '/%'
  and category in ('tax', 'subscription', 'accreditation')
  and uploaded_by = auth.uid()
);

-- ───────────── LP step functions ─────────────
create or replace function my_editable_subscription(p_sub uuid) returns subscriptions
language plpgsql stable security definer set search_path = public as $$
declare s subscriptions;
begin
  select * into s from subscriptions where id = p_sub;
  if s.id is null or s.investor_id not in (select my_investor_ids()) then raise exception 'Subscription not found'; end if;
  if s.status not in ('in_progress', 'changes_requested') then
    raise exception 'This subscription has been submitted and can no longer be changed. Contact the fund manager.';
  end if;
  return s;
end $$;

create or replace function lp_save_profile(
  p_sub uuid, p_legal_name text, p_type investor_type, p_address text, p_phone text,
  p_entity_details text, p_signer_name text, p_signer_title text, p_beneficial_owners text
) returns void language plpgsql security definer set search_path = public as $$
declare s subscriptions;
begin
  s := my_editable_subscription(p_sub);
  if coalesce(length(trim(p_legal_name)), 0) < 2 then raise exception 'Legal name is required'; end if;
  if coalesce(length(trim(p_address)), 0) < 5 then raise exception 'Address is required'; end if;
  if p_type not in ('individual', 'joint', 'ira') and coalesce(length(trim(p_signer_name)), 0) < 2 then
    raise exception 'Entities need an authorized signer';
  end if;
  update subscriptions set
    legal_name = left(trim(p_legal_name), 200), investor_type = p_type, address = left(trim(p_address), 500),
    phone = left(p_phone, 50), entity_details = left(p_entity_details, 1000), signer_name = left(p_signer_name, 200),
    signer_title = left(p_signer_title, 200), beneficial_owners = left(p_beneficial_owners, 2000), profile_done_at = now()
  where id = p_sub;
end $$;

create or replace function lp_attach(p_sub uuid, p_kind text, p_document uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s subscriptions; d documents;
begin
  s := my_editable_subscription(p_sub);
  select * into d from documents where id = p_document;
  if d.id is null or d.investor_id is distinct from s.investor_id then raise exception 'Document not found'; end if;
  if p_kind = 'w9' then update subscriptions set w9_document_id = p_document where id = p_sub;
  elsif p_kind = 'accreditation' then update subscriptions set accreditation_document_id = p_document where id = p_sub;
  else raise exception 'Unknown attachment';
  end if;
end $$;

create or replace function lp_ack_documents(p_sub uuid, p_docs jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s subscriptions;
begin
  s := my_editable_subscription(p_sub);
  if jsonb_array_length(coalesce(p_docs, '[]')) = 0 then raise exception 'There are no offering documents to acknowledge yet'; end if;
  update subscriptions set docs_ack = p_docs, docs_ack_at = now() where id = p_sub;
end $$;

create or replace function lp_set_accreditation(p_sub uuid, p_basis text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s subscriptions;
begin
  s := my_editable_subscription(p_sub);
  if p_basis not in ('income', 'net_worth', 'professional', 'entity_assets', 'entity_owners', 'other') then
    raise exception 'Choose how you qualify as accredited';
  end if;
  update subscriptions set accreditation_basis = p_basis, accreditation_note = left(p_note, 1000) where id = p_sub;
end $$;

-- Records the signature. All earlier steps must be complete; amount must meet the fund minimum.
create or replace function lp_sign(
  p_sub uuid, p_amount numeric, p_signature_name text, p_sha256 text, p_packet uuid, p_ip text, p_user_agent text
) returns void language plpgsql security definer set search_path = public as $$
declare s subscriptions; f funds; d documents;
begin
  s := my_editable_subscription(p_sub);
  select * into f from funds where id = s.fund_id;
  if s.profile_done_at is null or s.w9_document_id is null or s.docs_ack_at is null
     or s.accreditation_basis is null or s.accreditation_document_id is null then
    raise exception 'Finish the earlier steps before signing';
  end if;
  if p_amount is null or p_amount < f.min_commitment then
    raise exception 'The minimum subscription is %', to_char(f.min_commitment, 'FM$999,999,999');
  end if;
  if coalesce(length(trim(p_signature_name)), 0) < 3 then raise exception 'Type your full name to sign'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid document fingerprint'; end if;
  select * into d from documents where id = p_packet;
  if d.id is null or d.investor_id is distinct from s.investor_id then raise exception 'Signed packet not found'; end if;
  update subscriptions set
    amount = round(p_amount, 2), esign_consent_at = now(), signature_name = left(trim(p_signature_name), 200),
    signed_at = now(), signed_by = auth.uid(), signed_ip = left(p_ip, 100), signed_user_agent = left(p_user_agent, 500),
    signed_doc_sha256 = p_sha256, signed_packet_id = p_packet
  where id = p_sub;
end $$;

create or replace function lp_submit(p_sub uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s subscriptions;
begin
  s := my_editable_subscription(p_sub);
  if s.signed_at is null then raise exception 'Sign the subscription agreement first'; end if;
  update subscriptions set status = 'submitted', submitted_at = now() where id = p_sub;
  update investors set stage = 'docs_sent' where id = s.investor_id and stage in ('qualified', 'due_diligence', 'soft_circled');
  insert into investor_activities (organization_id, investor_id, kind, body)
  values (s.organization_id, s.investor_id, 'onboarding', 'Submitted subscription for review: ' || to_char(s.amount, 'FM$999,999,999.00'));
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'my_editable_subscription(uuid)',
    'lp_save_profile(uuid, text, investor_type, text, text, text, text, text, text)',
    'lp_attach(uuid, text, uuid)', 'lp_ack_documents(uuid, jsonb)', 'lp_set_accreditation(uuid, text, text)',
    'lp_sign(uuid, numeric, text, text, uuid, text, text)', 'lp_submit(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ───────────── Staff review (owner/admin) ─────────────
-- Approve: marks accreditation verified, creates the accepted commitment, moves the investor to Committed.
create or replace function approve_subscription(p_sub uuid, p_accreditation_expires date, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare s subscriptions; cid uuid;
begin
  select * into s from subscriptions where id = p_sub;
  if s.id is null or coalesce(can_post_capital(s.organization_id), false) is not true then raise exception 'Not allowed'; end if;
  if s.status <> 'submitted' then raise exception 'Only submitted subscriptions can be approved'; end if;
  if s.accreditation_document_id is null then raise exception 'No accreditation evidence on file'; end if;
  if p_accreditation_expires is null or p_accreditation_expires <= current_date then
    raise exception 'Set when this accreditation verification expires (a future date)';
  end if;

  update investors set accreditation_status = 'verified', accreditation_verified_at = current_date,
         accreditation_expires_at = p_accreditation_expires, stage = 'committed',
         display_name = coalesce(s.legal_name, display_name), investor_type = coalesce(s.investor_type, investor_type)
   where id = s.investor_id;

  insert into commitments (organization_id, fund_id, investor_id, amount, status, signed_at)
  values (s.organization_id, s.fund_id, s.investor_id, s.amount, 'accepted', s.signed_at::date)
  returning id into cid;

  update subscriptions set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = left(p_note, 2000), commitment_id = cid
   where id = p_sub;

  insert into investor_activities (organization_id, investor_id, kind, body, created_by)
  values (s.organization_id, s.investor_id, 'onboarding',
          'Subscription approved: accreditation verified (expires ' || p_accreditation_expires || '), commitment accepted for '
          || to_char(s.amount, 'FM$999,999,999.00'), auth.uid());
  return cid;
end $$;

create or replace function return_subscription(p_sub uuid, p_status subscription_status, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare s subscriptions;
begin
  select * into s from subscriptions where id = p_sub;
  if s.id is null or coalesce(can_post_capital(s.organization_id), false) is not true then raise exception 'Not allowed'; end if;
  if p_status not in ('changes_requested', 'declined') then raise exception 'Invalid status'; end if;
  if s.status <> 'submitted' then raise exception 'Only submitted subscriptions can be returned'; end if;
  if coalesce(length(trim(p_note)), 0) < 5 then raise exception 'Explain what needs to change'; end if;
  -- Asking for changes clears the signature: the investor re-signs after fixing anything.
  update subscriptions set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(p_note, 2000),
         signed_at = case when p_status = 'changes_requested' then null else signed_at end,
         signature_name = case when p_status = 'changes_requested' then null else signature_name end,
         signed_packet_id = case when p_status = 'changes_requested' then null else signed_packet_id end
   where id = p_sub;
  insert into investor_activities (organization_id, investor_id, kind, body, created_by)
  values (s.organization_id, s.investor_id, 'onboarding',
          case when p_status = 'declined' then 'Subscription declined: ' else 'Changes requested: ' end || p_note, auth.uid());
end $$;

revoke execute on function approve_subscription(uuid, date, text) from public, anon;
grant execute on function approve_subscription(uuid, date, text) to authenticated;
revoke execute on function return_subscription(uuid, subscription_status, text) from public, anon;
grant execute on function return_subscription(uuid, subscription_status, text) to authenticated;
