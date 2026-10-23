import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { fmtMoney } from '@/lib/money';

const SUB_STATUS: Record<string, [string, string]> = {
  in_progress: ['Investor filling in', ''],
  submitted: ['Ready for review', 'warn'],
  changes_requested: ['Changes requested', 'bad'],
  approved: ['Approved', 'good'],
  declined: ['Declined', 'bad'],
};

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const { supabase, orgId } = await requireStaff();
  let q = supabase
    .from('subscriptions')
    .select('id, status, amount, legal_name, submitted_at, updated_at, investor_id, fund_id, profile_done_at, w9_document_id, docs_ack_at, accreditation_document_id, signed_at')
    .eq('organization_id', orgId)
    .order('updated_at', { ascending: false });
  if (sp.show !== 'all') q = q.in('status', ['submitted', 'in_progress', 'changes_requested']);
  const [{ data: subs }, { data: investors }, { data: funds }] = await Promise.all([
    q,
    supabase.from('investors').select('id, display_name').eq('organization_id', orgId),
    supabase.from('funds').select('id, name').eq('organization_id', orgId),
  ]);
  const inv = (id: string) => investors?.find((i) => i.id === id)?.display_name ?? '—';
  const fund = (id: string) => funds?.find((f) => f.id === id)?.name ?? '—';
  const order = { submitted: 0, changes_requested: 1, in_progress: 2, approved: 3, declined: 4 } as Record<string, number>;
  const rows = [...(subs ?? [])].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Subscriptions</h1>
          <p className="sub" style={{ marginBottom: 0 }}>Investor onboarding: review submitted subscriptions, verify accreditation, accept commitments.</p>
        </div>
        <Link href={sp.show === 'all' ? '/subscriptions' : '/subscriptions?show=all'} className="small">{sp.show === 'all' ? 'Open only' : 'Show approved and declined'}</Link>
      </div>
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Investor</th><th>Fund</th><th>Progress</th><th className="num">Amount</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((s) => {
              const n = [s.profile_done_at, s.w9_document_id, s.docs_ack_at, s.accreditation_document_id, s.signed_at].filter(Boolean).length;
              const [label, tone] = SUB_STATUS[s.status];
              return (
                <tr key={s.id}>
                  <td><Link href={`/subscriptions/${s.id}`}>{s.legal_name || inv(s.investor_id)}</Link></td>
                  <td className="muted">{fund(s.fund_id)}</td>
                  <td className="small">{n} of 5 steps</td>
                  <td className="num">{s.amount ? fmtMoney(s.amount, true) : '—'}</td>
                  <td><span className={`pill ${tone}`}>{label}</span></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="muted">Nothing here. Open a subscription from an investor&apos;s record, or invite them to the portal.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
