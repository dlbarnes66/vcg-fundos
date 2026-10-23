import Link from 'next/link';
import { getSession } from '@/lib/session';
import { signOut } from '@/app/login/actions';
import { fmtMoney, fmtPct } from '@/lib/money';
import { txnLabel, DOC_CATEGORIES } from '@/lib/labels';

/** Limited-partner view. Every query here is filtered by RLS to the signed-in
 *  investor's own records; the page never filters by investor id itself. */
export default async function Portal({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  const sp = await searchParams;
  const { supabase, user, orgName } = await getSession();

  const [{ data: me }, { data: accounts }, { data: funds }, { data: txns }, { data: docs }] = await Promise.all([
    supabase.from('investors').select('display_name').eq('portal_user_id', user.id).maybeSingle(),
    supabase.from('capital_accounts').select('*'),
    supabase.from('funds').select('id, name, pref_rate, terms'),
    supabase.from('capital_transactions').select('id, fund_id, kind, amount, effective_date, reverses_id').order('effective_date', { ascending: false }),
    supabase.from('documents').select('id, title, category, created_at').order('created_at', { ascending: false }),
  ]);
  const [{ data: subs }, { data: wires }] = await Promise.all([
    supabase.from('subscriptions').select('id, fund_id, status, amount, review_note'),
    supabase.from('fund_wire_instructions').select('fund_id, instructions, verify_phone'),
  ]);
  const SUB_LABEL: Record<string, [string, string, string]> = {
    in_progress: ['Not finished', 'warn', 'Continue subscription'],
    changes_requested: ['Changes requested', 'bad', 'Make changes'],
    submitted: ['Under review', '', 'View'],
    approved: ['Approved', 'good', 'View'],
    declined: ['Declined', 'bad', 'View'],
  };

  const fundName = (id: string) => funds?.find((f) => f.id === id)?.name ?? 'Fund';
  const reversed = new Set((txns ?? []).filter((t) => t.reverses_id).map((t) => t.reverses_id));
  const visibleTxns = (txns ?? []).filter((t) => t.kind !== 'reversal' && !reversed.has(t.id));
  const catLabel = (k: string) => DOC_CATEGORIES.find(([c]) => c === k)?.[1] ?? k;

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{ background: 'var(--navy)', color: '#fff' }}>
        <div className="row between" style={{ maxWidth: 1000, margin: '0 auto', padding: '14px 16px' }}>
          <div className="brand" style={{ padding: 0 }}><span className="brand-mark">VCG</span> Investor Portal</div>
          <form action={signOut}><button type="submit" className="ghost" style={{ color: '#fff', borderColor: '#4a5b85' }}>Sign out</button></form>
        </div>
      </header>

      <main className="stack" style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 16px' }}>
        <div>
          <h1>Welcome{me ? `, ${me.display_name}` : ''}</h1>
          <p className="sub" style={{ marginBottom: 0 }}>{orgName}</p>
        </div>

        {!me && <div className="alert error">Your login isn&apos;t linked to an investor account yet. Please contact the fund manager.</div>}

        {sp.submitted && <div className="alert ok">Thank you. Your subscription was submitted and the fund manager will review it shortly.</div>}

        {(subs ?? []).map((sb) => {
          const [label, tone, cta] = SUB_LABEL[sb.status];
          return (
            <div className="card" key={sb.id}>
              <div className="row between">
                <h2 style={{ margin: 0 }}>Subscribe: {fundName(sb.fund_id)}</h2>
                <span className={`pill ${tone}`}>{label}</span>
              </div>
              {sb.status === 'changes_requested' && <p className="small" style={{ color: 'var(--bad)' }}>{sb.review_note}</p>}
              <p className="small muted">{sb.amount ? `Amount: ${fmtMoney(sb.amount)}` : 'Investor information, W-9, offering documents, accreditation, and signature.'}</p>
              <Link className="btn" href={`/portal/subscribe/${sb.id}`}>{cta}</Link>
            </div>
          );
        })}

        {(wires ?? []).map((w) => (
          <div className="card" key={w.fund_id} style={{ borderColor: '#f0e0a8' }}>
            <h2>Funding instructions: {fundName(w.fund_id)}</h2>
            <div className="alert error" style={{ marginBottom: 12 }}>
              <strong>Wire fraud warning:</strong> before sending any money, call {w.verify_phone ? <strong>{w.verify_phone}</strong> : 'the fund manager at a number you already know'} to confirm these instructions by voice. We will never change wiring instructions by email.
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{w.instructions}</pre>
          </div>
        ))}

        {(accounts ?? []).map((a) => {
          const fund = funds?.find((f) => f.id === a.fund_id);
          return (
            <div className="card" key={a.fund_id}>
              <h2>{fundName(a.fund_id)}</h2>
              <div className="grid g4">
                <Stat label="Commitment" value={fmtMoney(a.committed)} />
                <Stat label="Contributed" value={fmtMoney(a.contributed)} hint={`Unfunded ${fmtMoney(a.unfunded)}`} />
                <Stat label="Distributions received" value={fmtMoney(Number(a.distributed) + Number(a.capital_returned))} />
                <Stat label="Preferred return" value={fund ? fmtPct(fund.pref_rate) : '—'} hint={String((fund?.terms as Record<string, string>)?.distribution_frequency ?? '')} />
              </div>
            </div>
          );
        })}

        <div className="card">
          <h2>Capital activity</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Type</th><th>Fund</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {visibleTxns.map((t) => (
                <tr key={t.id}><td>{t.effective_date}</td><td>{txnLabel(t.kind)}</td><td>{fundName(t.fund_id)}</td><td className="num">{fmtMoney(t.amount)}</td></tr>
              ))}
              {!visibleTxns.length && <tr><td colSpan={4} className="muted">No activity yet.</td></tr>}
            </tbody>
          </table></div>
        </div>

        <div className="card">
          <h2>Documents</h2>
          <div className="table-wrap"><table>
            <tbody>
              {(docs ?? []).map((d) => (
                <tr key={d.id}>
                  <td><a href={`/files/${d.id}`} target="_blank" rel="noopener">{d.title}</a></td>
                  <td className="muted">{catLabel(d.category)}</td>
                  <td className="num muted small">{new Date(d.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {!docs?.length && <tr><td className="muted">No documents shared yet.</td></tr>}
            </tbody>
          </table></div>
        </div>

        <p className="muted small">
          Figures shown are for information only. Official capital account statements and tax documents are issued by the fund and its accountants.
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: '1.3rem' }}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
