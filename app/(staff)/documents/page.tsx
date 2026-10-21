import { requireStaff, WRITE_ROLES, CAPITAL_ROLES } from '@/lib/session';
import { getFunds } from '@/lib/funds';
import { DOC_CATEGORIES } from '@/lib/labels';
import { Flash } from '@/lib/flash';
import { uploadDocument, deleteDocument } from './actions';

const VIS: Record<string, [string, string]> = {
  internal: ['Internal only', ''],
  all_investors: ['All investors', 'good'],
  investor: ['One investor', 'warn'],
};

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, orgId, role } = await requireStaff();
  const funds = await getFunds(supabase, orgId);
  const [{ data: docs }, { data: investors }, { data: views }] = await Promise.all([
    supabase.from('documents').select('id, title, category, visibility, investor_id, size_bytes, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }),
    supabase.from('investors').select('id, display_name').eq('organization_id', orgId).order('display_name'),
    supabase.from('document_access_log').select('document_id').eq('organization_id', orgId),
  ]);
  const name = (id: string | null) => investors?.find((i) => i.id === id)?.display_name ?? '';
  const viewCount = (id: string) => (views ?? []).filter((v) => v.document_id === id).length;
  const catLabel = (k: string) => DOC_CATEGORIES.find(([c]) => c === k)?.[1] ?? k;

  return (
    <div className="stack">
      <div>
        <h1>Data room</h1>
        <p className="sub" style={{ marginBottom: 0 }}>Private storage. Files open through short-lived signed links, and every open is logged.</p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      {WRITE_ROLES.includes(role) && (
        <form className="card" action={uploadDocument}>
          <h2>Upload</h2>
          <div className="form-grid">
            <label>File<input name="file" type="file" required accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg" /></label>
            <label>Title<input name="title" placeholder="Defaults to file name" /></label>
            <label>Category
              <select name="category">{DOC_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label>Fund
              <select name="fund_id"><option value="">—</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            </label>
            <label>Who can see it
              <select name="visibility" defaultValue="internal">
                <option value="internal">Internal team only</option>
                <option value="all_investors">All investors with portal access</option>
                <option value="investor">One specific investor</option>
              </select>
            </label>
            <label>Investor (if one)
              <select name="investor_id"><option value="">—</option>{(investors ?? []).map((i) => <option key={i.id} value={i.id}>{i.display_name}</option>)}</select>
            </label>
            <button type="submit">Upload</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Title</th><th>Category</th><th>Visibility</th><th className="num">Opens</th><th>Uploaded</th><th /></tr></thead>
          <tbody>
            {(docs ?? []).map((d) => {
              const [vl, tone] = VIS[d.visibility];
              return (
                <tr key={d.id}>
                  <td><a href={`/files/${d.id}`} target="_blank" rel="noopener">{d.title}</a></td>
                  <td className="muted">{catLabel(d.category)}</td>
                  <td><span className={`pill ${tone}`}>{vl}</span> <span className="small muted">{name(d.investor_id)}</span></td>
                  <td className="num">{viewCount(d.id)}</td>
                  <td className="muted small">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className="num">
                    {CAPITAL_ROLES.includes(role) && (
                      <form action={deleteDocument.bind(null, d.id)}><button className="danger" type="submit">Delete</button></form>
                    )}
                  </td>
                </tr>
              );
            })}
            {!docs?.length && <tr><td colSpan={6} className="muted">No documents yet. Start with the PPM, fact sheet and subscription agreement.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
