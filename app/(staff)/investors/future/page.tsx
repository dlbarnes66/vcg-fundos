import Link from 'next/link';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { HOLD_LABELS, accreditation } from '@/lib/labels';

/** Contacts kept for a later 506(b) raise, with the facts counsel needs to decide who may be offered. */
export default async function FutureRaisePage() {
  const { supabase, orgId, role } = await requireStaff();
  const { data } = await supabase
    .from('investors')
    .select('id, display_name, investor_type, email, phone, source, accreditation_status, held_at, held_reason, first_contact_public, relationship_established_on, relationship_basis, next_follow_up')
    .eq('organization_id', orgId)
    .not('held_at', 'is', null)
    .order('held_at', { ascending: false });
  const rows = data ?? [];
  const needsFacts = rows.filter((r) => r.first_contact_public !== false && !r.relationship_established_on).length;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <Link href="/investors" className="small">← Pipeline</Link>
          <h1 style={{ marginTop: 8 }}>Future raise (506(b))</h1>
          <p className="sub" style={{ marginBottom: 0 }}>{rows.length} contacts kept for a later offering. They are not part of the current 506(c) raise.</p>
        </div>
        {CAPITAL_ROLES.includes(role) && <a className="btn" href="/export/future-raise">Download CSV</a>}
      </div>

      <div className="card small">
        <strong>Before you offer a 506(b) to anyone on this list:</strong> no public advertising is allowed in a 506(b). Each buyer must either not have come to you through public advertising (for example the 506(c) website, social posts, webinars or ads), or have a substantive relationship with you, meaning you reviewed their finances and investing experience, that started <em>before</em> the 506(b) raise begins. Under SEC Rule 152, a relationship that came only from the 506(c) advertising may not count.
        Non-accredited buyers are limited to 35, must be financially sophisticated, and must receive fuller disclosure, including financial statements. Have fund counsel review this list before the 506(b) launches.
        {needsFacts > 0 && <div style={{ marginTop: 8 }}><span className="pill warn">{needsFacts} missing relationship facts</span></div>}
      </div>

      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Contact</th><th>Reason</th><th>First contact</th><th>Relationship since</th><th>Check back</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const [, accLabel, tone] = accreditation(r.accreditation_status);
              const missing = r.first_contact_public !== false && !r.relationship_established_on;
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/investors/${r.id}`}><strong>{r.display_name}</strong></Link>
                    <div className="small muted">{[r.email, r.phone].filter(Boolean).join(' · ') || 'No contact info'}</div>
                  </td>
                  <td className="small">{HOLD_LABELS[r.held_reason ?? 'other']}<div><span className={`pill ${tone}`}>{accLabel}</span></div></td>
                  <td className="small">
                    {r.first_contact_public == null ? <span className="muted">Not recorded</span> : r.first_contact_public ? 'Public advertising' : 'Personal network / referral'}
                    {r.source && <div className="muted">{r.source}</div>}
                  </td>
                  <td className="small">
                    {r.relationship_established_on ?? <span className="muted">—</span>}
                    {r.relationship_basis && <div className="muted" style={{ maxWidth: 280 }}>{r.relationship_basis}</div>}
                    {missing && <div><span className="pill warn">Add relationship facts</span></div>}
                  </td>
                  <td className="small">{r.next_follow_up ?? '—'}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="muted">Nobody yet. On an investor&apos;s page, use <strong>Save for future raise</strong>.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
