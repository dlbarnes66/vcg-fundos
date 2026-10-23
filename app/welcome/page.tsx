import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { setPassword } from './actions';

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="auth">
      <form className="card stack" action={setPassword}>
        <div className="brand" style={{ color: 'var(--ink)', padding: 0 }}>
          <span className="brand-mark">VCG</span> Welcome
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Signed in as <strong>{user.email}</strong>. Set a password so you can sign in next time.
        </p>
        {error && <div className="alert error">{error}</div>}
        <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
        <label>Confirm password<input name="confirm" type="password" autoComplete="new-password" minLength={12} required /></label>
        <button type="submit">Save password and continue</button>
        <p className="muted small" style={{ margin: 0 }}>At least 12 characters. A passphrase of a few words works well.</p>
      </form>
    </div>
  );
}
