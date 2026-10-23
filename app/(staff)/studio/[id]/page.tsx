import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { docSpec } from '@/lib/doc-templates';
import { extractMarkers } from '@/lib/markers';
import { mdToHtml } from '@/lib/md';
import { aiReady } from '@/lib/ai';
import { Flash } from '@/lib/flash';
import { generateSection, saveSection, sendToCounsel, recordApproval, deleteDraft, createVersion } from '../actions';
import { GenerateAll, RegenerateOne } from '../generate-buttons';

export const maxDuration = 300;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; edit?: string }> };

export default async function DraftPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, role } = await requireStaff();
  const canEdit = CAPITAL_ROLES.includes(role);

  const { data: draft } = await supabase.from('doc_drafts').select('*').eq('id', id).maybeSingle();
  if (!draft) notFound();
  const [{ data: sections }, { data: fund }] = await Promise.all([
    supabase.from('doc_sections').select('*').eq('draft_id', id).order('position'),
    supabase.from('funds').select('id, name').eq('id', draft.fund_id).single(),
  ]);
  const spec = docSpec(draft.kind)!;
  const locked = draft.status === 'approved' || draft.status === 'superseded';
  const editable = canEdit && !locked;
  const secs = sections ?? [];
  const empty = secs.filter((s) => !s.content?.trim());
  const todo = secs.flatMap((s) => extractMarkers(s.content ?? '').map((m) => ({ section: s.heading, id: s.id, item: m })));
  const drafted = secs.length - empty.length;

  return (
    <div className="stack">
      <div>
        <Link href={`/studio?fund=${draft.fund_id}`} className="small">← Document Studio</Link>
        <h1 style={{ marginTop: 8 }}>{spec.title} <span className="muted" style={{ fontWeight: 400 }}>v{draft.version}</span></h1>
        <p className="sub" style={{ marginBottom: 0 }}>{fund?.name} · {drafted} of {secs.length} sections drafted · {todo.length} open item(s)</p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      {draft.status === 'approved' && (
        <div className="alert ok">
          Counsel approval recorded: <strong>{draft.approved_by_name}</strong> on {new Date(draft.approved_at).toLocaleDateString()}.
          {draft.approval_note && <> Note: {draft.approval_note}</>} This version is locked.
        </div>
      )}
      {draft.status === 'superseded' && <div className="alert error">This version has been superseded by a newer one and is read-only.</div>}
      {!locked && (
        <div className="note">
          DRAFT for counsel review. Not legal advice, and not for distribution to investors. Highlighted <mark className="marker missing">Missing</mark> items need facts from you; <mark className="marker counsel">Counsel</mark> items need a decision from your attorney.
        </div>
      )}

      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Actions</h2>
          <a className="btn" href={`/studio/${id}/docx`}>Download Word (.docx)</a>
        </div>
        <div className="row" style={{ marginTop: 14, alignItems: 'flex-start' }}>
          {editable && aiReady() && (
            <GenerateAll
              sectionIds={empty.map((s) => s.id)}
              generate={generateSection}
              label={`Draft ${empty.length} empty section${empty.length === 1 ? '' : 's'} with AI`}
            />
          )}
          {editable && draft.status === 'draft' && drafted > 0 && (
            <form action={sendToCounsel.bind(null, id)}><button className="ghost" type="submit">Mark as sent to counsel</button></form>
          )}
          {canEdit && (
            <form action={createVersion.bind(null, draft.fund_id, draft.kind)}><button className="ghost" type="submit">Start new version</button></form>
          )}
          {role === 'owner' && !locked && (
            <form action={deleteDraft.bind(null, id)}><button className="danger" type="submit">Delete this version</button></form>
          )}
        </div>
        {!aiReady() && editable && <p className="small muted">AI drafting is off until ANTHROPIC_API_KEY is set. You can still write sections by hand.</p>}
      </div>

      {role === 'owner' && !locked && drafted > 0 && (
        <form className="card" action={recordApproval.bind(null, id)}>
          <h2>Record counsel approval</h2>
          {empty.length > 0 || todo.length > 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Available once every section is filled in and all {todo.length} open item(s) are resolved.
            </p>
          ) : (
            <>
              <p className="small muted" style={{ marginTop: -6 }}>
                Only use this after your attorney has reviewed and approved this exact version. It locks the version; later changes go into a new one.
              </p>
              <div className="form-grid">
                <label>Counsel name and firm<input name="counsel" required minLength={3} placeholder="e.g. Jane Doe, Savvi Legal" /></label>
                <label>Note (optional)<input name="note" placeholder="Approval email dated…" /></label>
              </div>
              <label className="row" style={{ flexDirection: 'row', marginTop: 10, fontWeight: 400, color: 'var(--ink)' }}>
                <input type="checkbox" name="confirm" value="yes" required /> Counsel has approved version {draft.version} as shown here.
              </label>
              <button type="submit" style={{ marginTop: 10 }}>Record approval and lock</button>
            </>
          )}
        </form>
      )}

      {todo.length > 0 && (
        <div className="card">
          <h2>Open items ({todo.length})</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {todo.map((t, i) => (
              <li key={i}><a href={`#s-${t.id}`}>{t.section}</a>: {t.item}</li>
            ))}
          </ul>
          <p className="small muted" style={{ marginBottom: 0 }}>To clear an item, fill in the fact on the fund&apos;s legal profile and redraft the section, or edit the text directly and remove the marker.</p>
        </div>
      )}

      {secs.map((s) => {
        const editing = sp.edit === s.id && editable;
        return (
          <div className="card" key={s.id} id={`s-${s.id}`}>
            <div className="row between">
              <h2 style={{ margin: 0 }}>{s.heading}</h2>
              <span className="row small muted">
                {s.content ? (s.edited_by_human ? 'Edited by you' : 'AI draft') : 'Empty'}
                {editable && !editing && <Link href={`/studio/${id}?edit=${s.id}#s-${s.id}`} className="small">Edit</Link>}
                {editable && aiReady() && !editing && <RegenerateOne sectionId={s.id} generate={generateSection} hasContent={Boolean(s.content)} />}
              </span>
            </div>
            {editing ? (
              <form action={saveSection.bind(null, s.id)} className="stack" style={{ gap: 8, marginTop: 12 }}>
                <textarea name="content" defaultValue={s.content ?? ''} style={{ minHeight: 360, fontFamily: 'ui-monospace, monospace', fontSize: '.85rem' }} />
                <div className="row">
                  <button type="submit">Save section</button>
                  <Link href={`/studio/${id}#s-${s.id}`} className="small">Cancel</Link>
                  <span className="small muted">Markdown: ### heading, - bullet, **bold**, | tables |</span>
                </div>
              </form>
            ) : s.content ? (
              <div className="doc" dangerouslySetInnerHTML={{ __html: mdToHtml(s.content) }} />
            ) : (
              <p className="muted small">Not drafted yet.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
