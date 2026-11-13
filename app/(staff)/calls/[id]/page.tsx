import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { fmtMoney } from '@/lib/money';
import { Flash } from '@/lib/flash';
import { issueCall, recordReceipt, sendReminders, cancelCall } from '../actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function CallPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, role } = await requireStaff();
  const canPost = CAPITAL_ROLES.includes(role);
  const { data: call } = await supabase.from('capital_calls').select('*').eq('id', id).maybeSingle();
  if (!call) notFound();
  const [{ data: fund }, { data: rows }, { data: investors }, { data: wire }] = await Promise.all([
    supabase.from('funds').select('name').eq('id', call.fund_id).single(),
    supabase.from('capital_call_status').select('*').eq('call_id', id),
    supabase.from('investors').select('id, display_name, portal_user_id').eq('organization_id', call.organization_id),
    supabase.from('fund_wire_instructions').select('fund_id').eq('fund_id', call.fund_id).maybeSingle(),
  ]);
  const inv = (iid: string) => investors?.find((i) => i.id === iid);
  const list = [...(rows ?? [])].sort((a, b) => (inv(a.investor_id)?.display_name ?? '').localeCompare(inv(b.investor_id)?.display_name ?? ''));
  const funded = list.reduce((t, r) => t + Number(r.funded), 0);
  const outstanding = list.reduce((t, r) => t + Number(r.outstanding), 0);
  const today = new Date().toISOString().slice(0, 10);
  const pct = Number(call.total_amount) ? Math.round((funded / Number(call.total_amount)) * 100) : 0;

  return (
    <div className="stack">
      <div>
        <Link href="/calls" className="small">← Capital calls</Link>
        <h1 style={{ marginTop: 8 }}>Capital Call No. {call.call_number}</h1>
        <p className="sub" style={{ marginBottom: 0 }}>{fund?.name} · notice {call.call_date} · due <span className={call.status === 'issued' && outstanding > 0 && call.due_date < today ? 'overdue' : ''}>{call.due_date}</span> · {call.status}</p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid g4">
        <div className="card kpi"><div className="label">Called</div><div className="value">{fmtMoney(call.total_amount, true)}</div><div className="hint">{list.length} investors</div></div>
        <div className="card kpi"><div className="label">Received</div><div className="value">{fmtMoney(funded, true)}</div><div className="bar"><span style={{ width: `${pct}%` }} /></div></div>
        <div className="card kpi"><div className="label">Outstanding</div><div className="value">{fmtMoney(outstanding, true)}</div><div className="hint">{list.filter((r) => Number(r.outstanding) > 0).length} investors</div></div>
        <div className="card kpi"><div className="label">Purpose</div><div className="small" style={{ marginTop: 8 }}>{call.purpose}</div></div>
      </div>

      {canPost && call.status === 'draft' && (
        <div className="card stack" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>Review, then issue</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Issuing puts a PDF notice in each investor&apos;s portal and emails those with portal access. The notice never contains bank details; it points to the funding instructions in the portal, with the fraud warning.
          </p>
          {!wire && <div className="alert error" style={{ margin: 0 }}>Add wire instructions on the <Link href={`/funds/${call.fund_id}#onboarding`}>fund page</Link> first.</div>}
          <div className="row">
            <form action={issueCall.bind(null, id)}><button type="submit" disabled={!wire}>Issue call and send notices</button></form>
            <form action={cancelCall.bind(null, id)}><button className="danger" type="submit">Delete draft</button></form>
          </div>
        </div>
      )}

      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Investors</h2>
          {canPost && call.status === 'issued' && outstanding > 0 && (
            <form action={sendReminders.bind(null, id)}><button className="ghost" type="submit">Email reminders to unpaid investors</button></form>
          )}
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Investor</th><th className="num">Share</th><th className="num">Received</th><th className="num">Outstanding</th><th>Notice</th>{canPost && call.status === 'issued' && <th>Record a wire</th>}</tr></thead>
          <tbody>
            {list.map((r) => {
              const i = inv(r.investor_id);
              const out = Number(r.outstanding);
              return (
                <tr key={r.investor_id}>
                  <td><Link href={`/investors/${r.investor_id}`}>{i?.display_name}</Link>{!i?.portal_user_id && <div className="small muted">No portal access: send the notice yourself</div>}</td>
                  <td className="num">{fmtMoney(r.amount)}</td>
                  <td className="num">{fmtMoney(r.funded)}</td>
                  <td className={`num ${out > 0 && call.due_date < today && call.status === 'issued' ? 'overdue' : ''}`}>{out > 0 ? fmtMoney(out) : <span className="pill good">Paid</span>}</td>
                  <td className="small">
                    {r.notice_document_id ? <a href={`/files/${r.notice_document_id}`} target="_blank" rel="noopener">PDF</a> : '—'}
                    {r.last_reminder_at && <div className="muted">Reminded {new Date(r.last_reminder_at).toLocaleDateString()}</div>}
                  </td>
                  {canPost && call.status === 'issued' && (
                    <td>
                      {out > 0 && (
                        <form action={recordReceipt.bind(null, id, r.investor_id)} className="row" style={{ flexWrap: 'nowrap' }}>
                          <input name="amount" inputMode="decimal" defaultValue={out.toFixed(2)} style={{ width: 110 }} required />
                          <input type="date" name="effective_date" defaultValue={today} required />
                          <button type="submit" className="ghost">Received</button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Record a wire only after it has cleared the fund&apos;s bank account. Mistakes are fixed with a reversal on the Capital activity page.
        </p>
      </div>

      {canPost && call.status === 'issued' && funded === 0 && (
        <form action={cancelCall.bind(null, id)}><button className="danger" type="submit">Cancel this call</button></form>
      )}
    </div>
  );
}
