'use server';

import { requireRole, CAPITAL_ROLES } from '@/lib/session';
import { parseAmount, toCents } from '@/lib/money';
import { back, errorText } from '@/lib/flash';
import { TXN_KINDS } from '@/lib/labels';

export async function postTransaction(formData: FormData) {
  let err: string | undefined;
  const investorId = String(formData.get('investor_id') ?? '');
  const returnTo = `/capital?investor=${investorId}`;
  try {
    const { supabase, user, orgId } = await requireRole(CAPITAL_ROLES);
    const fundId = String(formData.get('fund_id') ?? '');
    const kind = String(formData.get('kind') ?? '');
    const amount = parseAmount(formData.get('amount'));
    const effectiveDate = String(formData.get('effective_date') ?? '');
    const memo = String(formData.get('memo') ?? '').trim() || null;
    if (!TXN_KINDS.some(([k]) => k === kind)) throw new Error('Choose a transaction type');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error('Choose an effective date');
    if (!investorId || !fundId) throw new Error('Choose an investor and fund');

    if (kind === 'contribution') {
      const { data: acct } = await supabase
        .from('capital_accounts')
        .select('committed, contributed')
        .eq('fund_id', fundId)
        .eq('investor_id', investorId)
        .maybeSingle();
      const committed = toCents(acct?.committed ?? 0);
      const contributed = toCents(acct?.contributed ?? 0);
      if (committed === 0n) throw new Error('This investor has no accepted commitment to this fund.');
      if (contributed + toCents(amount) > committed) {
        throw new Error('Contribution would exceed the accepted commitment.');
      }
    }

    const { error } = await supabase.from('capital_transactions').insert({
      organization_id: orgId,
      fund_id: fundId,
      investor_id: investorId,
      kind,
      amount,
      effective_date: effectiveDate,
      memo,
      posted_by: user.id,
    });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(returnTo, err ? 'error' : 'ok', err ?? 'Transaction posted.');
}

export async function reverseTransaction(txnId: string, formData: FormData) {
  let err: string | undefined;
  let investorId = '';
  try {
    const { supabase, user } = await requireRole(CAPITAL_ROLES);
    const reason = String(formData.get('reason') ?? '').trim();
    if (reason.length < 5) throw new Error('Give a reason for the reversal (at least 5 characters).');
    const { data: orig, error: readErr } = await supabase
      .from('capital_transactions')
      .select('organization_id, fund_id, investor_id, amount')
      .eq('id', txnId)
      .single();
    if (readErr || !orig) throw readErr ?? new Error('Transaction not found');
    investorId = orig.investor_id;
    const { error } = await supabase.from('capital_transactions').insert({
      ...orig,
      kind: 'reversal',
      reverses_id: txnId,
      effective_date: new Date().toISOString().slice(0, 10),
      memo: `Reversal: ${reason}`,
      posted_by: user.id,
    });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/capital${investorId ? `?investor=${investorId}` : ''}`, err ? 'error' : 'ok', err ?? 'Transaction reversed.');
}
