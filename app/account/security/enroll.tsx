'use client';

import { useActionState } from 'react';
import { startEnroll, confirmEnroll, type EnrollState } from './actions';

export function Enroll() {
  const [state, action, pending] = useActionState<EnrollState>(startEnroll, {});
  if (!state.factorId) {
    return (
      <form action={action} className="stack" style={{ gap: 8 }}>
        {state.error && <div className="alert error">{state.error}</div>}
        <div><button type="submit" disabled={pending}>{pending ? 'Starting…' : 'Set up authenticator app'}</button></div>
      </form>
    );
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="small" style={{ margin: 0 }}>
        1. Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy) and scan this code.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={state.qr} alt="QR code for your authenticator app" width={180} height={180} style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid var(--line)' }} />
      <p className="small muted" style={{ margin: 0 }}>Can&apos;t scan? Enter this key instead: <code>{state.secret}</code></p>
      <form action={confirmEnroll.bind(null, state.factorId)} className="form-grid">
        <label>2. Enter the 6-digit code it shows<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required /></label>
        <button type="submit">Turn on two-factor</button>
      </form>
    </div>
  );
}
