import type { SupabaseClient } from '@supabase/supabase-js';

export type Fund = {
  id: string;
  name: string;
  offering_type: string;
  status: string;
  target_size: string;
  min_commitment: string;
  pref_rate: string;
  mgmt_fee_rate: string;
  terms: Record<string, unknown>;
};

/** v1 is single-fund in practice; the schema already supports many. */
export async function getFunds(supabase: SupabaseClient, orgId: string) {
  const { data } = await supabase
    .from('funds')
    .select('id, name, offering_type, status, target_size, min_commitment, pref_rate, mgmt_fee_rate, terms')
    .eq('organization_id', orgId)
    .order('created_at');
  return (data ?? []) as Fund[];
}

export const sum = (rows: Record<string, unknown>[], key: string) =>
  rows.reduce((t, r) => t + Number(r[key] ?? 0), 0);
