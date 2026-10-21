'use client';

import { useActionState, useState } from 'react';
import { createKey, type CreateKeyState } from './actions';

export function CreateKeyForm() {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createKey, {});
  const [copied, setCopied] = useState(false);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <form action={action} className="form-grid">
        <label>Label<input name="label" defaultValue="CRM OS" required maxLength={80} /></label>
        <button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create API key'}</button>
      </form>
      {state.error && <div className="alert error">{state.error}</div>}
      {state.key && (
        <div className="note">
          <strong>Copy this key now. It won&apos;t be shown again.</strong>
          <div className="row" style={{ marginTop: 8 }}>
            <code style={{ wordBreak: 'break-all', flex: 1 }}>{state.key}</code>
            <button
              type="button"
              className="ghost"
              onClick={() => navigator.clipboard.writeText(state.key!).then(() => setCopied(true))}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="small" style={{ marginTop: 6 }}>Store it in CRM OS as an environment variable (for example FUNDOS_API_KEY), never in code.</div>
        </div>
      )}
    </div>
  );
}
