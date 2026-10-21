import Link from 'next/link';
import { requireStaff, WRITE_ROLES } from '@/lib/session';
import { STAGES, INVESTOR_TYPES, accreditation } from '@/lib/labels';
import { fmtMoney } from '@/lib/money';
import { Flash } from '@/lib/flash';
import { createInvestor } from './actions';

type Search = Promise<{ ok?: string; error?: string; q?: string; show?: string }>;

export default async function InvestorsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { supabase, orgId, role } = await requireStaff();
  let query = supabase
    .from('investors')
    .select('id, display_name, investor_type, stage, target_amount, next_follow_up, accreditation_status')
    .eq('organization_id', orgId)
    .order('updated_at', { ascending: false });
  if (sp.q) query = query.ilike('display_name', `%${sp.q.replace(/[%_]/g, '')}%`);
  const { data: investors } = await query;
  const rows = investors ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const stages = sp.show === 'all' ? STAGES : STAGES.filter(([k]) => k !== 'declined');

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Investor pipeline</h1>
          <p className="sub" style={{ marginBottom: 0 }}>{rows.length} investors · 506(c) raise</p>
        </div>
        <form className="row">
          <input name="q" placeholder="Search name" defaultValue={sp.q} />
          <button className="ghost" type="submit">Search</button>
          <Link href={sp.show === 'all' ? '/investors' : '/investors?show=all'} className="small">
            {sp.show === 'all' ? 'Hide declined' : 'Show declined'}
          </Link>
        </form>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="board">
        {stages.map(([key, label]) => {
          const inCol = rows.filter((r) => r.stage === key);
          const total = inCol.reduce((t, r) => t + Number(r.target_amount ?? 0), 0);
          return (
            <section className="col" key={key}>
              <h3><span>{label} · {inCol.length}</span><span>{total ? fmtMoney(total, true) : ''}</span></h3>
              {inCol.map((r) => {
                const [, accLabel, tone] = accreditation(r.accreditation_status);
                return (
                  <Link className="deal" key={r.id} href={`/investors/${r.id}`}>
                    <div className="name">{r.display_name}</div>
                    <div className="meta">
                      <span>{r.target_amount ? fmtMoney(r.target_amount, true) : '—'}</span>
                      <span className={`pill ${tone}`}>{accLabel}</span>
                    </div>
                    {r.next_follow_up && (
                      <div className={`meta ${r.next_follow_up < today ? 'overdue' : ''}`}>Follow up {r.next_follow_up}</div>
                    )}
                  </Link>
                );
              })}
            </section>
          );
        })}
      </div>

      {WRITE_ROLES.includes(role) && (
        <form className="card" action={createInvestor}>
          <h2>Add investor</h2>
          <div className="form-grid">
            <label>Name or entity<input name="display_name" required /></label>
            <label>Type
              <select name="investor_type" defaultValue="individual">
                {INVESTOR_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label>Email<input name="email" type="email" /></label>
            <label>Phone<input name="phone" /></label>
            <label>Source<input name="source" placeholder="Referral, event, LinkedIn…" /></label>
            <label>Target amount<input name="target_amount" inputMode="decimal" placeholder="50000" /></label>
            <button type="submit">Add to pipeline</button>
          </div>
        </form>
      )}
    </div>
  );
}
