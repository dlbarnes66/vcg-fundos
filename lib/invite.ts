import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase/admin';

export async function appUrl() {
  const fixed = process.env.APP_URL?.trim().replace(/\/$/, '');
  if (fixed) return fixed;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

/**
 * One-time sign-in link for `email`. New people get an invite (creates their login);
 * existing people get a magic link. `session` is the inviter's own client, used to
 * check they're allowed to ask (owner/admin) before the service role is touched.
 */
export async function signInLink(session: SupabaseClient, orgId: string, email: string) {
  const { data: exists, error: checkErr } = await session.rpc('user_exists', { p_org: orgId, p_email: email });
  if (checkErr) throw checkErr;
  const type = exists ? 'magiclink' : 'invite';

  const { data, error } = await adminClient().auth.admin.generateLink({ type, email });
  if (error) throw error;
  const token = data.properties?.hashed_token;
  if (!token) throw new Error('Supabase did not return a sign-in link');

  const url = `${await appUrl()}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=${type}&next=/welcome`;
  return { url, isNew: !exists };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Sends through Resend when RESEND_API_KEY and MAIL_FROM are set. Returns false if email isn't configured. */
export async function sendInviteEmail(opts: { to: string; orgName: string; url: string; forInvestor: boolean; isNew: boolean }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return false;

  const what = opts.forInvestor ? 'your investor portal' : 'FundOS';
  const subject = opts.isNew ? `You're invited to ${opts.orgName} ${opts.forInvestor ? 'investor portal' : 'FundOS'}` : `Your sign-in link for ${what}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;color:#14213d">
  <h2 style="margin:0 0 12px">${esc(opts.orgName)}</h2>
  <p>${opts.isNew ? `You've been invited to ${what}.` : `Here is your sign-in link for ${what}.`}</p>
  <p><a href="${esc(opts.url)}" style="display:inline-block;background:#14213d;color:#fff;padding:10px 18px;border-radius:7px;text-decoration:none;font-weight:600">${opts.isNew ? 'Accept invite' : 'Sign in'}</a></p>
  <p style="color:#5b6475;font-size:13px">This link works once and expires soon. If you didn't expect it, you can ignore this email.</p>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [opts.to], subject, html }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Email failed to send (${res.status}). Copy the link instead.`);
  return true;
}

export type InviteState = { ok?: string; error?: string; link?: string };
