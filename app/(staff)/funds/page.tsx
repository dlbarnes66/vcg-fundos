import Link from 'next/link';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { getFunds, sum } from '@/lib/funds';
import { fmtMoney, fmtPct } from '@/lib/money';
import { Flash } from '@/lib/flash';

export default async function FundsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, orgId, role } = await requireStaff();
  const funds = await getFunds(supabase, orgId);
  const { data: accounts } = await supabase.from('capital_accounts').select('fund_id, committed, contributed').eq('organization_id', orgId);

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Funds</h1>
          <p className="sub" style={{ marginBottom: 0 }}>Offerings and their terms.</p>
        </div>
        {CAPITAL_ROLES.includes(role) && <Link className="btn" href="/funds/new">New fund</Link>}
      </div>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Fund</th><th>Status</th><th className="num">Target</th><th className="num">Committed</th><th className="num">Contributed</th><th className="num">Pref</th></tr></thead>
          <tbody>
            {funds.map((f) => {
              const acc = (accounts ?? []).filter((a) => a.fund_id === f.id);
              return (
                <tr key={f.id}>
                  <td><Link href={`/funds/${f.id}`}>{f.name}</Link><div className="small muted">{f.offering_type}</div></td>
                  <td><span className={`pill ${f.status === 'raising' ? 'good' : f.status === 'draft' ? 'warn' : ''}`}>{f.status.replace('_', ' ')}</span></td>
                  <td className="num">{fmtMoney(f.target_size, true)}</td>
                  <td className="num">{fmtMoney(sum(acc, 'committed'), true)}</td>
                  <td className="num">{fmtMoney(sum(acc, 'contributed'), true)}</td>
                  <td className="num">{fmtPct(f.pref_rate)}</td>
                </tr>
              );
            })}
            {!funds.length && <tr><td colSpan={6} className="muted">No funds yet. Create your first one.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
