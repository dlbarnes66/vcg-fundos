'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { errorText } from '@/lib/flash';
import { parseAmount } from '@/lib/money';
import { buildSignedPacket, sha256 } from '@/lib/esign';
import { sendEmail } from '@/lib/notify';

const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX = 20 * 1024 * 1024;

async function ctx(subId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: sub } = await supabase.from('subscriptions').select('*').eq('id', subId).maybeSingle();
  if (!sub) throw new Error('Subscription not found');
  return { supabase, user, sub };
}

function done(subId: string, step: string, err?: string): never {
  const q = err ? `error=${encodeURIComponent(err)}` : `ok=${encodeURIComponent(step)}`;
  redirect(`/portal/subscribe/${subId}?${q}#${step}`);
}

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function saveProfile(subId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase } = await ctx(subId);
    const { error } = await supabase.rpc('lp_save_profile', {
      p_sub: subId, p_legal_name: s(formData, 'legal_name'), p_type: s(formData, 'investor_type') || 'individual',
      p_address: s(formData, 'address'), p_phone: s(formData, 'phone'), p_entity_details: s(formData, 'entity_details'),
      p_signer_name: s(formData, 'signer_name'), p_signer_title: s(formData, 'signer_title'), p_beneficial_owners: s(formData, 'beneficial_owners'),
    });
    if (error) throw error;
  } catch (e) { err = errorText(e); }
  done(subId, 'profile', err);
}

/** Uploads into the investor's own private folder, then attaches it to the subscription. */
export async function uploadFile(subId: string, kind: 'w9' | 'accreditation', formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, user, sub } = await ctx(subId);
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) throw new Error('Choose a file');
    if (file.size > MAX) throw new Error('Files are limited to 20 MB');
    if (!ALLOWED.has(file.type)) throw new Error('Upload a PDF, PNG or JPEG');
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-100);
    const path = `${sub.organization_id}/lp/${sub.investor_id}/${crypto.randomUUID()}-${safe}`;
    const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw upErr;
    const { data: doc, error: dErr } = await supabase.from('documents').insert({
      organization_id: sub.organization_id, fund_id: sub.fund_id, investor_id: sub.investor_id,
      title: kind === 'w9' ? 'W-9' : 'Accredited investor verification',
      category: kind === 'w9' ? 'tax' : 'accreditation', visibility: 'investor',
      storage_path: path, size_bytes: file.size, uploaded_by: user.id,
    }).select('id').single();
    if (dErr) throw dErr;
    const { error } = await supabase.rpc('lp_attach', { p_sub: subId, p_kind: kind, p_document: doc.id });
    if (error) throw error;
  } catch (e) { err = errorText(e); }
  done(subId, kind, err);
}

export async function acknowledgeDocs(subId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, sub } = await ctx(subId);
    if (formData.get('confirm') !== 'yes') throw new Error('Tick the box to confirm you have read the documents');
    const { data: docs } = await supabase
      .from('documents').select('id, title')
      .eq('organization_id', sub.organization_id).eq('category', 'offering').eq('visibility', 'all_investors');
    const { error } = await supabase.rpc('lp_ack_documents', { p_sub: subId, p_docs: docs ?? [] });
    if (error) throw error;
  } catch (e) { err = errorText(e); }
  done(subId, 'documents', err);
}

export async function setAccreditation(subId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase } = await ctx(subId);
    const { error } = await supabase.rpc('lp_set_accreditation', { p_sub: subId, p_basis: s(formData, 'basis'), p_note: s(formData, 'note') });
    if (error) throw error;
  } catch (e) { err = errorText(e); }
  done(subId, 'accreditation', err);
}

