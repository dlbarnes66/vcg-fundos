import Link from 'next/link';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { getFunds } from '@/lib/funds';
import { fmtMoney } from '@/lib/money';
import { Flash } from '@/lib/flash';
import { createCall } from './actions';

const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'warn'], issued: ['Issued', 'good'], cancelled: ['Cancelled', ''] };

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, orgId, role } = await requireStaff();
  const canPost = CAPITAL_ROLES.includes(role);
  const funds = await getFunds(supabase, orgId);
  const [{ data: calls }, { data: status }, { data: accounts }] = await Promise.all([
    supabase.from('capital_calls').select('id, fund_id, call_number, call_date, due_date, total_amount, status, purpose').eq('organization_id', orgId).order('call_date', { ascending: false }),
    supabase.from('capital_call_status').select('call_id, funded, outstanding').eq('organization_id', orgId),
    supabase.from('capital_accounts').select('fund_id, unfunded').eq('organization_id', orgId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const fundName = (id: string) => funds.find((f) => f.id === id)?.name ?? '';
  const agg = (id: string) => (status ?? []).filter((s) => s.call_id === id).reduce((t, s) => ({ funded: t.funded + Number(s.funded), out: t.out + Number(s.outstanding) }), { funded: 0, out: 0 });
  const unfunded = (fid: string) => (accounts ?? []).filter((a) => a.fund_id === fid).reduce((t, a) => t + Math.max(0, Number(a.unfunded)), 0);

  return (
    <div className="stack">
      <div>
        <h1>Capital calls</h1>
        <p className="sub" style={{ marginBottom: 0 }}>Call capital pro rata by unfunded commitment, send notices, and track who has funded.</p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Call</th><th>Fund</th><th>Due</th><th className="num">Called</th><th className="num">Received</th><th className="num">Outstanding</th><th>Status</th></tr></thead>
          <tbody>
            {(calls ?? []).map((c) => {
              const a = agg(c.id);
              const [label, tone] = STATUS[c.status];
              const late = c.status === 'issued' && a.out > 0 && c.due_date < today;
              return (
                <tr key={c.id}>
                  <td><Link href={`/calls/${c.id}`}>No. {c.call_number}</Link><div className="small muted">{c.purpose.slice(0, 60)}</div></td>
                  <td className="small">{fundName(c.fund_id)}</td>
                  <td className={`small ${late ? 'overdue' : ''}`}>{c.due_date}{late ? ' (past due)' : ''}</td>
                  <td className="num">{fmtMoney(c.total_amount, true)}</td>
                  <td className="num">{c.status === 'issued' ? fmtMoney(a.funded, true) : '—'}</td>
                  <td className="num">{c.status === 'issued' ? fmtMoney(a.out, true) : '—'}</td>
                  <td><span className={`pill ${tone}`}>{label}</span></td>
                </tr>
              );
            })}
            {!calls?.length && <tr><td colSpan={7} className="muted">No capital calls yet.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {canPost && funds.length > 0 && (
        <form className="card" action={createCall}>
          <h2>New capital call</h2>
          <p className="small muted" style={{ marginTop: -6 }}>
            Creates a <strong>draft</strong> first so you can check every investor&apos;s share before anything is sent.
            Unfunded commitments: {funds.map((f) => `${f.name} ${fmtMoney(unfunded(f.id), true)}`).join(' · ')}.
          </p>
          <div className="form-grid">
            <label>Fund<select name="fund_id">{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <label>Total to call ($)<input name="total" inputMode="decimal" required placeholder="1000000" /></label>
            <label>Notice date<input type="date" name="call_date" required defaultValue={today} /></label>
            <label>Due date<input type="date" name="due_date" required /></label>
          </div>
          <label style={{ marginTop: 12 }}>Purpose (appears on the notice)<textarea name="purpose" required minLength={3} placeholder="e.g. Acquisition of a 24-unit multifamily property in Mobile, AL, including closing costs and reserves" /></label>
          <p className="small muted">Check the notice period your LPA requires (often 10 business days) when choosing the due date.</p>
          <button type="submit">Create draft</button>
        </form>
      )}
    </div>
  );
}
