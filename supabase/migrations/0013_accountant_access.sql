-- Accountant / CPA access: read the money side of the fund, read tax documents (W-9s),
-- and upload K-1s and internal reports. No pipeline notes, Document Studio, wire
-- instructions, intake keys or team management. Follows the org's two-factor requirement.

create or replace function is_accountant(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(member_role_in(org)::text = 'accountant', false) and mfa_ok(org)
$$;

create policy funds_acct_read on funds for select using (is_accountant(organization_id));
create policy investors_acct_read on investors for select using (is_accountant(organization_id));
create policy subs_acct_read on subscriptions for select using (is_accountant(organization_id));
create policy commitments_acct_read on commitments for select using (is_accountant(organization_id));
create policy capital_acct_read on capital_transactions for select using (is_accountant(organization_id));
create policy calls_acct_read on capital_calls for select using (is_accountant(organization_id));
create policy alloc_acct_read on capital_call_allocations for select using (is_accountant(organization_id));
create policy compliance_acct_read on compliance_items for select using (is_accountant(organization_id));
create policy audit_acct_read on audit_events for select using (is_accountant(organization_id));
create policy documents_acct_read on documents for select using (
  is_accountant(organization_id) and category in ('tax', 'report', 'notice', 'offering', 'lpa', 'subscription'));

-- Uploads: K-1s and other tax forms (to one investor or internal), and internal reports.
create policy documents_acct_insert on documents for insert with check (
  is_accountant(organization_id) and uploaded_by = auth.uid()
  and ((category = 'tax' and visibility in ('investor', 'internal')) or (category = 'report' and visibility = 'internal')));
create policy docs_acct_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[2] = 'tax'
              and is_accountant(((storage.foldername(name))[1])::uuid));
