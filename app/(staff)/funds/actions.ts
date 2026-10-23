'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, CAPITAL_ROLES } from '@/lib/session';
import { parseAmount } from '@/lib/money';
import { back, errorText } from '@/lib/flash';

const STATUSES = ['draft', 'raising', 'closed', 'operating', 'wound_down'];

const text = (f: FormData, k: string, max = 200) => {
  const v = String(f.get(k) ?? '').trim();
  if (v.length > max) throw new Error(`${k.replace(/_/g, ' ')} is too long`);
  return v === '' ? null : v;
};

/** "7" or "7%" → "0.0700". Rates are entered as percentages. */
function pct(f: FormData, k: string, label: string) {
  const raw = String(f.get(k) ?? '').replace(/[%\s]/g, '');
  if (raw === '') return '0';
  // Two decimals max: the database stores rates to 4 places (7.25% → 0.0725).
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw) || Number(raw) > 100) throw new Error(`${label}: enter a percentage like 7 or 7.25`);
  return (Number(raw) / 100).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function fundFields(f: FormData) {
  const name = text(f, 'name');
  if (!name) throw new Error('Fund name is required');
  const status = text(f, 'status') ?? 'draft';
  if (!STATUSES.includes(status)) throw new Error('Unknown status');
  return {
    name,
    offering_type: text(f, 'offering_type') ?? 'Reg D 506(c)',
    status,
    target_size: parseAmount(f.get('target_size')),
    min_commitment: String(f.get('min_commitment') ?? '').trim() ? parseAmount(f.get('min_commitment')) : '0',
    pref_rate: pct(f, 'pref_rate', 'Preferred return'),
    mgmt_fee_rate: pct(f, 'mgmt_fee_rate', 'Management fee'),
    terms: {
      distribution_frequency: text(f, 'distribution_frequency', 40),
      hold_period_years: text(f, 'hold_period_years', 40),
      target_net_irr: text(f, 'target_net_irr', 40),
      target_equity_multiple: text(f, 'target_equity_multiple', 40),
      pref_compounding: text(f, 'pref_compounding', 20) ?? 'simple',
      gp_catch_up: text(f, 'gp_catch_up', 200),
      carry_split: text(f, 'carry_split', 200),
      notes: text(f, 'terms_notes', 2000),
      // Legal profile — the facts Document Studio drafts from. Blank = flagged as missing, never invented.
      legal_structure: text(f, 'legal_structure', 60),
      formation_state: text(f, 'formation_state', 60),
      fund_entity: text(f, 'fund_entity', 200),
      gp_entity: text(f, 'gp_entity', 200),
      manager_entity: text(f, 'manager_entity', 200),
      principals: text(f, 'principals', 1000),
      exemption: text(f, 'exemption', 40),
      strategy: text(f, 'strategy', 4000),
      target_markets: text(f, 'target_markets', 500),
      leverage_policy: text(f, 'leverage_policy', 1000),
      investor_eligibility: text(f, 'investor_eligibility', 500),
      term_extension: text(f, 'term_extension', 500),
      capital_call_terms: text(f, 'capital_call_terms', 1000),
      transfer_redemption: text(f, 'transfer_redemption', 1000),
      fund_counsel: text(f, 'fund_counsel', 200),
      administrator: text(f, 'administrator', 200),
      auditor: text(f, 'auditor', 200),
      other_disclosures: text(f, 'other_disclosures', 4000),
    },
  };
}

export async function createFund(formData: FormData) {
  let id: string | undefined;
  let err: string | undefined;
  try {
    const { supabase, orgId } = await requireRole(CAPITAL_ROLES);
    const { data, error } = await supabase
      .from('funds')
      .insert({ organization_id: orgId, ...fundFields(formData) })
      .select('id')
      .single();
    if (error) throw error;
    id = data.id;
  } catch (e) {
    err = errorText(e);
  }
  if (err) back('/funds/new', 'error', err);
  revalidatePath('/', 'layout');
  back(`/funds/${id}`, 'ok', 'Fund created.');
}

export async function updateFund(id: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const { error } = await supabase.from('funds').update(fundFields(formData)).eq('id', id);
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  revalidatePath('/', 'layout');
  back(`/funds/${id}`, err ? 'error' : 'ok', err ?? 'Fund terms saved. The change is recorded in the audit log.');
}
