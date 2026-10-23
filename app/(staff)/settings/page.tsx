import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { Flash } from '@/lib/flash';
import { CreateKeyForm } from './create-key-form';
import { revokeKey, setRequireMfa, purgeDemo } from './actions';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const { supabase, orgId, role, requireStaffMfa, aal } = await requireStaff();
  const { count: demoCount } = await supabase.from('investors').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).ilike('email', '%@example.com');
  const isAdmin = CAPITAL_ROLES.includes(role);
  const { data: keys } = isAdmin
    ? await supabase
        .from('intake_keys')
        .select('id, label, key_prefix, created_at, last_used_at, revoked_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
    : { data: [] };

  return (
    <div className="stack">
      <div>
        <h1>Settings</h1>
        <p className="sub" style={{ marginBottom: 0 }}>Connections to other VCG systems.</p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />

      {role === 'owner' && (
        <div className="card stack" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>Two-factor sign-in</h2>
          <p className="small muted" style={{ margin: 0 }}>
            When required, every team member must use an authenticator app, and posting money, approving subscriptions and changing wire instructions are blocked without it, even at the database level.
            Status: <strong>{requireStaffMfa ? 'Required for all staff' : 'Optional'}</strong>. Your session: {aal === 'aal2' ? 'verified with two-factor' : 'password only'}.
          </p>
          <div className="row">
            {requireStaffMfa ? (
              <form action={setRequireMfa}><input type="hidden" name="on" value="no" /><button className="ghost" type="submit">Make optional</button></form>
            ) : aal === 'aal2' ? (
              <form action={setRequireMfa}><input type="hidden" name="on" value="yes" /><button type="submit">Require for all staff</button></form>
            ) : (
              <a className="btn" href="/account/security">Set up two-factor on your account first</a>
            )}
          </div>
        </div>
      )}

      <div className="card stack" style={{ gap: 14 }}>
        <div>
          <h2>CRM OS handoff</h2>
          <p className="muted small" style={{ margin: 0 }}>
            CRM OS owns marketing leads. When a lead is qualified, CRM OS sends it here and FundOS takes over from
            the <strong>Qualified</strong> stage: accreditation, commitments, capital and the investor portal.
            Re-sending the same contact updates the record without changing its stage.
          </p>
        </div>

        {!isAdmin ? (
          <p className="muted small">Only an owner or admin can manage API keys.</p>
        ) : (
          <>
            <CreateKeyForm />
            <div className="table-wrap"><table>
              <thead><tr><th>Label</th><th>Key</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead>
              <tbody>
                {(keys ?? []).map((k) => (
                  <tr key={k.id}>
                    <td>{k.label}</td>
                    <td><code>{k.key_prefix}…</code></td>
                    <td className="muted small">{new Date(k.created_at).toLocaleDateString()}</td>
                    <td className="muted small">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</td>
                    <td>{k.revoked_at ? <span className="pill bad">Revoked</span> : <span className="pill good">Active</span>}</td>
                    <td className="num">
                      {!k.revoked_at && (
                        <form action={revokeKey.bind(null, k.id)}><button className="danger" type="submit">Revoke</button></form>
                      )}
                    </td>
                  </tr>
                ))}
                {!keys?.length && <tr><td colSpan={6} className="muted">No keys yet.</td></tr>}
              </tbody>
            </table></div>
          </>
        )}

        <details>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>What CRM OS sends</summary>
          <pre className="small" style={{ background: '#f2f4f7', padding: 12, borderRadius: 8, overflowX: 'auto' }}>{`POST https://<your-fundos-domain>/api/intake
Authorization: Bearer <FUNDOS_API_KEY>
Content-Type: application/json

{
  "name": "Jane Smith",              // required
  "email": "jane@example.com",
  "external_id": "<CRM OS contact id>",
  "phone": "+1 555 0100",
  "investor_type": "individual",     // individual | joint | trust | llc | partnership | corporation | ira | other
  "target_amount": 100000,
  "note": "Attended Oct webinar; asked for the PPM"
}

→ 201 { "investor_id": "...", "created": true,  "stage": "qualified" }
→ 200 { "investor_id": "...", "created": false, "stage": "<current stage>" }
→ 401 invalid or revoked key · 422 validation error`}</pre>
        </details>
      </div>

      {role === 'owner' && (demoCount ?? 0) > 0 && (
        <form className="card stack" action={purgeDemo} style={{ gap: 10, borderColor: '#ecc5c2' }}>
          <h2 style={{ margin: 0 }}>Clear sample data</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Permanently removes the {demoCount} sample investors (emails ending in @example.com) and their commitments, capital entries, subscriptions and documents. Your funds, terms, team and real investors are not touched. Do this before adding real investors.
          </p>
          <div className="form-grid">
            <label>Type DELETE DEMO DATA to confirm<input name="confirm" required autoComplete="off" /></label>
            <button className="danger" type="submit" style={{ padding: '9px 14px' }}>Delete sample data</button>
          </div>
        </form>
      )}
    </div>
  );
}
