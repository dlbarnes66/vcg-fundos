-- Demo data with SYNTHETIC investors only. Never load real investor data into a dev project.
-- Run after bootstrap_owner(...):  select seed_demo('vcg');

create or replace function seed_demo(org_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid; fund uuid; i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid;
begin
  select id into org from organizations where slug = org_slug;
  if org is null then raise exception 'org % not found', org_slug; end if;

  insert into funds (organization_id, name, status, target_size, min_commitment, pref_rate, mgmt_fee_rate, terms)
  values (org, 'VCG Veterans Housing Fund I', 'raising', 10000000, 50000, 0.0700, 0.0200,
    jsonb_build_object(
      'distribution_frequency', 'quarterly',
      'hold_period_years', '7-10',
      'target_net_irr', '14-18%',
      'target_equity_multiple', '2.0-2.5x',
      'pref_compounding', 'simple',
      -- Fill these in from the PPM before using the distribution engine:
      'gp_catch_up', null,
      'carry_split', null
    ))
  returning id into fund;

  insert into investors (organization_id, display_name, investor_type, email, stage, accreditation_status, source, target_amount, next_follow_up)
  values
    (org, 'Sample Investor A',        'individual', 'a@example.com', 'funded',        'verified',    'Referral',   100000, null),
    (org, 'Sample Family Trust B',    'trust',      'b@example.com', 'committed',     'verified',    'Event',      250000, current_date + 7),
    (org, 'Sample Holdings LLC C',    'llc',        'c@example.com', 'docs_sent',     'pending',     'LinkedIn',   150000, current_date + 2),
    (org, 'Sample Investor D',        'individual', 'd@example.com', 'soft_circled',  'not_started', 'Website',    75000,  current_date + 5),
    (org, 'Sample Investor E',        'ira',        'e@example.com', 'contacted',     'not_started', 'Webinar',    50000,  current_date - 1);

  select id into i1 from investors where organization_id = org and email = 'a@example.com';
  select id into i2 from investors where organization_id = org and email = 'b@example.com';

  insert into commitments (organization_id, fund_id, investor_id, amount, status, signed_at) values
    (org, fund, i1, 100000, 'accepted', current_date - 60),
    (org, fund, i2, 250000, 'accepted', current_date - 10);

  insert into capital_transactions (organization_id, fund_id, investor_id, kind, amount, effective_date, memo)
  values (org, fund, i1, 'contribution', 100000, current_date - 45, 'Initial funding (demo)');
end $$;
revoke execute on function seed_demo(text) from public, anon, authenticated;
