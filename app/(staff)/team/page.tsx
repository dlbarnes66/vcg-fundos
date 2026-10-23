import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { ROLE_LABELS } from '@/lib/labels';
import { Flash } from '@/lib/flash';
import { InviteForm } from '@/app/invite-result';
import { inviteMember, sendMemberLink, changeRole, removeMember } from './actions';

const ROLE_HELP: [string, string][] = [
  ['owner', 'Everything, including roles and removing people'],
  ['admin', 'Everything except changing roles. Posts capital, accepts commitments'],
  ['investor_relations', 'Pipeline, investor records, documents. Cannot post money'],
  ['viewer', 'Read-only'],
];

type Member = { user_id: string; email: string; role: string; last_sign_in_at: string | null; joined_at: string };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, orgId, role, user } = await requireStaff();
  const isAdmin = CAPITAL_ROLES.includes(role);
  const isOwner = role === 'owner';

  if (!isAdmin) {
    return (
      <div className="stack">
        <h1>Team</h1>
        <p className="muted">Only an owner or admin can manage the team.</p>
      </div>
    );
  }

  const { data, error } = await supabase.rpc('org_members', { p_org: orgId });
  const members = (data ?? []) as Member[];
  const grantable = isOwner ? ROLE_HELP : ROLE_HELP.filter(([r]) => r === 'investor_relations' || r === 'viewer');

  return (
    <div className="stack">
      <div>
        <h1>Team</h1>
        <p className="sub" style={{ marginBottom: 0 }}>People who work in FundOS. Investors are invited from their investor record instead.</p>
      </div>
      <Flash ok={sp.ok} error={sp.error ?? error?.message} />

      <div className="card">
        <h2>Invite a team member</h2>
        <InviteForm action={inviteMember} submitLabel="Send invite">
          <label>Email<input name="email" type="email" required /></label>
          <label>Role
            <select name="role" defaultValue="investor_relations">
              {grantable.map(([r]) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </label>
        </InviteForm>
        <ul className="small muted" style={{ marginBottom: 0 }}>
          {ROLE_HELP.map(([r, h]) => <li key={r}><strong>{ROLE_LABELS[r]}:</strong> {h}</li>)}
        </ul>
      </div>

      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Email</th><th>Role</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>{m.email}{m.user_id === user.id && <span className="muted small"> (you)</span>}</td>
                <td>
                  {isOwner && m.user_id !== user.id ? (
                    <form action={changeRole.bind(null, m.user_id)} className="row" style={{ flexWrap: 'nowrap' }}>
                      <select name="role" defaultValue={m.role}>
                        {ROLE_HELP.map(([r]) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                      <button className="ghost" type="submit">Save</button>
                    </form>
                  ) : ROLE_LABELS[m.role]}
                </td>
                <td className="muted small">{m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleString() : 'Never (invite pending)'}</td>
                <td className="num">
                  {m.user_id !== user.id && (
                    <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
                      <InviteForm action={sendMemberLink.bind(null, m.email)} submitLabel="Send sign-in link" className="row" />
                      {isOwner && (
                        <form action={removeMember.bind(null, m.user_id)}><button className="danger" type="submit">Remove</button></form>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
