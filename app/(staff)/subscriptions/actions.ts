'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, CAPITAL_ROLES, WRITE_ROLES } from '@/lib/session';
import { back, errorText } from '@/lib/flash';
import { sendEmail } from '@/lib/notify';
import type { SupabaseClient } from '@supabase/supabase-js';

async function notifyInvestor(supabase: SupabaseClient, subId: string, kind: 'approved' | 'changes' | 'declined', note?: string) {
  const { data: s } = await supabase.from('subscriptions').select('investor_id, fund_id, amount').eq('id', subId).single();
  if (!s) return;
  const [{ data: email }, { data: fund }] = await Promise.all([
    supabase.rpc('portal_email', { p_investor_id: s.investor_id }),
    supabase.from('funds').select('name').eq('id', s.fund_id).single(),
  ]);
  if (!email) return;
  const f = fund?.name ?? 'the fund';
  const msg = {
    approved: { subject: `Your subscription to ${f} was accepted`, heading: 'Subscription accepted', lines: [`Your commitment of $${Number(s.amount ?? 0).toLocaleString('en-US')} to ${f} has been accepted.`, 'Funding instructions are in your investor portal. Before wiring, call the number shown there to confirm the instructions by voice.'] },
    changes: { subject: `Action needed on your ${f} subscription`, heading: 'A change is needed', lines: [`The fund manager asked for a change to your subscription: ${note ?? ''}`, 'Sign in to update it and sign again.'] },
    declined: { subject: `Your ${f} subscription`, heading: 'Subscription update', lines: [`Your subscription was not accepted. ${note ?? ''}`, 'Please contact the fund manager with any questions.'] },
  }[kind];
  await sendEmail({ to: [email as string], ...msg, button: { label: 'Open investor portal', path: '/portal' } });
}

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
    await notifyInvestor(supabase, subId, 'approved');
  } catch (e) {
    err = errorText(e);
  }
  back(`/subscriptions/${subId}`, err ? 'error' : 'ok', err ?? 'Approved. Accreditation verified and commitment accepted. The investor can now see the wire instructions.');
}

export async function returnSub(subId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const decline = formData.get('decline') === 'yes';
    const note = String(formData.get('note') ?? '');
    const { error } = await supabase.rpc('return_subscription', {
      p_sub: subId,
      p_status: decline ? 'declined' : 'changes_requested',
      p_note: note,
    });
    if (error) throw error;
    await notifyInvestor(supabase, subId, decline ? 'declined' : 'changes', note);
  } catch (e) {
    err = errorText(e);
  }
  back(`/subscriptions/${subId}`, err ? 'error' : 'ok', err ?? 'Sent back to the investor.');
}
