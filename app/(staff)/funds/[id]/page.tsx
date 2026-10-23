import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { Flash } from '@/lib/flash';
import type { Fund } from '@/lib/funds';
import { FundForm } from '../fund-form';
import { updateFund, setSubscriptionTemplate, saveWireInstructions } from '../actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function FundPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, role } = await requireStaff();
  const { data: fund } = await supabase
    .from('funds')
    .select('id, name, offering_type, status, target_size, min_commitment, pref_rate, mgmt_fee_rate, terms, subscription_doc_id, organization_id')
    .eq('id', id)
    .maybeSingle();
  if (!fund) notFound();
  const [{ data: shared }, { data: wire }] = await Promise.all([
    supabase.from('documents').select('id, title, storage_path').eq('organization_id', fund.organization_id).eq('visibility', 'all_investors'),
    supabase.from('fund_wire_instructions').select('instructions, verify_phone, updated_at').eq('fund_id', id).maybeSingle(),
  ]);
  const pdfs = (shared ?? []).filter((d) => d.storage_path.toLowerCase().endsWith('.pdf'));
  const canEdit = CAPITAL_ROLES.includes(role);

  return (
    <div className="stack">
      <div>
        <Link href="/funds" className="small">← Funds</Link>
        <h1 style={{ marginTop: 8 }}>{fund.name}</h1>
        <p className="sub" style={{ marginBottom: 0 }}>Every change to these terms is kept in the audit log.</p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />
      <div className="card stack" id="onboarding" style={{ gap: 14 }}>
        <div>
          <h2>Investor onboarding</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Investors read every data-room document in the <strong>Offering</strong> category that&apos;s shared with all investors, then sign the subscription agreement below.
          </p>
        </div>
        <form action={setSubscriptionTemplate.bind(null, id)} className="form-grid">
          <label>Subscription agreement (PDF, shared with all investors)
            <select name="doc" defaultValue={fund.subscription_doc_id ?? ''} disabled={!canEdit}>
              <option value="">Not set</option>
              {pdfs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </label>
          {canEdit && <button type="submit" className="ghost">Save</button>}
        </form>
        {role === 'owner' ? (
          <form action={saveWireInstructions.bind(null, id)} className="stack" style={{ gap: 10 }}>
            <label>Wire instructions (shown to an investor only after their commitment is accepted)
              <textarea name="instructions" defaultValue={wire?.instructions ?? ''} placeholder={'Bank name\nABA routing\nAccount name\nAccount number\nReference: investor name'} />
            </label>
            <div className="form-grid">
              <label>Phone investors call to confirm before wiring<input name="verify_phone" defaultValue={wire?.verify_phone ?? ''} required /></label>
              <button type="submit" className="ghost">Save wire instructions</button>
            </div>
            {wire && <p className="small muted" style={{ margin: 0 }}>Last changed {new Date(wire.updated_at).toLocaleString()}.</p>}
          </form>
        ) : <p className="small muted">Only an owner can view or change wire instructions here.</p>}
      </div>

      <FundForm fund={fund as Fund} action={updateFund.bind(null, id)} canEdit={canEdit} submitLabel="Save terms" />
    </div>
  );
}
