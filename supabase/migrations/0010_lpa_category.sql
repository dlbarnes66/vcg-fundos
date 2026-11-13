-- Adds the "LPA / Operating Agreement" data-room category to what outside counsel can see.
-- (Investors' required reading in onboarding includes it too; that part is in the app.)
drop policy if exists documents_counsel_read on documents;
create policy documents_counsel_read on documents for select using (
  is_counsel(organization_id) and visibility <> 'investor' and category in ('offering', 'lpa', 'subscription'));
