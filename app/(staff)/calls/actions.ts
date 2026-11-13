'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole, CAPITAL_ROLES } from '@/lib/session';
import { back, errorText } from '@/lib/flash';
import { parseAmount, toCents } from '@/lib/money';
import { buildCallNotice } from '@/lib/call-notice';
import { sendEmail } from '@/lib/notify';

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export async function createCall(formData: FormData) {
  let id: string | undefined;
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const { data, error } = await supabase.rpc('create_capital_call', {
      p_fund: String(formData.get('fund_id') ?? ''),
      p_total: parseAmount(formData.get('total')),
      p_call_date: String(formData.get('call_date') ?? ''),
      p_due_date: String(formData.get('due_date') ?? ''),
      p_purpose: String(formData.get('purpose') ?? ''),
    });
    if (error) throw error;
    id = data as string;
  } catch (e) {
    err = errorText(e);
  }
  if (err) back('/calls', 'error', err);
  redirect(`/calls/${id}?ok=${encodeURIComponent('Draft created. Review the allocations, then issue.')}`);
}

/** Issues the call: a PDF notice per investor (in their portal) and an email to those with portal access. */
export async function issueCall(callId: string) {
  let err: string | undefined;
  let emailed = 0;
  try {
    const { supabase, orgId, user } = await requireRole(CAPITAL_ROLES);
    const { data: call } = await supabase.from('capital_calls').select('*').eq('id', callId).single();
    if (!call || call.status !== 'draft') throw new Error('Only a draft call can be issued');
    const [{ data: fund }, { data: allocs }, { data: accounts }, { data: wire }] = await Promise.all([
      supabase.from('funds').select('name, terms').eq('id', call.fund_id).single(),
      supabase.from('capital_call_allocations').select('id, investor_id, amount, unfunded_basis, investors(display_name, portal_user_id)').eq('call_id', callId),
      supabase.from('capital_accounts').select('investor_id, committed').eq('fund_id', call.fund_id),
      supabase.from('fund_wire_instructions').select('verify_phone').eq('fund_id', call.fund_id).maybeSingle(),
    ]);
    if (!wire) throw new Error('Add wire instructions on the fund page before issuing, so investors can fund the call.');
    const fundName = ((fund?.terms as Record<string, string> | undefined)?.fund_entity || fund?.name) ?? 'The Fund';

    // Mark issued first, so the investor-facing notices only exist for an issued call.
    const { error: issueErr } = await supabase.rpc('issue_capital_call', { p_call: callId });
    if (issueErr) throw issueErr;

    for (const a of allocs ?? []) {
      const inv = a.investors as unknown as { display_name: string; portal_user_id: string | null };
      const pdf = await buildCallNotice({
        fundName, callNumber: call.call_number, callDate: call.call_date, dueDate: call.due_date, purpose: call.purpose,
        investorName: inv.display_name, commitment: Number(accounts?.find((x) => x.investor_id === a.investor_id)?.committed ?? 0),
        unfundedBefore: Number(a.unfunded_basis), amount: Number(a.amount), totalCall: Number(call.total_amount), verifyPhone: wire.verify_phone,
      });
      const path = `${orgId}/calls/${callId}/${a.investor_id}.pdf`;
      const { error: upErr } = await supabase.storage.from('documents').upload(path, new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false });
      if (upErr) throw upErr;
      const { data: doc, error: dErr } = await supabase.from('documents').insert({
        organization_id: orgId, fund_id: call.fund_id, investor_id: a.investor_id, title: `Capital Call Notice No. ${call.call_number}`,
        category: 'notice', visibility: 'investor', storage_path: path, size_bytes: pdf.length, uploaded_by: user.id,
      }).select('id').single();
      if (dErr) throw dErr;
      await supabase.from('capital_call_allocations').update({ notice_document_id: doc.id, notified_at: new Date().toISOString() }).eq('id', a.id);

      if (inv.portal_user_id) {
        const { data: email } = await supabase.rpc('portal_email', { p_investor_id: a.investor_id });
        if (email && await sendEmail({
          to: [email as string],
          subject: `Capital Call No. ${call.call_number}: ${usd(Number(a.amount))} due ${call.due_date}`,
          heading: `Capital Call Notice No. ${call.call_number}`,
          lines: [
            `${fundName} has issued a capital call. Your share is ${usd(Number(a.amount))}, due by ${call.due_date}.`,
            'Your notice and the funding instructions are in your investor portal.',
            `Before wiring, call ${wire.verify_phone ?? 'the fund manager'} to confirm the instructions by voice. We never send or change wiring instructions by email.`,
          ],
          button: { label: 'Open investor portal', path: '/portal' },
        })) emailed++;
      }
    }
  } catch (e) {
    err = errorText(e);
  }
  revalidatePath(`/calls/${callId}`);
  back(`/calls/${callId}`, err ? 'error' : 'ok', err ?? `Issued. Notices are in each investor's portal${emailed ? `; ${emailed} emailed` : ' (email not set up, so none were emailed)'}.`);
}

