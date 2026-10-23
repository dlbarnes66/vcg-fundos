import Link from 'next/link';
import { requireStaff, WRITE_ROLES, CAPITAL_ROLES } from '@/lib/session';
import { getFunds } from '@/lib/funds';
import { US_STATES } from '@/lib/labels';
import { Flash } from '@/lib/flash';
import { completeItem, reopenItem, addItem, deleteItem } from './actions';

type Item = {
  id: string; fund_id: string; kind: string; state: string | null; title: string; due_date: string; basis: string | null;
  status: string; reference: string | null; completed_on: string | null; notes: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today())) / 86400000);

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, orgId, role } = await requireStaff();
  const canWrite = WRITE_ROLES.includes(role);
  const funds = await getFunds(supabase, orgId);
  const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const [{ data }, { data: expiring }] = await Promise.all([
    supabase.from('compliance_items').select('*').eq('organization_id', orgId).order('due_date'),
    supabase.from('investors').select('id, display_name, accreditation_expires_at, stage').eq('organization_id', orgId)
      .eq('accreditation_status', 'verified').lte('accreditation_expires_at', in60).order('accreditation_expires_at'),
  ]);
  const items = (data ?? []) as Item[];
  const fundName = (id: string) => funds.find((f) => f.id === id)?.name ?? '';
  const open = items.filter((i) => i.status === 'open');
  const overdue = open.filter((i) => days(i.due_date) < 0);
  const upcoming = open.filter((i) => days(i.due_date) >= 0);
  const closed = items.filter((i) => i.status !== 'open').reverse();

  const Row = ({ i }: { i: Item }) => {
    const d = days(i.due_date);
    return (
      <div style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
        <div className="row between">
          <div>
            <strong>{i.title}</strong> <span className="small muted">· {fundName(i.fund_id)}</span>
            <div className={`small ${d < 0 ? 'overdue' : d <= 7 ? '' : 'muted'}`}>
              Due {new Date(i.due_date + 'T12:00:00').toLocaleDateString()} {d < 0 ? `(${-d} days overdue)` : d === 0 ? '(today)' : `(in ${d} days)`}
            </div>
          </div>
          {i.kind !== 'custom' && <span className="pill">{i.kind === 'state_notice' ? 'State' : 'SEC'}</span>}
        </div>
        {i.basis && <p className="small muted" style={{ margin: '6px 0' }}>{i.basis}</p>}
        {canWrite && (
          <details className="small">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Record as filed</summary>
            <form action={completeItem.bind(null, i.id)} className="form-grid" style={{ marginTop: 8 }}>
              <label>Filed on<input type="date" name="completed_on" defaultValue={today()} /></label>
              <label>Filing / confirmation #<input name="reference" /></label>
              <label>Notes<input name="notes" /></label>
              <label className="row" style={{ flexDirection: 'row', fontWeight: 400, color: 'var(--ink)' }}>
                <input type="checkbox" name="not_required" value="yes" /> Not required (explain in notes)
              </label>
              <button type="submit">Save</button>
            </form>
            {i.kind === 'custom' && CAPITAL_ROLES.includes(role) && (
              <form action={deleteItem.bind(null, i.id)} style={{ marginTop: 6 }}><button className="danger" type="submit">Delete</button></form>
            )}
          </details>
        )}
      </div>
    );
  };

  return (
    <div className="stack">
      <div>
        <h1>Compliance calendar</h1>
        <p className="sub" style={{ marginBottom: 0 }}>Filing deadlines created automatically as investors are accepted. Counsel files; FundOS makes sure nothing is missed.</p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="note">
        Reminders, not legal advice. Form D is due 15 days after the first sale (moved to the next business day here; federal holidays aren&apos;t accounted for). State notice requirements, fees and deadlines vary and some states require none. Confirm each with counsel.
      </div>

      {overdue.length > 0 && (
        <div className="card" style={{ borderColor: '#ecc5c2' }}>
          <h2 style={{ color: 'var(--bad)' }}>Overdue ({overdue.length})</h2>
          {overdue.map((i) => <Row key={i.id} i={i} />)}
        </div>
      )}
      <div className="card">
        <h2>Upcoming ({upcoming.length})</h2>
        {upcoming.length ? upcoming.map((i) => <Row key={i.id} i={i} />) : <p className="small muted" style={{ margin: 0 }}>Nothing open. The Form D item appears when you accept the first commitment.</p>}
      </div>

      <div className="card">
        <h2>Accreditation expiring in 60 days</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Matters if they invest again in a later close; verification must be current at each purchase.</p>
        {expiring?.length ? (
          <ul className="small" style={{ margin: 0 }}>
            {expiring.map((x) => <li key={x.id}><Link href={`/investors/${x.id}`}>{x.display_name}</Link>: {x.accreditation_expires_at}</li>)}
          </ul>
        ) : <p className="small muted" style={{ margin: 0 }}>None.</p>}
      </div>

      {canWrite && funds.length > 0 && (
        <form className="card" action={addItem}>
          <h2>Add a deadline</h2>
          <div className="form-grid">
            <label>Fund<select name="fund_id">{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <label>What<input name="title" required placeholder="e.g. NY annual renewal, Blue sky fee" /></label>
            <label>Due<input type="date" name="due_date" required /></label>
            <label>State (optional)
              <select name="state"><option value="">—</option>{US_STATES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label>Why / source<input name="basis" placeholder="e.g. per Savvi email 10/20" /></label>
            <button type="submit">Add</button>
          </div>
        </form>
      )}

      <div className="card">
        <h2>Completed</h2>
        {closed.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Item</th><th>Status</th><th>Date</th><th>Reference / notes</th><th /></tr></thead>
            <tbody>
              {closed.map((i) => (
                <tr key={i.id}>
                  <td>{i.title}<div className="small muted">{fundName(i.fund_id)}</div></td>
                  <td><span className={`pill ${i.status === 'done' ? 'good' : ''}`}>{i.status === 'done' ? 'Filed' : 'Not required'}</span></td>
                  <td className="small">{i.completed_on}</td>
                  <td className="small">{[i.reference, i.notes].filter(Boolean).join(' · ')}</td>
                  <td className="num">{CAPITAL_ROLES.includes(role) && <form action={reopenItem.bind(null, i.id)}><button className="ghost" type="submit" style={{ padding: '3px 8px', fontSize: '.75rem' }}>Reopen</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="small muted" style={{ margin: 0 }}>Nothing filed yet.</p>}
      </div>
    </div>
  );
}
