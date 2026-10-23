'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, CAPITAL_ROLES, WRITE_ROLES } from '@/lib/session';
import { back, errorText } from '@/lib/flash';

/** Opens a subscription for an investor in a fund. They complete it in their portal. */
export async function startSubscription(investorId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, orgId } = await requireRole(WRITE_ROLES);
    const fundId = String(formData.get('fund_id') ?? '');
    const { error } = await supabase.from('subscriptions').insert({ organization_id: orgId, fund_id: fundId, investor_id: investorId });
    if (error) throw error.code === '23505' ? new Error('This investor already has a subscription for that fund.') : error;
    await supabase.from('investor_activities').insert({ organization_id: orgId, investor_id: investorId, kind: 'onboarding', body: 'Subscription opened in the investor portal' });
  } catch (e) {
    err = errorText(e);
  }
  revalidatePath(`/investors/${investorId}`);
  back(`/investors/${investorId}`, err ? 'error' : 'ok', err ?? 'Subscription opened. The investor will see it when they sign in to the portal.');
}

export async function approve(subId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    if (formData.get('reviewed') !== 'yes') throw new Error('Confirm you reviewed the accreditation evidence and signed agreement.');
    const { error } = await supabase.rpc('approve_subscription', {
      p_sub: subId,
      p_accreditation_expires: String(formData.get('expires') ?? '') || null,
      p_note: String(formData.get('note') ?? '').trim() || null,
    });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/subscriptions/${subId}`, err ? 'error' : 'ok', err ?? 'Approved. Accreditation verified and commitment accepted. The investor can now see the wire instructions.');
}

export async function returnSub(subId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const { error } = await supabase.rpc('return_subscription', {
      p_sub: subId,
      p_status: formData.get('decline') === 'yes' ? 'declined' : 'changes_requested',
      p_note: String(formData.get('note') ?? ''),
    });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/subscriptions/${subId}`, err ? 'error' : 'ok', err ?? 'Sent back to the investor.');
}
