import { redirect } from 'next/navigation';

/** Server actions report results through the URL so pages stay server-rendered. */
export function back(path: string, kind: 'ok' | 'error', message: string): never {
  const sep = path.includes('?') ? '&' : '?';
  redirect(`${path}${sep}${kind}=${encodeURIComponent(message)}`);
}

export function errorText(e: unknown) {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Something went wrong.';
}

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <div className="alert error">{error}</div>;
  if (ok) return <div className="alert ok">{ok}</div>;
  return null;
}
