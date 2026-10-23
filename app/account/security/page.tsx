import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Enroll } from './enroll';
import { removeFactor } from './actions';

type Search = Promise<{ ok?: string; error?: string; removed?: string; required?: string }>;

export default async function SecurityPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: list } = await supabase.auth.mfa.listFactors();
  const factors = (list?.totp ?? []).filter((f) => f.status === 'verified');

  return (
    <div className="auth" style={{ alignItems: 'start', paddingTop: 48 }}>
      <div className="card stack" style={{ maxWidth: 520 }}>
        <div className="brand" style={{ color: 'var(--ink)', padding: 0 }}><span className="brand-mark">VCG</span> Sign-in security</div>
        <p className="small muted" style={{ margin: 0 }}>Signed in as <strong>{user.email}</strong></p>
        {sp.required && <div className="alert error">Your organization requires two-factor sign-in. Set it up to continue.</div>}
        {sp.ok && <div className="alert ok">Two-factor is on. You&apos;ll enter a code from your app each time you sign in.</div>}
        {sp.removed && <div className="alert ok">Authenticator removed.</div>}
        {sp.error && <div className="alert error">{sp.error}</div>}

        <h2 style={{ marginBottom: 0 }}>Two-factor authentication</h2>
        {factors.length > 0 ? (
          <>
            <p className="small" style={{ margin: 0 }}><span className="pill good">On</span> A code from your authenticator app is required at sign-in.</p>
            {factors.map((f) => (
              <div key={f.id} className="row between small">
                <span>{f.friendly_name ?? 'Authenticator app'} · added {new Date(f.created_at).toLocaleDateString()}</span>
                <form action={removeFactor.bind(null, f.id)}><button className="danger" type="submit">Remove</button></form>
              </div>
            ))}
          </>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              Adds a 6-digit code from your phone to every sign-in, so a stolen password alone can&apos;t get into your fund records.
            </p>
            <Enroll />
          </>
        )}
        <Link href="/" className="small">← Back to FundOS</Link>
      </div>
    </div>
  );
}
