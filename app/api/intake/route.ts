import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * CRM OS → FundOS handoff.
 *
 *   POST /api/intake
 *   Authorization: Bearer fos_…
 *   { "name": "Jane Smith", "email": "jane@example.com", "external_id": "<crm contact id>",
 *     "phone": "...", "investor_type": "individual", "target_amount": 100000, "note": "..." }
 *
 * Creates the investor at 'qualified', or updates the existing one (matched by
 * external_id, then email) without moving its stage. All checks run inside the
 * intake_investor() database function; this route only shapes the request.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!key) return json({ error: 'Missing API key' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }
  const s = (k: string) => (typeof body[k] === 'string' && (body[k] as string).trim() !== '' ? (body[k] as string).trim() : null);
  const amount = body.target_amount == null || body.target_amount === '' ? null : Number(body.target_amount);
  if (amount !== null && !Number.isFinite(amount)) return json({ error: 'target_amount must be a number' }, 400);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('intake_investor', {
    p_key: key,
    p_source: s('source') ?? 'crm_os',
    p_external_id: s('external_id'),
    p_name: s('name'),
    p_email: s('email'),
    p_phone: s('phone'),
    p_investor_type: s('investor_type'),
    p_target_amount: amount,
    p_note: s('note'),
  });

  if (error) {
    if (error.message.includes('invalid_key')) return json({ error: 'Invalid or revoked API key' }, 401);
    return json({ error: error.message }, 422);
  }
  const result = data as { investor_id: string; created: boolean; stage: string };
  return json(result, result.created ? 201 : 200);
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
