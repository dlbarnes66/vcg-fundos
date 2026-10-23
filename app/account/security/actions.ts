'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { errorText } from '@/lib/flash';

export type EnrollState = { factorId?: string; qr?: string; secret?: string; error?: string };

/** Starts authenticator-app setup and returns the QR code to scan. */
export async function startEnroll(_prev: EnrollState): Promise<EnrollState> {
  try {
    const supabase = await createClient();
    // Clear any half-finished setups so they don't pile up.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    if (error) throw error;
    return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function confirmEnroll(factorId: string, formData: FormData) {
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) redirect(`/account/security?error=${encodeURIComponent("That code didn't match. Codes change every 30 seconds; try the current one.")}`);
  redirect('/account/security?ok=1');
}

export async function removeFactor(factorId: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) redirect(`/account/security?error=${encodeURIComponent(error.message.includes('AAL2') ? 'Sign in with your code first, then remove it.' : error.message)}`);
  redirect('/account/security?removed=1');
}

/** Step-up at sign-in: verify the 6-digit code for the user's authenticator. */
export async function verifyMfa(formData: FormData) {
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  const next = String(formData.get('next') ?? '/');
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const supabase = await createClient();
  const { data: list } = await supabase.auth.mfa.listFactors();
  const factor = list?.totp?.find((f) => f.status === 'verified');
  if (!factor) redirect('/account/security?required=1');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) redirect(`/mfa?error=1&next=${encodeURIComponent(safeNext)}`);
  redirect(safeNext);
}
