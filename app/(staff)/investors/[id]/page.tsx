import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, WRITE_ROLES, CAPITAL_ROLES } from '@/lib/session';
import { getFunds } from '@/lib/funds';
import { STAGES, INVESTOR_TYPES, ACCREDITATION, US_STATES, txnLabel } from '@/lib/labels';
import { fmtMoney } from '@/lib/money';
import { Flash } from '@/lib/flash';
import { prefEstimate, type CapitalEvent } from '@/lib/pref';
import { updateInvestor, addActivity, addCommitment, setCommitmentStatus, invitePortal, sendPortalLink } from '../actions';
import { InviteForm } from '@/app/invite-result';
import { startSubscription } from '../../subscriptions/actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function InvestorPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, orgId, role } = await requireStaff();
  const canWrite = WRITE_ROLES.includes(role);
  const canCapital = CAPITAL_ROLES.includes(role);

  const { data: inv } = await supabase.from('investors').select('*').eq('id', id).maybeSingle();
  if (!inv) notFound();

  const [funds, { data: commitments }, { data: activity }, { data: txns }, { data: accounts }] = await Promise.all([
    getFunds(supabase, orgId),
    supabase.from('commitments').select('id, fund_id, amount, status, signed_at').eq('investor_id', id).order('created_at'),
    supabase.from('investor_activities').select('id, kind, body, created_at').eq('investor_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('capital_transactions').select('id, fund_id, kind, amount, effective_date, memo, reverses_id').eq('investor_id', id).order('effective_date'),
    supabase.from('capital_accounts').select('*').eq('investor_id', id),
  ]);
  const { data: subs } = await supabase.from('subscriptions').select('id, fund_id, status, amount').eq('investor_id', id);
  const { data: opened } = await supabase.from('document_opens').select('document_id, title, opens, first_opened, last_opened').eq('investor_id', id).order('last_opened', { ascending: false });
  const openableFunds = funds.filter((f) => ['raising', 'draft'].includes(f.status) && !(subs ?? []).some((x) => x.fund_id === f.id));

  const fundName = (fid: string) => funds.find((f) => f.id === fid)?.name ?? 'Fund';
  const reversed = new Set((txns ?? []).filter((t) => t.reverses_id).map((t) => t.reverses_id));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="stack">
      <div>
        <Link href="/investors" className="small">← Pipeline</Link>
        <h1 style={{ marginTop: 8 }}>{inv.display_name}</h1>
        <p className="sub" style={{ marginBottom: 0 }}>
          {inv.email ?? 'No email'} · {inv.portal_user_id ? 'Portal access active' : 'No portal access'}
        </p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      {(accounts ?? []).map((a) => {
        const fund = funds.find((f) => f.id === a.fund_id);
        const events: CapitalEvent[] = (txns ?? [])
          .filter((t) => t.fund_id === a.fund_id && t.kind !== 'reversal' && !reversed.has(t.id))
          .map((t) => ({ kind: t.kind, amount: t.amount, date: t.effective_date }));
        const pref = prefEstimate(events, Number(fund?.pref_rate ?? 0), today);
        return (
          <div className="grid g4" key={a.fund_id}>
            <Kpi label={`Committed · ${fundName(a.fund_id)}`} value={fmtMoney(a.committed)} />
            <Kpi label="Contributed" value={fmtMoney(a.contributed)} hint={`Unfunded ${fmtMoney(a.unfunded)}`} />
            <Kpi label="Distributed" value={fmtMoney(Number(a.distributed) + Number(a.capital_returned))} hint={`Return of capital ${fmtMoney(a.capital_returned)}`} />
            <Kpi label="Unpaid pref (estimate)" value={fmtMoney(Number(pref.unpaid) / 100)} hint="Simple accrual, actual/365. Not an official figure." />
          </div>
        );
      })}

      <div className="grid g2">
        <form className="card" action={updateInvestor.bind(null, id)}>
          <h2>Profile & pipeline</h2>
          <fieldset disabled={!canWrite} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="form-grid">
              <label>Name<input name="display_name" defaultValue={inv.display_name} required /></label>
              <label>Type
                <select name="investor_type" defaultValue={inv.investor_type}>
                  {INVESTOR_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label>Stage
                <select name="stage" defaultValue={inv.stage}>
                  {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label>Email<input name="email" type="email" defaultValue={inv.email ?? ''} /></label>
              <label>Phone<input name="phone" defaultValue={inv.phone ?? ''} /></label>
              <label>Home state
                <select name="home_state" defaultValue={inv.home_state ?? ''}>
                  <option value="">Not set</option>
                  {US_STATES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label>Source<input name="source" defaultValue={inv.source ?? ''} /></label>
              <label>Target amount<input name="target_amount" inputMode="decimal" defaultValue={inv.target_amount ?? ''} /></label>
              <label>Next follow-up<input name="next_follow_up" type="date" defaultValue={inv.next_follow_up ?? ''} /></label>
              <label>Accreditation
                <select name="accreditation_status" defaultValue={inv.accreditation_status}>
                  {ACCREDITATION.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label>Verified on<input name="accreditation_verified_at" type="date" defaultValue={inv.accreditation_verified_at ?? ''} /></label>
              <label>Expires<input name="accreditation_expires_at" type="date" defaultValue={inv.accreditation_expires_at ?? ''} /></label>
            </div>
            <label style={{ marginTop: 12 }}>Notes<textarea name="notes" defaultValue={inv.notes ?? ''} /></label>
            {canWrite && <button type="submit" style={{ marginTop: 12 }}>Save</button>}
          </fieldset>
        </form>

        <div className="card">
          <h2>Activity</h2>
          {canWrite && (
            <form action={addActivity.bind(null, id)} className="stack" style={{ gap: 8, marginBottom: 12 }}>
              <div className="row">
                <select name="kind" defaultValue="note">
                  <option value="note">Note</option><option value="call">Call</option>
                  <option value="email">Email</option><option value="meeting">Meeting</option>
                </select>
                <button type="submit">Log</button>
              </div>
              <textarea name="body" placeholder="What happened? What's next?" required />
            </form>
          )}
          <ul className="timeline">
            {(activity ?? []).map((a) => (
              <li key={a.id}>
                <div className="when">{new Date(a.created_at).toLocaleString()} · {a.kind.replace('_', ' ')}</div>
                {a.body}
              </li>
            ))}
            {!activity?.length && <li className="muted">No activity yet.</li>}
          </ul>
        </div>
      </div>

      <div className="card">
        <h2>Commitments</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Fund</th><th className="num">Amount</th><th>Signed</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(commitments ?? []).map((c) => (
              <tr key={c.id}>
                <td>{fundName(c.fund_id)}</td>
                <td className="num">{fmtMoney(c.amount)}</td>
                <td>{c.signed_at ?? '—'}</td>
                <td><span className={`pill ${c.status === 'accepted' ? 'good' : c.status === 'cancelled' ? 'bad' : 'warn'}`}>{c.status}</span></td>
                <td className="num">
                  {canCapital && c.status === 'pending' && (
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <form action={setCommitmentStatus.bind(null, id, c.id, 'accepted')}><button type="submit">Accept</button></form>
                      <form action={setCommitmentStatus.bind(null, id, c.id, 'cancelled')}><button className="danger" type="submit">Cancel</button></form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!commitments?.length && <tr><td colSpan={5} className="muted">No commitments.</td></tr>}
          </tbody>
        </table></div>
        {canWrite && funds.length > 0 && (
          <form action={addCommitment.bind(null, id)} className="form-grid" style={{ marginTop: 14 }}>
            <label>Fund
              <select name="fund_id">{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            </label>
            <label>Amount<input name="amount" inputMode="decimal" required placeholder={String(Number(funds[0].min_commitment))} /></label>
            <label>Sub docs signed<input name="signed_at" type="date" /></label>
            <button type="submit">Record commitment</button>
          </form>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>Commitments start as pending. Owners and admins accept them once accreditation is verified and sub docs are countersigned.</p>
      </div>

      <div className="card">
        <div className="row between"><h2>Capital activity</h2>{canCapital && <Link href={`/capital?investor=${id}`} className="small">Post transaction →</Link>}</div>
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Type</th><th>Fund</th><th className="num">Amount</th><th>Memo</th></tr></thead>
          <tbody>
            {(txns ?? []).map((t) => (
              <tr key={t.id} className={reversed.has(t.id) ? 'reversed' : ''}>
                <td>{t.effective_date}</td><td>{txnLabel(t.kind)}</td><td>{fundName(t.fund_id)}</td>
                <td className="num">{fmtMoney(t.amount)}</td><td className="muted">{t.memo}</td>
              </tr>
            ))}
            {!txns?.length && <tr><td colSpan={5} className="muted">No capital activity.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <h2>Documents opened</h2>
        {opened?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Document</th><th className="num">Opens</th><th>First</th><th>Last</th></tr></thead>
            <tbody>
              {opened.map((o) => (
                <tr key={o.document_id}>
                  <td>{o.title}</td><td className="num">{o.opens}</td>
                  <td className="small muted">{new Date(o.first_opened).toLocaleString()}</td>
                  <td className="small muted">{new Date(o.last_opened).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="small muted" style={{ margin: 0 }}>{inv.portal_user_id ? 'Has not opened any documents in the portal yet.' : 'Tracked once they have portal access. Before that, use CRM OS data-room links, which track views too.'}</p>}
      </div>

      <div className="card">
        <h2>Subscription (onboarding)</h2>
        {(subs ?? []).map((x) => (
          <p key={x.id} className="small" style={{ margin: '0 0 6px' }}>
            {fundName(x.fund_id)}: <strong>{x.status.replace('_', ' ')}</strong>{x.amount ? ` · ${fmtMoney(x.amount)}` : ''} · <Link href={`/subscriptions/${x.id}`}>Open review →</Link>
          </p>
        ))}
        {!subs?.length && <p className="small muted" style={{ marginTop: -6 }}>No subscription yet. Open one and the investor completes it in their portal: profile, W-9, offering documents, accreditation letter, and e-signature.</p>}
        {canWrite && openableFunds.length > 0 && (
          <form action={startSubscription.bind(null, id)} className="row" style={{ marginTop: 8 }}>
            <select name="fund_id">{openableFunds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            <button type="submit" className="ghost">Open subscription</button>
          </form>
        )}
        {!inv.portal_user_id && <p className="small muted" style={{ marginBottom: 0 }}>They&apos;ll also need portal access (below) to fill it in.</p>}
      </div>

      {canCapital && (
        <div className="card">
          <h2>Investor portal access</h2>
          {inv.portal_user_id ? (
            <>
              <p className="muted small" style={{ marginTop: -6 }}>
                This investor can sign in to the portal and sees only their own commitments, capital activity and the documents you share with them.
              </p>
              <InviteForm action={sendPortalLink.bind(null, id)} submitLabel="Send a new sign-in link" className="row" />
            </>
          ) : (
            <>
              <p className="muted small" style={{ marginTop: -6 }}>
                Sends a one-time link. They set a password, then see only their own commitments, capital activity and shared documents.
              </p>
              <InviteForm action={invitePortal.bind(null, id)} submitLabel="Invite to portal">
                <label>Their email<input name="email" type="email" defaultValue={inv.email ?? ''} required /></label>
              </InviteForm>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: '1.3rem' }}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
