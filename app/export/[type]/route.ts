import { NextResponse, type NextRequest } from 'next/server';
import { requireRole, CAPITAL_ROLES } from '@/lib/session';
import { toCsv } from '@/lib/csv';

type Spec = { table: string; select: string; order: string; columns: [string, string][] };

const EXPORTS: Record<string, Spec> = {
  investors: {
    table: 'investors', select: 'display_name, investor_type, email, phone, stage, accreditation_status, accreditation_verified_at, accreditation_expires_at, source, target_amount, created_at', order: 'display_name',
    columns: [['display_name', 'Investor'], ['investor_type', 'Type'], ['email', 'Email'], ['phone', 'Phone'], ['stage', 'Stage'], ['accreditation_status', 'Accreditation'], ['accreditation_verified_at', 'Verified on'], ['accreditation_expires_at', 'Expires'], ['source', 'Source'], ['target_amount', 'Target amount'], ['created_at', 'Added']],
  },
  commitments: {
    table: 'commitments', select: 'amount, status, signed_at, created_at, investors(display_name), funds(name)', order: 'created_at',
    columns: [['investor', 'Investor'], ['fund', 'Fund'], ['amount', 'Amount'], ['status', 'Status'], ['signed_at', 'Signed'], ['created_at', 'Recorded']],
  },
  capital: {
    table: 'capital_transactions', select: 'id, kind, amount, effective_date, memo, reverses_id, posted_at, investors(display_name), funds(name)', order: 'effective_date',
    columns: [['effective_date', 'Effective date'], ['investor', 'Investor'], ['fund', 'Fund'], ['kind', 'Type'], ['signed_amount', 'Amount (+in / -out of fund)'], ['amount', 'Amount (absolute)'], ['memo', 'Memo'], ['id', 'Transaction ID'], ['reverses_id', 'Reverses'], ['posted_at', 'Posted at']],
  },
  'capital-accounts': {
    table: 'capital_accounts', select: 'investor_id, fund_id, committed, contributed, unfunded, distributed, capital_returned, fees, net_invested_capital', order: 'investor_id',
    columns: [['investor', 'Investor'], ['fund', 'Fund'], ['committed', 'Committed'], ['contributed', 'Contributed'], ['unfunded', 'Unfunded'], ['distributed', 'Distributed'], ['capital_returned', 'Capital returned'], ['fees', 'Fees'], ['net_invested_capital', 'Net invested capital']],
  },
  subscriptions: {
    table: 'subscriptions', select: 'legal_name, investor_type, status, amount, accreditation_basis, signature_name, signed_at, submitted_at, reviewed_at, funds(name)', order: 'created_at',
    columns: [['legal_name', 'Legal name'], ['fund', 'Fund'], ['investor_type', 'Type'], ['status', 'Status'], ['amount', 'Amount'], ['accreditation_basis', 'Accreditation basis'], ['signature_name', 'Signed as'], ['signed_at', 'Signed at'], ['submitted_at', 'Submitted'], ['reviewed_at', 'Reviewed']],
  },
  audit: {
    table: 'audit_events', select: 'created_at, actor_id, action, target_table, target_id, detail', order: 'created_at',
    columns: [['created_at', 'When'], ['actor_id', 'User ID'], ['action', 'Action'], ['target_table', 'Table'], ['target_id', 'Record ID'], ['detail', 'Detail (JSON)']],
  },
};

/** CSV download for the CPA / auditor. Owners and admins only; RLS scopes rows to their organization. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const spec = EXPORTS[type];
  if (!spec) return new NextResponse('Unknown export', { status: 404 });
  let session;
  try {
    session = await requireRole(CAPITAL_ROLES); // also enforces two-factor when it applies
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'Not allowed', { status: 403 });
  }
  const { supabase, orgId } = session;

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(spec.table).select(spec.select).eq('organization_id', orgId).order(spec.order).range(from, from + 999);
    if (error) return new NextResponse(error.message, { status: 500 });
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }

  let names: Record<string, string> = {};
  let fundNames: Record<string, string> = {};
  if (type === 'capital-accounts') {
    const [{ data: inv }, { data: f }] = await Promise.all([
      supabase.from('investors').select('id, display_name').eq('organization_id', orgId),
      supabase.from('funds').select('id, name').eq('organization_id', orgId),
    ]);
    names = Object.fromEntries((inv ?? []).map((i) => [i.id, i.display_name]));
    fundNames = Object.fromEntries((f ?? []).map((x) => [x.id, x.name]));
  }
  // Money into the fund is +, out of the fund is -. A reversal flips the sign of what it reverses.
  const kindById = Object.fromEntries(rows.map((r) => [r.id as string, r.kind as string]));
  const direction = (k: string) => (k === 'distribution' || k === 'return_of_capital' ? -1 : 1);
  const out = rows.map((r) => {
    const inv = r.investors as { display_name?: string } | null;
    const fund = r.funds as { name?: string } | null;
    const sign = r.kind === 'reversal' ? -direction(kindById[r.reverses_id as string] ?? 'contribution') : direction(r.kind as string);
    return {
      ...r,
      investor: inv?.display_name ?? names[r.investor_id as string] ?? '',
      fund: fund?.name ?? fundNames[r.fund_id as string] ?? '',
      signed_amount: r.amount != null && r.kind ? Math.round(sign * Number(r.amount) * 100) / 100 : undefined,
    };
  });

  const file = `vcg-fundos-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(toCsv(out, spec.columns), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'no-store' },
  });
}
