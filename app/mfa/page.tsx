import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { verifyMfa } from '@/app/account/security/actions';
import { signOut } from '@/app/login/actions';

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="auth">
      <div className="card stack">
        <div className="brand" style={{ color: 'var(--ink)', padding: 0 }}><span className="brand-mark">VCG</span> Verify it&apos;s you</div>
        <p className="small muted" style={{ margin: 0 }}>Enter the 6-digit code from your authenticator app.</p>
        {sp.error && <div className="alert error">That code didn&apos;t match. Use the current code from your app.</div>}
        <form action={verifyMfa} className="stack" style={{ gap: 10 }}>
          <input type="hidden" name="next" value={sp.next ?? '/'} />
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus
            style={{ fontSize: '1.4rem', letterSpacing: '.3em', textAlign: 'center' }} />
          <button type="submit">Verify</button>
        </form>
        <form action={signOut}><button type="submit" className="ghost" style={{ width: '100%' }}>Use a different account</button></form>
        <p className="small muted" style={{ margin: 0 }}>Lost your phone? Ask the fund owner to reset your two-factor.</p>
      </div>
    </div>
  );
}
