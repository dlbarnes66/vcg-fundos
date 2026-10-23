import { addComment, resolveComment } from './actions';

export type Comment = { id: string; section_id: string | null; author_email: string | null; body: string; resolved_at: string | null; created_at: string };

/** Comment thread for one draft section. Server component. */
export function Thread({ comments, draftId, sectionId, back, canComment }: {
  comments: Comment[]; draftId: string; sectionId: string; back: string; canComment: boolean;
}) {
  const open = comments.filter((c) => !c.resolved_at);
  const resolved = comments.filter((c) => c.resolved_at);
  return (
    <div style={{ borderTop: '1px dashed var(--line)', marginTop: 14, paddingTop: 10 }}>
      {open.map((c) => (
        <div key={c.id} className="small" style={{ background: '#f4f6fb', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
          <div className="row between">
            <strong>{c.author_email}</strong>
            <span className="muted">{new Date(c.created_at).toLocaleString()}</span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{c.body}</div>
          {canComment && (
            <form action={resolveComment.bind(null, c.id, back)} style={{ marginTop: 4 }}>
              <button type="submit" className="ghost" style={{ padding: '2px 8px', fontSize: '.75rem' }}>Resolve</button>
            </form>
          )}
        </div>
      ))}
      {resolved.length > 0 && <p className="small muted" style={{ margin: '4px 0' }}>{resolved.length} resolved comment(s)</p>}
      {canComment && (
        <form action={addComment.bind(null, draftId, sectionId, back)} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <textarea name="body" placeholder="Comment on this section" style={{ minHeight: 38, flex: 1 }} maxLength={4000} required />
          <button type="submit" className="ghost">Comment</button>
        </form>
      )}
    </div>
  );
}
