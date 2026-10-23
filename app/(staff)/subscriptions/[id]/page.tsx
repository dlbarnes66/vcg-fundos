import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { fmtMoney } from '@/lib/money';
import { Flash } from '@/lib/flash';
import { approve, returnSub } from '../actions';

const SUB_STATUS: Record<string, [string, string]> = {
  in_progress: ['Investor filling in', ''],
  submitted: ['Ready for review', 'warn'],
  changes_requested: ['Changes requested', 'bad'],
  approved: ['Approved', 'good'],
  declined: ['Declined', 'bad'],
};

const BASIS: Record<string, string> = {
  income: 'Income test', net_worth: 'Net worth over $1M (excl. residence)', professional: 'Series 7/65/82 license',
  entity_assets: 'Entity with $5M+ assets', entity_owners: 'All equity owners accredited', other: 'Other',
};

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function ReviewPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, role } = await requireStaff();
  const { data: s } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
  if (!s) notFound();
  const docIds = [s.w9_document_id, s.accreditation_document_id, s.signed_packet_id].filter(Boolean) as string[];
  const [{ data: inv }, { data: fund }, { data: docs }] = await Promise.all([
    supabase.from('investors').select('id, display_name, email').eq('id', s.investor_id).single(),
    supabase.from('funds').select('name, min_commitment').eq('id', s.fund_id).single(),
    docIds.length ? supabase.from('documents').select('id, title').in('id', docIds) : Promise.resolve({ data: [] }),
  ]);
  const doc = (did: string | null) => (did ? docs?.find((d) => d.id === did) : null);
  const [label, tone] = SUB_STATUS[s.status];
  const canReview = CAPITAL_ROLES.includes(role) && s.status === 'submitted';
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <tr><td className="muted" style={{ width: 220 }}>{k}</td><td>{v || <span className="muted">—</span>}</td></tr>
  );
  const FileLink = ({ did }: { did: string | null }) => {
    const d = doc(did);
    return d ? <a href={`/files/${d.id}`} target="_blank" rel="noopener">{d.title} ↗</a> : <span className="muted">Not uploaded</span>;
  };

  return (
    <div className="stack">
      <div>
        <Link href="/subscriptions" className="small">← Subscriptions</Link>
        <div className="row between" style={{ marginTop: 8 }}>
          <h1 style={{ margin: 0 }}>{s.legal_name || inv?.display_name}</h1>
          <span className={`pill ${tone}`}>{label}</span>
        </div>
        <p className="sub" style={{ marginBottom: 0 }}>
          {fund?.name} · <Link href={`/investors/${s.investor_id}`}>Investor record</Link>
        </p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />
      {s.review_note && s.status !== 'submitted' && <div className="note"><strong>Review note:</strong> {s.review_note}</div>}

      <div className="card">
        <h2>1. Investor information</h2>
        <table><tbody>
          <Row k="Legal name" v={s.legal_name} />
          <Row k="Type" v={s.investor_type} />
          <Row k="Address" v={s.address} />
          <Row k="Phone" v={s.phone} />
          <Row k="Entity details" v={s.entity_details} />
          <Row k="Authorized signer" v={s.signer_name ? `${s.signer_name}${s.signer_title ? `, ${s.signer_title}` : ''}` : null} />
          <Row k="Beneficial owners" v={s.beneficial_owners} />
        </tbody></table>
      </div>

      <div className="card">
        <h2>2–4. Tax form, offering documents, accreditation</h2>
        <table><tbody>
          <Row k="W-9" v={<FileLink did={s.w9_document_id} />} />
          <Row k="Offering documents read" v={s.docs_ack_at ? `Confirmed ${new Date(s.docs_ack_at).toLocaleString()}: ${((s.docs_ack ?? []) as { title: string }[]).map((d) => d.title).join(', ')}` : null} />
          <Row k="Accreditation basis" v={s.accreditation_basis ? BASIS[s.accreditation_basis] : null} />
          <Row k="Investor note" v={s.accreditation_note} />
          <Row k="Verification letter" v={<FileLink did={s.accreditation_document_id} />} />
        </tbody></table>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Check the letter is from a CPA, attorney, RIA or broker-dealer; names this investor; confirms accredited status; and is recent (commonly within 90 days).
        </p>
      </div>

      <div className="card">
        <h2>5. Signature</h2>
        <table><tbody>
          <Row k="Amount" v={s.amount ? `${fmtMoney(s.amount)}${fund && Number(s.amount) < Number(fund.min_commitment) ? ' (below minimum!)' : ''}` : null} />
          <Row k="Signed as" v={s.signature_name} />
          <Row k="Signed at" v={s.signed_at ? new Date(s.signed_at).toLocaleString() : null} />
          <Row k="IP / device" v={s.signed_ip ? `${s.signed_ip} · ${s.signed_user_agent?.slice(0, 80)}` : null} />
          <Row k="Document fingerprint" v={s.signed_doc_sha256 ? <code className="small">{s.signed_doc_sha256}</code> : null} />
          <Row k="Signed packet" v={<FileLink did={s.signed_packet_id} />} />
        </tbody></table>
      </div>

      {canReview && (
        <div className="grid g2">
          <form className="card" action={approve.bind(null, id)}>
            <h2>Approve</h2>
            <p className="small muted" style={{ marginTop: -6 }}>Marks accreditation verified, accepts a {s.amount ? fmtMoney(s.amount) : ''} commitment, and shows the investor the wire instructions.</p>
            <label>Accreditation verification expires<input type="date" name="expires" defaultValue={in90} required /></label>
            <label style={{ marginTop: 10 }}>Note (optional)<input name="note" placeholder="e.g. CPA letter dated 10/20 reviewed" /></label>
            <label className="row" style={{ flexDirection: 'row', fontWeight: 400, color: 'var(--ink)', marginTop: 10, alignItems: 'flex-start' }}>
              <input type="checkbox" name="reviewed" value="yes" required style={{ marginTop: 3 }} /> I reviewed the verification letter and the signed agreement.
            </label>
            <button type="submit" style={{ marginTop: 10 }}>Approve subscription</button>
          </form>
          <form className="card" action={returnSub.bind(null, id)}>
            <h2>Send back</h2>
            <p className="small muted" style={{ marginTop: -6 }}>The investor sees your note, fixes what&apos;s needed, and signs again.</p>
            <label>What needs to change<textarea name="note" required minLength={5} /></label>
            <label className="row" style={{ flexDirection: 'row', fontWeight: 400, color: 'var(--ink)', marginTop: 10 }}>
              <input type="checkbox" name="decline" value="yes" /> Decline instead (final)
            </label>
            <button type="submit" className="ghost" style={{ marginTop: 10 }}>Send to investor</button>
          </form>
        </div>
      )}
    </div>
  );
}
