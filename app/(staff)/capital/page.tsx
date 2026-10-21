import Link from 'next/link';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { getFunds, sum } from '@/lib/funds';
import { TXN_KINDS, txnLabel } from '@/lib/labels';
import { fmtMoney } from '@/lib/money';
import { Flash } from '@/lib/flash';
import { postTransaction, reverseTransaction } from './actions';

type Search = Promise<{ ok?: string; error?: string; investor?: string }>;

export default async function CapitalPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { supabase, orgId, role } = await requireStaff();
  const canPost = CAPITAL_ROLES.includes(role);
  const funds = await getFunds(supabase, orgId);

  let txQuery = supabase
    .from('capital_transactions')
    .select('id, fund_id, investor_id, kind, amount, effective_date, memo, reverses_id, posted_at')
    .eq('organization_id', orgId)
    .order('effective_date', { ascending: false })
    .order('posted_at', { ascending: false })
    .limit(200);
  if (sp.investor) txQuery = txQuery.eq('investor_id', sp.investor);

  const [{ data: txns }, { data: investors }, { data: accounts }] = await Promise.all([
    txQuery,
    supabase.from('investors').select('id, display_name').eq('organization_id', orgId).order('display_name'),
    supabase.from('capital_accounts').select('*').eq('organization_id', orgId),
  ]);

  const name = (id: string) => investors?.find((i) => i.id === id)?.display_name ?? '—';
  const reversed = new Set((txns ?? []).filter((t) => t.reverses_id).map((t) => t.reverses_id));
  const acc = accounts ?? [];

  return (
    <div className="stack">
      <div>
        <h1>Capital activity</h1>
        <p className="sub" style={{ marginBottom: 0 }}>
          Append-only record of contributions and distributions. Mistakes are corrected with reversals, never edits.
        </p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="card">
        <h2>Capital accounts</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Investor</th><th className="num">Committed</th><th className="num">Contributed</th><th className="num">Unfunded</th><th className="num">Distributed</th><th className="num">Capital returned</th></tr></thead>
          <tbody>
            {acc.map((a) => (
              <tr key={`${a.fund_id}-${a.investor_id}`}>
                <td><Link href={`/investors/${a.investor_id}`}>{name(a.investor_id)}</Link></td>
                <td className="num">{fmtMoney(a.committed)}</td>
                <td className="num">{fmtMoney(a.contributed)}</td>
                <td className="num">{fmtMoney(a.unfunded)}</td>
                <td className="num">{fmtMoney(a.distributed)}</td>
                <td className="num">{fmtMoney(a.capital_returned)}</td>
              </tr>
            ))}
            {acc.length > 0 && (
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                {['committed', 'contributed', 'unfunded', 'distributed', 'capital_returned'].map((k) => (
                  <td className="num" key={k}>{fmtMoney(sum(acc, k))}</td>
                ))}
              </tr>
            )}
            {!acc.length && <tr><td colSpan={6} className="muted">No accepted commitments yet.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {canPost && funds.length > 0 && (
        <form className="card" action={postTransaction}>
          <h2>Post a transaction</h2>
          <div className="form-grid">
            <label>Investor
              <select name="investor_id" defaultValue={sp.investor ?? ''} required>
                <option value="" disabled>Choose…</option>
                {(investors ?? []).map((i) => <option key={i.id} value={i.id}>{i.display_name}</option>)}
              </select>
            </label>
            <label>Fund
              <select name="fund_id">{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            </label>
            <label>Type
              <select name="kind">{TXN_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label>Amount<input name="amount" inputMode="decimal" required /></label>
            <label>Effective date<input name="effective_date" type="date" required /></label>
            <label>Memo<input name="memo" placeholder="Wire ref, quarter, etc." /></label>
            <button type="submit">Post</button>
          </div>
          <p className="note" style={{ marginBottom: 0, marginTop: 14 }}>
            Record money only after it has actually cleared the fund&apos;s bank account, and keep the fund&apos;s official books with your CPA or administrator. This log is the investor-level record that reconciles to them.
          </p>
        </form>
      )}

      <div className="card">
        <div className="row between">
          <h2>Transactions{sp.investor ? ` · ${name(sp.investor)}` : ''}</h2>
          {sp.investor && <Link href="/capital" className="small">Show all</Link>}
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Investor</th><th>Type</th><th className="num">Amount</th><th>Memo</th>{canPost && <th />}</tr></thead>
          <tbody>
            {(txns ?? []).map((t) => (
              <tr key={t.id} className={reversed.has(t.id) ? 'reversed' : ''}>
                <td>{t.effective_date}</td>
                <td>{name(t.investor_id)}</td>
                <td>{txnLabel(t.kind)}</td>
                <td className="num">{t.kind === 'reversal' ? '−' : ''}{fmtMoney(t.amount)}</td>
                <td className="muted">{t.memo}</td>
                {canPost && (
                  <td className="num">
                    {t.kind !== 'reversal' && !reversed.has(t.id) && (
                      <form action={reverseTransaction.bind(null, t.id)} className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <input name="reason" placeholder="Reason" required minLength={5} style={{ width: 130, padding: '4px 8px' }} />
                        <button className="danger" type="submit">Reverse</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!txns?.length && <tr><td colSpan={6} className="muted">No transactions.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
