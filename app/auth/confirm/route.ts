import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

const TYPES: EmailOtpType[] = ['invite', 'magiclink', 'recovery', 'email'];

/** Landing point for invite and sign-in links. Exchanges the one-time token for a session. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = url.searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, url.origin));
  if (!tokenHash || !type || !TYPES.includes(type)) return fail('link');

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return fail('expired');
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