/** Click-to-sign: fingerprints the exact template, appends a signature certificate, stores the packet. */
export async function signSubscription(subId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, user, sub } = await ctx(subId);
    if (formData.get('consent') !== 'yes') throw new Error('Tick the box to agree to sign electronically');
    const amount = parseAmount(formData.get('amount'));
    const signatureName = s(formData, 'signature_name');
    if (signatureName.length < 3) throw new Error('Type your full name to sign');

    const { data: fund } = await supabase.from('funds').select('name, subscription_doc_id, terms').eq('id', sub.fund_id).single();
    if (!fund?.subscription_doc_id) throw new Error("The fund manager hasn't published the subscription agreement yet.");
    const { data: tdoc } = await supabase.from('documents').select('title, storage_path').eq('id', fund.subscription_doc_id).single();
    if (!tdoc) throw new Error("You don't have access to the subscription agreement. Contact the fund manager.");
    const { data: blob, error: dlErr } = await supabase.storage.from('documents').download(tdoc.storage_path);
    if (dlErr || !blob) throw new Error("Couldn't open the subscription agreement.");
    const template = new Uint8Array(await blob.arrayBuffer());
    const fingerprint = sha256(template);

    const h = await headers();
    const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim();
    const ua = h.get('user-agent') ?? '';
    const signedAt = new Date().toISOString();
    const packet = await buildSignedPacket(template, {
      fundName: ((fund.terms as Record<string, string>)?.fund_entity || fund.name),
      documentTitle: tdoc.title, templateSha256: fingerprint,
      investorLegalName: sub.legal_name ?? '', signatureName, signerTitle: sub.signer_title,
      signerEmail: user.email ?? '', amount: `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      signedAtIso: signedAt, ip, userAgent: ua,
    });

    const path = `${sub.organization_id}/lp/${sub.investor_id}/${crypto.randomUUID()}-signed-subscription.pdf`;
    const { error: upErr } = await supabase.storage.from('documents').upload(path, new Blob([new Uint8Array(packet)], { type: 'application/pdf' }), { contentType: 'application/pdf' });
    if (upErr) throw upErr;
    const { data: doc, error: dErr } = await supabase.from('documents').insert({
      organization_id: sub.organization_id, fund_id: sub.fund_id, investor_id: sub.investor_id,
      title: `${tdoc.title} (signed)`, category: 'subscription', visibility: 'investor',
      storage_path: path, size_bytes: packet.length, uploaded_by: user.id,
    }).select('id').single();
    if (dErr) throw dErr;

    const { error } = await supabase.rpc('lp_sign', {
      p_sub: subId, p_amount: amount, p_signature_name: signatureName, p_sha256: fingerprint,
      p_packet: doc.id, p_ip: ip, p_user_agent: ua,
    });
    if (error) throw error;
  } catch (e) { err = errorText(e); }
  done(subId, 'sign', err);
}

export async function submitSubscription(subId: string) {
  let err: string | undefined;
  try {
    const { supabase } = await ctx(subId);
    const { error } = await supabase.rpc('lp_submit', { p_sub: subId });
    if (error) throw error;
    const { data: sub } = await supabase.from('subscriptions').select('legal_name, amount, fund_id').eq('id', subId).single();
    const { data: fund } = await supabase.from('funds').select('name').eq('id', sub?.fund_id ?? '').maybeSingle();
    const { data: emails } = await supabase.rpc('subscription_notify_emails', { p_sub: subId });
    await sendEmail({
      to: (emails ?? []) as string[],
      subject: `Subscription ready for review: ${sub?.legal_name ?? 'investor'}`,
      heading: 'New subscription to review',
      lines: [`${sub?.legal_name ?? 'An investor'} submitted a subscription to ${fund?.name ?? 'the fund'} for $${Number(sub?.amount ?? 0).toLocaleString('en-US')}.`, 'Review the W-9, accreditation letter and signed agreement, then approve or send it back.'],
      button: { label: 'Review subscription', path: `/subscriptions/${subId}` },
    });
  } catch (e) { err = errorText(e); }
  if (err) done(subId, 'submit', err);
  redirect('/portal?submitted=1');
}