/** Records a wire received against the call (a contribution linked to it). */
export async function recordReceipt(callId: string, investorId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, orgId, user } = await requireRole(CAPITAL_ROLES);
    const amount = parseAmount(formData.get('amount'));
    const effective = String(formData.get('effective_date') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) throw new Error('Choose the date the funds arrived');
    const [{ data: call }, { data: st }] = await Promise.all([
      supabase.from('capital_calls').select('fund_id, call_number').eq('id', callId).single(),
      supabase.from('capital_call_status').select('outstanding').eq('call_id', callId).eq('investor_id', investorId).single(),
    ]);
    if (!call || !st) throw new Error('Allocation not found');
    if (toCents(amount) > toCents(st.outstanding)) throw new Error(`That's more than the ${usd(Number(st.outstanding))} outstanding on this call.`);
    const { error } = await supabase.from('capital_transactions').insert({
      organization_id: orgId, fund_id: call.fund_id, investor_id: investorId, kind: 'contribution', amount,
      effective_date: effective, memo: `Capital Call No. ${call.call_number}${formData.get('memo') ? ` · ${formData.get('memo')}` : ''}`,
      posted_by: user.id, capital_call_id: callId,
    });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  revalidatePath(`/calls/${callId}`);
  back(`/calls/${callId}`, err ? 'error' : 'ok', err ?? 'Receipt recorded.');
}

export async function sendReminders(callId: string) {
  let err: string | undefined;
  let n = 0;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const { data: call } = await supabase.from('capital_calls').select('call_number, due_date, fund_id, status').eq('id', callId).single();
    if (!call || call.status !== 'issued') throw new Error('Reminders can be sent only for issued calls');
    const { data: rows } = await supabase.from('capital_call_status').select('investor_id, outstanding').eq('call_id', callId).gt('outstanding', 0);
    for (const r of rows ?? []) {
      const { data: email } = await supabase.rpc('portal_email', { p_investor_id: r.investor_id });
      if (!email) continue;
      if (await sendEmail({
        to: [email as string],
        subject: `Reminder: Capital Call No. ${call.call_number}, ${usd(Number(r.outstanding))} due ${call.due_date}`,
        heading: 'Capital call reminder',
        lines: [`Our records show ${usd(Number(r.outstanding))} outstanding on Capital Call No. ${call.call_number}, due ${call.due_date}. If you've already sent it, thank you; it may still be in transit.`, 'Funding instructions are in your investor portal. Confirm them by phone before wiring.'],
        button: { label: 'Open investor portal', path: '/portal' },
      })) {
        n++;
        await supabase.from('capital_call_allocations').update({ last_reminder_at: new Date().toISOString() }).eq('call_id', callId).eq('investor_id', r.investor_id);
      }
    }
  } catch (e) {
    err = errorText(e);
  }
  back(`/calls/${callId}`, err ? 'error' : 'ok', err ?? (n ? `Reminder emailed to ${n} investor(s).` : 'No reminders sent (nobody outstanding with portal access, or email not set up).'));
}

export async function cancelCall(callId: string) {
  let err: string | undefined;
  let deleted = false;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const { data: c } = await supabase.from('capital_calls').select('status').eq('id', callId).single();
    deleted = c?.status === 'draft';
    const { error } = await supabase.rpc('cancel_capital_call', { p_call: callId });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  if (!err && deleted) back('/calls', 'ok', 'Draft deleted.');
  back(`/calls/${callId}`, err ? 'error' : 'ok', err ?? 'Call cancelled.');
}
