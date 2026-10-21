'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, WRITE_ROLES, CAPITAL_ROLES } from '@/lib/session';
import { parseAmount } from '@/lib/money';
import { back, errorText } from '@/lib/flash';
import { STAGES, stageLabel } from '@/lib/labels';

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const optAmount = (f: FormData, k: string) => (str(f, k) ? parseAmount(f.get(k)) : null);

export async function createInvestor(formData: FormData) {
  let id: string | undefined;
  let err: string | undefined;
  try {
    const { supabase, orgId } = await requireRole(WRITE_ROLES);
    const name = str(formData, 'display_name');
    if (!name) throw new Error('Name is required');
    const { data, error } = await supabase
      .from('investors')
      .insert({
        organization_id: orgId,
        display_name: name,
        investor_type: str(formData, 'investor_type') ?? 'individual',
        email: str(formData, 'email'),
        phone: str(formData, 'phone'),
        source: str(formData, 'source'),
        target_amount: optAmount(formData, 'target_amount'),
        stage: 'qualified',
      })
      .select('id')
      .single();
    if (error) throw error;
    id = data.id;
  } catch (e) {
    err = errorText(e);
  }
  if (err) back('/investors', 'error', err);
  back(`/investors/${id}`, 'ok', 'Investor added.');
}

export async function updateInvestor(id: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, user, orgId } = await requireRole(WRITE_ROLES);
    const { data: before } = await supabase.from('investors').select('stage').eq('id', id).single();
    const stage = str(formData, 'stage');
    if (stage && !STAGES.some(([k]) => k === stage)) throw new Error('Unknown stage');

    const { error } = await supabase
      .from('investors')
      .update({
        display_name: str(formData, 'display_name'),
        investor_type: str(formData, 'investor_type'),
        email: str(formData, 'email'),
        phone: str(formData, 'phone'),
        source: str(formData, 'source'),
        stage,
        target_amount: optAmount(formData, 'target_amount'),
        next_follow_up: str(formData, 'next_follow_up'),
        accreditation_status: str(formData, 'accreditation_status'),
        accreditation_verified_at: str(formData, 'accreditation_verified_at'),
        accreditation_expires_at: str(formData, 'accreditation_expires_at'),
        notes: str(formData, 'notes'),
      })
      .eq('id', id);
    if (error) throw error;

    if (before && stage && before.stage !== stage) {
      await supabase.from('investor_activities').insert({
        organization_id: orgId,
        investor_id: id,
        kind: 'stage_change',
        body: `Stage: ${stageLabel(before.stage)} → ${stageLabel(stage)}`,
        created_by: user.id,
      });
    }
  } catch (e) {
    err = errorText(e);
  }
  revalidatePath('/investors');
  back(`/investors/${id}`, err ? 'error' : 'ok', err ?? 'Saved.');
}

export async function addActivity(id: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, user, orgId } = await requireRole(WRITE_ROLES);
    const body = str(formData, 'body');
    if (!body) throw new Error('Write something first');
    const { error } = await supabase.from('investor_activities').insert({
      organization_id: orgId,
      investor_id: id,
      kind: str(formData, 'kind') ?? 'note',
      body,
      created_by: user.id,
    });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/investors/${id}`, err ? 'error' : 'ok', err ?? 'Logged.');
}

export async function addCommitment(investorId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, orgId } = await requireRole(WRITE_ROLES);
    const fundId = str(formData, 'fund_id');
    const amount = parseAmount(formData.get('amount'));
    const { data: fund } = await supabase.from('funds').select('min_commitment').eq('id', fundId!).single();
    if (!fund) throw new Error('Fund not found');
    if (Number(amount) < Number(fund.min_commitment)) {
      throw new Error(`Below the fund minimum of $${Number(fund.min_commitment).toLocaleString()}`);
    }
    const { error } = await supabase.from('commitments').insert({
      organization_id: orgId,
      fund_id: fundId,
      investor_id: investorId,
      amount,
      status: 'pending',
      signed_at: str(formData, 'signed_at'),
    });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/investors/${investorId}`, err ? 'error' : 'ok', err ?? 'Commitment recorded as pending.');
}

export async function setCommitmentStatus(investorId: string, commitmentId: string, status: 'accepted' | 'cancelled') {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    if (status === 'accepted') {
      // 506(c): accept only from investors whose accreditation has been verified.
      const { data: inv } = await supabase
        .from('investors')
        .select('accreditation_status, accreditation_expires_at')
        .eq('id', investorId)
        .single();
      const today = new Date().toISOString().slice(0, 10);
      if (inv?.accreditation_status !== 'verified') throw new Error('Verify accreditation before accepting a commitment.');
      if (inv.accreditation_expires_at && inv.accreditation_expires_at < today) throw new Error('Accreditation has expired.');
    }
    const { error } = await supabase.from('commitments').update({ status }).eq('id', commitmentId);
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/investors/${investorId}`, err ? 'error' : 'ok', err ?? `Commitment ${status}.`);
}

export async function linkPortal(investorId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const email = str(formData, 'email');
    if (!email) throw new Error('Email is required');
    const { error } = await supabase.rpc('link_portal_user', { p_investor_id: investorId, p_email: email });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/investors/${investorId}`, err ? 'error' : 'ok', err ?? 'Portal access granted.');
}
