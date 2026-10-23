import Link from 'next/link';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { getFunds } from '@/lib/funds';
import { DOCS, fundFacts } from '@/lib/doc-templates';
import { aiReady } from '@/lib/ai';
import { Flash } from '@/lib/flash';
import type { Finding } from '@/lib/drafting';
import { createVersion, runCheck } from './actions';

export const maxDuration = 300;

const STATUS: Record<string, [string, string]> = {
  draft: ['Draft', 'warn'],
  in_review: ['With counsel', ''],
  approved: ['Counsel approved', 'good'],
  superseded: ['Superseded', ''],
};
const SEV: Record<string, [string, string]> = { conflict: ['Conflict', 'bad'], missing: ['Missing', 'warn'], review: ['Review', ''] };

type Search = Promise<{ fund?: string; ok?: string; error?: string }>;

export default async function StudioPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const { supabase, orgId, role } = await requireStaff();
  const canEdit = CAPITAL_ROLES.includes(role);
  const funds = await getFunds(supabase, orgId);
  const fund = funds.find((f) => f.id === sp.fund) ?? funds[0];

  if (!fund) {
    return (
      <div className="stack">
        <h1>Document Studio</h1>
        <p className="muted">Create a fund first. <Link href="/funds/new">New fund →</Link></p>
      </div>
    );
  }

  const [{ data: drafts }, { data: pdfs }, { data: checks }] = await Promise.all([
    supabase.from('doc_drafts').select('id, kind, version, status, created_at, approved_by_name').eq('fund_id', fund.id).order('version', { ascending: false }),
    supabase.from('documents').select('id, title, storage_path, size_bytes').eq('organization_id', orgId).order('created_at', { ascending: false }),
    supabase.from('doc_checks').select('id, sources, findings, summary, created_at').eq('fund_id', fund.id).order('created_at', { ascending: false }).limit(5),
  ]);
  const latest = (kind: string) => (drafts ?? []).find((d) => d.kind === kind);
  const facts = fundFacts(fund);
  const pdfDocs = (pdfs ?? []).filter((d) => d.storage_path.toLowerCase().endsWith('.pdf'));

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Document Studio</h1>
          <p className="sub" style={{ marginBottom: 0 }}>Draft fund documents from your fund&apos;s terms, and check documents against each other.</p>
        </div>
        {funds.length > 1 && (
          <form className="row">
            <select name="fund" defaultValue={fund.id}>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            <button className="ghost" type="submit">Switch</button>
          </form>
        )}
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      <div className="note">
        <strong>Drafts only.</strong> Everything here is a starting draft for your securities counsel. It is not legal advice and must not be sent to investors until counsel has reviewed and approved it. The AI drafts only from the terms you&apos;ve recorded and marks anything missing instead of making it up.
      </div>
      {!aiReady() && <div className="alert error">AI isn&apos;t connected. Add ANTHROPIC_API_KEY in Vercel (type: Secret) to draft and check documents.</div>}

      <div className="card">
        <div className="row between">
          <h2>{fund.name}: fund record</h2>
          <Link href={`/funds/${fund.id}`} className="small">Edit terms and legal profile →</Link>
        </div>
        <p className="small muted" style={{ marginTop: -4 }}>
          {facts.unknown.length === 0 ? 'Every field is filled in.' : `${facts.unknown.length} field(s) are blank and will show up as Missing in drafts: ${facts.unknown.join(', ')}.`}
        </p>
      </div>

      <div className="grid g2">
        {DOCS.map((d) => {
          const l = latest(d.kind);
          const [label, tone] = l ? STATUS[l.status] : ['Not started', ''];
          return (
            <div className="card" key={d.kind}>
              <div className="row between">
                <h2 style={{ margin: 0 }}>{d.title}</h2>
                <span className={`pill ${tone}`}>{l ? `v${l.version} · ` : ''}{label}</span>
              </div>
              <p className="small muted">{d.purpose} {d.sections.length} sections.</p>
              <div className="row">
                {l && <Link className="btn" href={`/studio/${l.id}`}>Open v{l.version}</Link>}
                {canEdit && (
                  <form action={createVersion.bind(null, fund.id, d.kind)}>
                    <button className={l ? 'ghost' : ''} type="submit">{l ? 'Start new version' : 'Start draft'}</button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" id="checks">
        <h2>Consistency checker</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Compares documents against the fund record above and against each other: rates, fees, waterfall, minimums, entity names, the exemption, transfer rules. Use it on the PPM and LPA from counsel before you send them out. Upload them to the Data room as PDFs first.
        </p>
        {canEdit && (
          <form action={runCheck.bind(null, fund.id)} className="stack" style={{ gap: 10 }}>
            <div className="grid g2">
              <fieldset style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
                <legend className="small muted">Data room PDFs</legend>
                {pdfDocs.map((p) => (
                  <label key={p.id} className="row" style={{ flexDirection: 'row', fontWeight: 400, color: 'var(--ink)' }}>
                    <input type="checkbox" name="doc" value={p.id} /> {p.title}
                  </label>
                ))}
                {!pdfDocs.length && <p className="small muted">No PDFs in the data room yet.</p>}
              </fieldset>
              <fieldset style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
                <legend className="small muted">FundOS drafts</legend>
                {(drafts ?? []).filter((d) => d.status !== 'superseded').map((d) => (
                  <label key={d.id} className="row" style={{ flexDirection: 'row', fontWeight: 400, color: 'var(--ink)' }}>
                    <input type="checkbox" name="draft" value={d.id} /> {DOCS.find((x) => x.kind === d.kind)?.title} v{d.version}
                  </label>
                ))}
                {!drafts?.length && <p className="small muted">No drafts yet.</p>}
              </fieldset>
            </div>
            <div><button type="submit" disabled={!aiReady()}>Run check (takes about a minute)</button></div>
          </form>
        )}

        {(checks ?? []).map((c) => {
          const findings = (c.findings ?? []) as Finding[];
          const sources = (c.sources ?? []) as { title: string }[];
          return (
            <div key={c.id} style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 14 }}>
              <div className="row between">
                <strong className="small">{sources.map((s) => s.title).join(' · ')}</strong>
                <span className="small muted">{new Date(c.created_at).toLocaleString()}</span>
              </div>
              {c.summary && <p className="small">{c.summary}</p>}
              {findings.length === 0 ? <p className="small muted">No inconsistencies found.</p> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Type</th><th>Topic</th><th>Where</th><th>Says</th><th>Expected</th></tr></thead>
                  <tbody>
                    {findings.map((f, i) => (
                      <tr key={i}>
                        <td><span className={`pill ${SEV[f.severity]?.[1] ?? ''}`}>{SEV[f.severity]?.[0] ?? f.severity}</span></td>
                        <td><strong>{f.topic}</strong><div className="small muted">{f.explanation}</div></td>
                        <td className="small">{f.where}</td>
                        <td className="small">{f.says}</td>
                        <td className="small">{f.expected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          );
        })}
        <p className="small muted" style={{ marginBottom: 0, marginTop: 12 }}>The checker can miss things or flag false alarms. It produces a list of questions for counsel, not a sign-off.</p>
      </div>
    </div>
  );
}
