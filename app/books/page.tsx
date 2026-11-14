import { requireAccountant } from '@/lib/session';
import { fmtMoney } from '@/lib/money';
import { Flash } from '@/lib/flash';
import { uploadTaxForm } from './actions';

const EXPORTS: [string, string][] = [
  ['capital', 'Capital transactions'], ['capital-accounts', 'Capital accounts'], ['commitments', 'Commitments'],
  ['investors', 'Investors'], ['audit', 'Audit log'],
];

export default async function BooksPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; year?: string }> }) {
  const sp = await searchParams;
  const { supabase, orgId } = await requireAccountant();
  const year = /^20\d\d$/.test(sp.year ?? '') ? sp.year! : String(new Date().getFullYear() - 1);

  const [{ data: funds }, { data: accounts }, { data: investors }, { data: subs }, { data: taxDocs }, { data: calls }, { data: callStatus }] = await Promise.all([
    supabase.from('funds').select('id, name').eq('organization_id', orgId),
    supabase.from('capital_accounts').select('*').eq('organization_id', orgId),
    supabase.from('investors').select('id, display_name, investor_type, home_state, portal_user_id').eq('organization_id', orgId).order('display_name'),
    supabase.from('subscriptions').select('investor_id, legal_name, address, residence_state').eq('organization_id', orgId),
    supabase.from('documents').select('id, investor_id, title, created_at').eq('organization_id', orgId).eq('category', 'tax').order('created_at', { ascending: false }),
    supabase.from('capital_calls').select('id, fund_id, call_number, due_date, total_amount, status').eq('organization_id', orgId).neq('status', 'draft').order('call_date', { ascending: false }),
    supabase.from('capital_call_status').select('call_id, funded, outstanding').eq('organization_id', orgId),
  ]);
  const fundName = (id: string) => funds?.find((f) => f.id === id)?.name ?? '';
  const invName = (id: string) => investors?.find((i) => i.id === id)?.display_name ?? '';
  const holders = (investors ?? []).filter((i) => (accounts ?? []).some((a) => a.investor_id === i.id && (Number(a.committed) > 0 || Number(a.contributed) > 0)));
  const docsFor = (id: string) => (taxDocs ?? []).filter((d) => d.investor_id === id);
  const sum = (k: string) => (accounts ?? []).reduce((t, a) => t + Number(a[k] ?? 0), 0);

  return (
    <>
      <div>
        <h1>Fund books</h1>
        <p className="sub" style={{ marginBottom: 0 }}>Read-only view of capital activity, plus tax documents. Upload K-1s here and they go straight to each investor&apos;s portal.</p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid g4">
        <div className="card kpi"><div className="label">Committed</div><div className="value">{fmtMoney(sum('committed'), true)}</div></div>
        <div className="card kpi"><div className="label">Contributed</div><div className="value">{fmtMoney(sum('contributed'), true)}</div></div>
        <div className="card kpi"><div className="label">Distributed</div><div className="value">{fmtMoney(sum('distributed') + sum('capital_returned'), true)}</div></div>
        <div className="card kpi"><div className="label">Investors</div><div className="value">{holders.length}</div></div>
      </div>

      <div className="card">
        <h2>Exports (CSV)</h2>
        <div className="row">{EXPORTS.map(([k, l]) => <a key={k} className="btn" href={`/export/${k}`}>{l}</a>)}</div>
        <p className="small muted" style={{ marginBottom: 0 }}>Capital transactions include a signed amount (+ into the fund, − out) and reversals, for reconciliation to the bank and general ledger.</p>
      </div>

      <div className="card">
        <h2>Capital accounts</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Investor</th><th>Fund</th><th className="num">Committed</th><th className="num">Contributed</th><th className="num">Distributed</th><th className="num">Capital returned</th><th className="num">Net invested</th></tr></thead>
          <tbody>
            {(accounts ?? []).map((a) => (
              <tr key={`${a.fund_id}${a.investor_id}`}>
                <td>{invName(a.investor_id)}</td><td className="small muted">{fundName(a.fund_id)}</td>
                <td className="num">{fmtMoney(a.committed)}</td><td className="num">{fmtMoney(a.contributed)}</td>
                <td className="num">{fmtMoney(a.distributed)}</td><td className="num">{fmtMoney(a.capital_returned)}</td>
                <td className="num">{fmtMoney(a.net_invested_capital)}</td>
              </tr>
            ))}
            {!accounts?.length && <tr><td colSpan={7} className="muted">No activity yet.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {(calls?.length ?? 0) > 0 && (
        <div className="card">
          <h2>Capital calls</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Call</th><th>Fund</th><th>Due</th><th className="num">Called</th><th className="num">Received</th><th className="num">Outstanding</th></tr></thead>
            <tbody>
              {calls!.map((c) => {
                const st = (callStatus ?? []).filter((s) => s.call_id === c.id);
                return (
                  <tr key={c.id}>
                    <td>No. {c.call_number}{c.status === 'cancelled' ? ' (cancelled)' : ''}</td><td className="small muted">{fundName(c.fund_id)}</td><td className="small">{c.due_date}</td>
                    <td className="num">{fmtMoney(c.total_amount)}</td>
                    <td className="num">{fmtMoney(st.reduce((t, s) => t + Number(s.funded), 0))}</td>
                    <td className="num">{fmtMoney(st.reduce((t, s) => t + Number(s.outstanding), 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="card" id="tax">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Tax documents by investor</h2>
          <form className="row small">
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Tax year
              <select name="year" defaultValue={year}>{[0, 1, 2, 3].map((n) => { const y = String(new Date().getFullYear() - n); return <option key={y} value={y}>{y}</option>; })}</select>
            </label>
            <button className="ghost" type="submit">Show</button>
          </form>
        </div>
        <p className="small muted">W-9s come from investor onboarding. K-1s you upload here are visible only to that investor (and the fund team), and they&apos;re emailed when email is set up.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Investor</th><th>For K-1</th><th>On file</th><th>Upload {year} form</th></tr></thead>
          <tbody>
            {holders.map((i) => {
              const sub = subs?.find((x) => x.investor_id === i.id);
              const docs = docsFor(i.id);
              const hasK1 = docs.some((d) => d.title.includes(`(${year})`));
              return (
                <tr key={i.id}>
                  <td><strong>{sub?.legal_name ?? i.display_name}</strong><div className="small muted">{i.investor_type}</div></td>
                  <td className="small">{sub?.address ?? '—'}<div className="muted">State: {sub?.residence_state ?? i.home_state ?? '—'}</div></td>
                  <td className="small">
                    {docs.length ? docs.map((d) => <div key={d.id}><a href={`/files/${d.id}`} target="_blank" rel="noopener">{d.title}</a></div>) : <span className="muted">None</span>}
                    {!hasK1 && <span className="pill warn">{year} K-1 not uploaded</span>}
                  </td>
                  <td>
                    <form action={uploadTaxForm.bind(null, i.id)} className="stack" style={{ gap: 6 }}>
                      <input type="hidden" name="year" value={year} />
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <select name="form" defaultValue="Schedule K-1"><option>Schedule K-1</option><option>Corrected Schedule K-1</option><option>Form 1099</option><option>State K-1</option></select>
                        <input type="file" name="file" accept=".pdf" required style={{ maxWidth: 190 }} />
                      </div>
                      <label className="row small" style={{ flexDirection: 'row', fontWeight: 400, color: 'var(--ink)' }}>
                        <input type="checkbox" name="notify" value="yes" defaultChecked={Boolean(i.portal_user_id)} disabled={!i.portal_user_id} /> Email investor{!i.portal_user_id ? ' (no portal access)' : ''}
                      </label>
                      <div><button type="submit" className="ghost">Upload</button></div>
                    </form>
                  </td>
                </tr>
              );
            })}
            {!holders.length && <tr><td colSpan={4} className="muted">No investors with commitments yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
