import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { getFunds, sum } from '@/lib/funds';
import { fmtMoney, fmtPct } from '@/lib/money';
import { stageLabel, accreditation } from '@/lib/labels';

export default async function Dashboard() {
  const { supabase, orgId, orgName } = await requireStaff();
  const funds = await getFunds(supabase, orgId);
  const fund = funds[0];

  const [{ data: accounts }, { data: investors }] = await Promise.all([
    supabase.from('capital_accounts').select('*').eq('organization_id', orgId),
    supabase
      .from('investors')
      .select('id, display_name, stage, target_amount, next_follow_up, accreditation_status')
      .eq('organization_id', orgId),
  ]);

  const acc = (accounts ?? []).filter((a) => !fund || a.fund_id === fund.id);
  const inv = investors ?? [];
  const committed = sum(acc, 'committed');
  const contributed = sum(acc, 'contributed');
  const distributed = sum(acc, 'distributed') + sum(acc, 'capital_returned');
  const target = Number(fund?.target_size ?? 0);
  const pipelineStages = ['qualified', 'due_diligence', 'soft_circled', 'docs_sent'];
  const pipeline = sum(inv.filter((i) => pipelineStages.includes(i.stage)), 'target_amount');

  const today = new Date().toISOString().slice(0, 10);
  const followUps = inv
    .filter((i) => i.next_follow_up && i.next_follow_up <= addDays(today, 7) && !['funded', 'declined'].includes(i.stage))
    .sort((a, b) => a.next_follow_up!.localeCompare(b.next_follow_up!));
  const needsAccreditation = inv.filter(
    (i) => ['soft_circled', 'docs_sent', 'committed'].includes(i.stage) && i.accreditation_status !== 'verified',
  );
  const terms = (fund?.terms ?? {}) as Record<string, string | null>;
  const soon = addDays(today, 30);
  const { data: dueItems } = await supabase.from('compliance_items').select('id, title, due_date').eq('organization_id', orgId).eq('status', 'open').lte('due_date', soon).order('due_date');

  return (
    <div className="stack">
      <div>
        <h1>{fund?.name ?? orgName}</h1>
        <p className="sub" style={{ marginBottom: 0 }}>
          {fund ? `${fund.offering_type} · ${stageOrStatus(fund.status)}` : 'No fund set up yet.'}
        </p>
        {!fund && <Link href="/funds/new" className="btn" style={{ marginTop: 12 }}>Create your first fund</Link>}
      </div>

      {(dueItems?.length ?? 0) > 0 && (
        <div className={`alert ${dueItems!.some((d) => d.due_date < today) ? 'error' : 'ok'}`} style={{ marginBottom: 0 }}>
          <strong>Compliance:</strong>{' '}
          {dueItems!.slice(0, 3).map((d) => `${d.title} (due ${d.due_date})`).join(' · ')}
          {dueItems!.length > 3 ? ` and ${dueItems!.length - 3} more` : ''} · <Link href="/compliance">Open calendar →</Link>
        </div>
      )}

      <div className="grid g4">
        <div className="card kpi">
          <div className="label">Committed</div>
          <div className="value">{fmtMoney(committed, true)}</div>
          <div className="hint">{target ? `${((committed / target) * 100).toFixed(1)}% of ${fmtMoney(target, true)} target` : ''}</div>
          <div className="bar"><span style={{ width: `${Math.min(100, target ? (committed / target) * 100 : 0)}%` }} /></div>
        </div>
        <div className="card kpi">
          <div className="label">Pipeline (qualified → docs sent)</div>
          <div className="value">{fmtMoney(pipeline, true)}</div>
          <div className="hint">Sum of target amounts, not commitments</div>
        </div>
        <div className="card kpi">
          <div className="label">Capital contributed</div>
          <div className="value">{fmtMoney(contributed, true)}</div>
          <div className="hint">Unfunded: {fmtMoney(committed - contributed, true)}</div>
        </div>
        <div className="card kpi">
          <div className="label">Distributed to LPs</div>
          <div className="value">{fmtMoney(distributed, true)}</div>
          <div className="hint">{acc.filter((a) => Number(a.committed) > 0).length} committed investors</div>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="row between"><h2>Follow-ups due (next 7 days)</h2><Link href="/investors" className="small">Pipeline →</Link></div>
          {followUps.length === 0 ? <p className="muted small">Nothing due.</p> : (
            <table><tbody>
              {followUps.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/investors/${i.id}`}>{i.display_name}</Link></td>
                  <td className="muted">{stageLabel(i.stage)}</td>
                  <td className={`num ${i.next_follow_up! < today ? 'overdue' : ''}`}>{i.next_follow_up}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
        <div className="card">
          <h2>506(c) accreditation gaps</h2>
          <p className="muted small" style={{ marginTop: -6 }}>Investors past soft-circle without verified accreditation. Don&apos;t accept funds until verified.</p>
          {needsAccreditation.length === 0 ? <p className="muted small">None.</p> : (
            <table><tbody>
              {needsAccreditation.map((i) => {
                const [, label, tone] = accreditation(i.accreditation_status);
                return (
                  <tr key={i.id}>
                    <td><Link href={`/investors/${i.id}`}>{i.display_name}</Link></td>
                    <td className="muted">{stageLabel(i.stage)}</td>
                    <td className="num"><span className={`pill ${tone}`}>{label}</span></td>
                  </tr>
                );
              })}
            </tbody></table>
          )}
        </div>
      </div>

      {fund && (
        <div className="card">
          <div className="row between"><h2>Fund terms</h2><Link href={`/funds/${fund.id}`} className="small">Edit terms →</Link></div>
          <div className="grid g4 small">
            <Term k="Target size" v={fmtMoney(fund.target_size, true)} />
            <Term k="Minimum" v={fmtMoney(fund.min_commitment, true)} />
            <Term k="Preferred return" v={`${fmtPct(fund.pref_rate)} ${terms.pref_compounding ?? ''}`} />
            <Term k="Management fee" v={fmtPct(fund.mgmt_fee_rate)} />
            <Term k="Distributions" v={terms.distribution_frequency ?? '—'} />
            <Term k="Hold" v={terms.hold_period_years ? `${terms.hold_period_years} yrs` : '—'} />
            <Term k="GP catch-up" v={terms.gp_catch_up ?? 'Not set'} />
            <Term k="Carry split" v={terms.carry_split ?? 'Not set'} />
          </div>
          {(!terms.gp_catch_up || !terms.carry_split) && (
            <p className="note" style={{ marginTop: 14, marginBottom: 0 }}>
              Catch-up and carry split are blank. <Link href={`/funds/${fund.id}`}>Add them from the PPM</Link> before building distribution waterfalls.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Term({ k, v }: { k: string; v: string }) {
  return <div><div className="muted">{k}</div><div style={{ fontWeight: 600, marginTop: 2 }}>{v}</div></div>;
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function stageOrStatus(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
