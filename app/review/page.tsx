import Link from 'next/link';
import { requireCounsel } from '@/lib/session';
import { DOCS } from '@/lib/doc-templates';

const STATUS: Record<string, [string, string]> = {
  draft: ['Draft', 'warn'], in_review: ['Sent for review', ''], approved: ['Approved', 'good'], superseded: ['Superseded', ''],
};

export default async function ReviewHome() {
  const { supabase, orgId } = await requireCounsel();
  const [{ data: funds }, { data: drafts }, { data: docs }, { data: comments }] = await Promise.all([
    supabase.from('funds').select('id, name').eq('organization_id', orgId),
    supabase.from('doc_drafts').select('id, fund_id, kind, version, status, created_at').eq('organization_id', orgId).neq('status', 'superseded').order('created_at', { ascending: false }),
    supabase.from('documents').select('id, title, category, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }),
    supabase.from('doc_comments').select('draft_id').is('resolved_at', null),
  ]);
  const openCount = (id: string) => (comments ?? []).filter((c) => c.draft_id === id).length;

  return (
    <>
      <div>
        <h1>Documents for review</h1>
        <p className="sub" style={{ marginBottom: 0 }}>Drafts prepared in FundOS. Comment on any section, download Word to redline, and approve a version when it&apos;s final.</p>
      </div>
      {(funds ?? []).map((f) => {
        const ds = (drafts ?? []).filter((d) => d.fund_id === f.id);
        return (
          <div className="card" key={f.id}>
            <h2>{f.name}</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>Document</th><th>Version</th><th>Status</th><th className="num">Open comments</th><th /></tr></thead>
              <tbody>
                {ds.map((d) => {
                  const [label, tone] = STATUS[d.status];
                  return (
                    <tr key={d.id}>
                      <td><Link href={`/review/${d.id}`}>{DOCS.find((x) => x.kind === d.kind)?.title ?? d.kind}</Link></td>
                      <td>v{d.version}</td>
                      <td><span className={`pill ${tone}`}>{label}</span></td>
                      <td className="num">{openCount(d.id) || ''}</td>
                      <td className="num"><a href={`/studio/${d.id}/docx`}>Word</a></td>
                    </tr>
                  );
                })}
                {!ds.length && <tr><td colSpan={5} className="muted">No drafts yet.</td></tr>}
              </tbody>
            </table></div>
          </div>
        );
      })}
      <div className="card">
        <h2>Offering documents on file</h2>
        <ul className="small" style={{ margin: 0 }}>
          {(docs ?? []).map((d) => <li key={d.id}><a href={`/files/${d.id}`} target="_blank" rel="noopener">{d.title}</a> <span className="muted">· {d.category}</span></li>)}
          {!docs?.length && <li className="muted">None uploaded yet.</li>}
        </ul>
      </div>
    </>
  );
}
