import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCounsel } from '@/lib/session';
import { docSpec, fundFacts } from '@/lib/doc-templates';
import { extractMarkers } from '@/lib/markers';
import { mdToHtml } from '@/lib/md';
import { Thread, type Comment } from '@/app/comments/thread';
import { counselApprove } from '../actions';
import type { Fund } from '@/lib/funds';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function CounselDraft({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireCounsel();
  const { data: draft } = await supabase.from('doc_drafts').select('*').eq('id', id).maybeSingle();
  if (!draft) notFound();
  const [{ data: sections }, { data: fund }, { data: comments }] = await Promise.all([
    supabase.from('doc_sections').select('*').eq('draft_id', id).order('position'),
    supabase.from('funds').select('id, name, offering_type, status, target_size, min_commitment, pref_rate, mgmt_fee_rate, terms').eq('id', draft.fund_id).single(),
    supabase.from('doc_comments').select('id, section_id, author_email, body, resolved_at, created_at').eq('draft_id', id).order('created_at'),
  ]);
  const spec = docSpec(draft.kind)!;
  const secs = sections ?? [];
  const open = secs.flatMap((s) => extractMarkers(s.content ?? '').map((m) => ({ heading: s.heading, id: s.id, m })));
  const empty = secs.filter((s) => !s.content?.trim()).length;
  const locked = draft.status === 'approved' || draft.status === 'superseded';
  const back = `/review/${id}`;
  const facts = fund ? fundFacts(fund as Fund) : null;

  return (
    <>
      <div>
        <Link href="/review" className="small">← All documents</Link>
        <h1 style={{ marginTop: 8 }}>{spec.title} <span className="muted" style={{ fontWeight: 400 }}>v{draft.version}</span></h1>
        <p className="sub" style={{ marginBottom: 0 }}>{fund?.name} · <a href={`/studio/${id}/docx`}>Download Word</a></p>
      </div>
      {sp.error && <div className="alert error">{sp.error}</div>}
      {sp.ok && <div className="alert ok">Approval recorded under your login. This version is now locked.</div>}
      {draft.status === 'approved' && <div className="alert ok">Approved by {draft.approved_by_name} on {new Date(draft.approved_at).toLocaleDateString()}.</div>}

      {facts && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Fund terms this draft is based on</summary>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', marginBottom: 0 }}>{facts.text || 'No terms recorded.'}</pre>
        </details>
      )}

      {open.length > 0 && (
        <div className="card">
          <h2>Open items ({open.length})</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {open.map((o, i) => <li key={i}><a href={`#s-${o.id}`}>{o.heading}</a>: {o.m}</li>)}
          </ul>
        </div>
      )}

      {secs.map((s) => (
        <div className="card" key={s.id} id={`s-${s.id}`}>
          <h2 style={{ margin: 0 }}>{s.heading}</h2>
          {s.content ? <div className="doc" dangerouslySetInnerHTML={{ __html: mdToHtml(s.content) }} /> : <p className="small muted">Not drafted yet.</p>}
          <Thread comments={((comments ?? []) as Comment[]).filter((c) => c.section_id === s.id)} draftId={id} sectionId={s.id} back={back} canComment={!locked} />
        </div>
      ))}

      {!locked && (
        <form className="card" action={counselApprove.bind(null, id)}>
          <h2>Approve this version</h2>
          {empty || open.length ? (
            <p className="small muted" style={{ margin: 0 }}>Available once every section is drafted and no Missing/Counsel items remain. Leave comments and the fund team will revise.</p>
          ) : (
            <>
              <label>Note (optional)<input name="note" placeholder="e.g. Approved subject to final fee table" /></label>
              <label className="row" style={{ flexDirection: 'row', fontWeight: 400, color: 'var(--ink)', marginTop: 10 }}>
                <input type="checkbox" name="confirm" value="yes" required /> I approve version {draft.version} as shown here.
              </label>
              <button type="submit" style={{ marginTop: 10 }}>Approve</button>
            </>
          )}
        </form>
      )}
    </>
  );
}
