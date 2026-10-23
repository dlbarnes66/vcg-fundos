import { signIn } from './actions';

const MESSAGES: Record<string, string> = {
  invalid: 'Email or password is incorrect.',
  'no-access': 'Your account is not linked to an organization yet. Ask the fund owner to add you.',
  expired: 'That link has expired or was already used. Ask the fund manager to send a new one.',
  link: 'That sign-in link is incomplete. Try opening it again from the email.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="auth">
      <form className="card stack" action={signIn}>
        <div className="brand" style={{ color: 'var(--ink)', padding: 0 }}>
          <span className="brand-mark">VCG</span> FundOS
        </div>
        {error && <div className="alert error">{MESSAGES[error] ?? 'Sign-in failed.'}</div>}
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit">Sign in</button>
        <p className="muted small" style={{ margin: 0 }}>
          Access is by invitation only. Investors receive a login from the fund manager.
        </p>
      </form>
    </div>
  );
}
