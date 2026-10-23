// Claude via the Anthropic API (plain HTTPS). SERVER ONLY.
//   ANTHROPIC_API_KEY  sk-ant-...  (console.anthropic.com → API Keys) — Vercel type: Secret
//   ANTHROPIC_MODEL    optional model ID; otherwise the newest available Sonnet is used.

const API = 'https://api.anthropic.com/v1';

export const aiReady = () => Boolean(process.env.ANTHROPIC_API_KEY);

function headers() {
  if (typeof window !== 'undefined') throw new Error('AI calls are server-only');
  return {
    'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
}

let cachedModel: string | null = null;
async function model() {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  if (cachedModel) return cachedModel;
  const res = await fetch(`${API}/models?limit=100`, { headers: headers(), cache: 'no-store' });
  if (res.ok) {
    const ids = ((await res.json()).data ?? []).map((m: { id: string }) => m.id) as string[];
    cachedModel = ids.find((id) => /sonnet/i.test(id)) ?? ids[0] ?? null;
  }
  if (!cachedModel) throw new Error("Couldn't find an available Claude model. Set ANTHROPIC_MODEL in Vercel.");
  return cachedModel;
}

export type Block =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string }
  | { type: 'document'; source: { type: 'text'; media_type: 'text/plain'; data: string }; title?: string };

export async function claude(opts: { system: string; content: Block[]; maxTokens?: number }) {
  if (!aiReady()) throw new Error('AI is not connected. Add ANTHROPIC_API_KEY in Vercel (type: Secret).');
  const res = await fetch(`${API}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: await model(),
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      messages: [{ role: 'user', content: opts.content }],
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.');
    if (res.status === 429) throw new Error('Claude is busy or the account hit its rate limit. Try again in a minute.');
    throw new Error(`Claude request failed (${res.status}). ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content: { type: string; text?: string }[]; stop_reason?: string };
  const text = json.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, truncated: json.stop_reason === 'max_tokens' };
}
