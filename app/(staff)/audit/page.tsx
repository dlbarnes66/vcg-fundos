import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';

const TABLES: [string, string][] = [
  ['', 'Everything'], ['capital_transactions', 'Capital'], ['commitments', 'Commitments'], ['subscriptions', 'Subscriptions'],
  ['investors', 'Investors'], ['funds', 'Fund terms'], ['fund_wire_instructions', 'Wire instructions'], ['documents', 'Documents'],
  ['doc_drafts', 'Document Studio'], ['doc_comments', 'Counsel comments'],
];
const LABEL: Record<string, string> = Object.fromEntries(TABLES.filter(([k, l]) => k && l));
const IGNORE = new Set(['updated_at', 'touched_at']);
const PAGE = 100;

type Event = { id: number; created_at: string; actor_id: string | null; action: string; target_table: string; target_id: string | null; detail: Record<string, unknown> | null };

function summary(e: Event) {
  const d = e.detail ?? {};
  if (e.action === 'update' && d.before && d.after) {
    const b = d.before as Record<string, unknown>;
    const a = d.after as Record<string, unknown>;
    const changed = Object.keys(a).filter((k) => !IGNORE.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    return changed.slice(0, 6).map((k) => `${k}: ${short(b[k])} → ${short(a[k])}`).join('; ') || 'no visible change';
  }
  const r = d as Record<string, unknown>;
  const name = r.display_name ?? r.name ?? r.title ?? r.legal_name ?? r.kind ?? r.body ?? '';
  const amount = r.amount != null ? ` $${Number(r.amount).toLocaleString('en-US')}` : '';
  return `${short(name)}${amount}${e.action === 'purge_demo' ? ` (${String(r.investors_removed)} sample investors removed)` : ''}`;
}
const short = (v: unknown) => {
  const s = v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
};

type Search = Promise<{ t?: string; page?: string }>;

export default async function AuditPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { supabase, orgId, role } = await requireStaff();
  if (!CAPITAL_ROLES.includes(role)) redirect('/dashboard');
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  let q = supabase.from('audit_events').select('id, created_at, actor_id, action, target_table, target_id, detail', { count: 'exact' })
    .eq('organization_id', orgId).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  if (sp.t) q = q.eq('target_table', sp.t);
  const [{ data, count }, { data: members }] = await Promise.all([q, supabase.rpc('org_members', { p_org: orgId })]);
  const who = Object.fromEntries(((members ?? []) as { user_id: string; email: string }[]).map((m) => [m.user_id, m.email]));
  const events = (data ?? []) as Event[];
  const qs = (p: number) => `/audit?${new URLSearchParams({ ...(sp.t ? { t: sp.t } : {}), page: String(p) })}`;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Audit log</h1>
          <p className="sub" style={{ marginBottom: 0 }}>Every change to money, terms, investors, subscriptions and documents: who, when and what changed. Entries can&apos;t be edited or deleted.</p>
        </div>
        <a className="btn" href="/export/audit">Export CSV</a>
      </div>
      <div className="row">
        {TABLES.filter(([, l]) => l).map(([k, l]) => (
          <Link key={k || 'all'} href={k ? `/audit?t=${k}` : '/audit'} className={`pill ${sp.t === k || (!sp.t && !k) ? 'good' : ''}`}>{l}</Link>
        ))}
      </div>
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString()}</td>
                <td className="small">{e.actor_id ? who[e.actor_id] ?? 'Investor (portal)' : 'System / CRM OS'}</td>
                <td className="small"><strong>{e.action}</strong> · {LABEL[e.target_table] ?? e.target_table}</td>
                <td className="small muted">{summary(e)}</td>
              </tr>
            ))}
            {!events.length && <tr><td colSpan={4} className="muted">No entries.</td></tr>}
          </tbody>
        </table></div>
        <div className="row between small" style={{ marginTop: 12 }}>
          <span className="muted">{count ?? 0} entries</span>
          <span className="row">
            {page > 0 && <Link href={qs(page - 1)}>← Newer</Link>}
            {(page + 1) * PAGE < (count ?? 0) && <Link href={qs(page + 1)}>Older →</Link>}
          </span>
        </div>
      </div>
    </div>
  );
}
