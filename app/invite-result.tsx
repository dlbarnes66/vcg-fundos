'use client';

import { useActionState, useState } from 'react';
import type { InviteState } from '@/lib/invite';

/** Shows the outcome of an invite: success, error, or a one-time link to copy. */
export function InviteResult({ state }: { state: InviteState }) {
  const [copied, setCopied] = useState(false);
  if (state.error) return <div className="alert error">{state.error}</div>;
  if (!state.ok) return null;
  return (
    <div className={state.link ? 'note' : 'alert ok'}>
      {state.ok}
      {state.link && (
        <div className="row" style={{ marginTop: 8, flexWrap: 'nowrap' }}>
          <code style={{ wordBreak: 'break-all', flex: 1, fontSize: '.75rem' }}>{state.link}</code>
          <button type="button" className="ghost" onClick={() => navigator.clipboard.writeText(state.link!).then(() => setCopied(true))}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {state.link && <div className="small" style={{ marginTop: 6 }}>Works once and expires in about an hour. Send it only to that person.</div>}
    </div>
  );
}

/** A form wired to an invite-style server action. */
export function InviteForm({
  action,
  children,
  submitLabel,
  className,
}: {
  action: (prev: InviteState, formData: FormData) => Promise<InviteState>;
  children?: React.ReactNode;
  submitLabel: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <div className="stack" style={{ gap: 10 }}>
      <form action={formAction} className={className ?? 'form-grid'}>
        {children}
        <button type="submit" disabled={pending}>{pending ? 'Working…' : submitLabel}</button>
      </form>
      <InviteResult state={state} />
    </div>
  );
}
