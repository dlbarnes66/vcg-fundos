'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Gen = (sectionId: string) => Promise<{ ok: boolean; error?: string }>;

/** Drafts sections one at a time (each is its own request, so nothing times out). */
export function GenerateAll({ sectionIds, generate, label }: { sectionIds: string[]; generate: Gen; label: string }) {
  const router = useRouter();
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setDone(0);
    for (const id of sectionIds) {
      const r = await generate(id);
      if (!r.ok) {
        setError(r.error ?? 'Drafting failed');
        break;
      }
      setDone((n) => n + 1);
      router.refresh();
    }
    setRunning(false);
    router.refresh();
  }

  if (!sectionIds.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <button type="button" onClick={run} disabled={running}>
        {running ? `Drafting… ${done} of ${sectionIds.length}` : label}
      </button>
      {running && <span className="small muted">About 20–40 seconds per section. Keep this tab open.</span>}
      {error && <div className="alert error">{error}</div>}
    </div>
  );
}

export function RegenerateOne({ sectionId, generate, hasContent }: { sectionId: string; generate: Gen; hasContent: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="row" style={{ gap: 6 }}>
      <button
        type="button"
        className="ghost"
        disabled={running}
        onClick={async () => {
          if (hasContent && !confirm('Replace this section with a new AI draft? Your edits to it will be lost.')) return;
          setRunning(true);
          setError(null);
          const r = await generate(sectionId);
          if (!r.ok) setError(r.error ?? 'Drafting failed');
          setRunning(false);
          router.refresh();
        }}
      >
        {running ? 'Drafting…' : hasContent ? 'Redraft with AI' : 'Draft with AI'}
      </button>
      {error && <span className="small" style={{ color: 'var(--bad)' }}>{error}</span>}
    </span>
  );
}
