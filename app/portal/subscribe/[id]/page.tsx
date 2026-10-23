import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { fmtMoney } from '@/lib/money';
import { INVESTOR_TYPES } from '@/lib/labels';
import { ESIGN_CONSENT } from '@/lib/esign';
import { saveProfile, uploadFile, acknowledgeDocs, setAccreditation, signSubscription, submitSubscription } from '../actions';

export const maxDuration = 60;

const BASES: [string, string][] = [
  ['income', 'Income over $200,000 (or $300,000 with spouse) in each of the last two years, expected again this year'],
  ['net_worth', 'Net worth over $1 million, excluding primary residence'],
  ['professional', 'Holds a Series 7, 65 or 82 license in good standing'],
  ['entity_assets', 'Entity with over $5 million in assets, not formed to make this investment'],
  ['entity_owners', 'Entity in which every equity owner is accredited'],
  ['other', 'Other category (explain below)'],
];

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function SubscribePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: sub } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
  if (!sub) notFound();
  const [{ data: fund }, { data: offering }, { data: w9 }, { data: accDoc }, { data: packet }] = await Promise.all([
    supabase.from('funds').select('id, name, min_commitment, subscription_doc_id').eq('id', sub.fund_id).single(),
    supabase.from('documents').select('id, title').eq('organization_id', sub.organization_id).eq('category', 'offering').eq('visibility', 'all_investors'),
    sub.w9_document_id ? supabase.from('documents').select('id, title').eq('id', sub.w9_document_id).maybeSingle() : Promise.resolve({ data: null }),
    sub.accreditation_document_id ? supabase.from('documents').select('id, title').eq('id', sub.accreditation_document_id).maybeSingle() : Promise.resolve({ data: null }),
    sub.signed_packet_id ? supabase.from('documents').select('id, title').eq('id', sub.signed_packet_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: template } = fund?.subscription_doc_id
    ? await supabase.from('documents').select('id, title').eq('id', fund.subscription_doc_id).maybeSingle()
    : { data: null };

  const editable = sub.status === 'in_progress' || sub.status === 'changes_requested';
  const steps = {
    profile: Boolean(sub.profile_done_at),
    w9: Boolean(sub.w9_document_id),
    documents: Boolean(sub.docs_ack_at),
    accreditation: Boolean(sub.accreditation_basis && sub.accreditation_document_id),
    sign: Boolean(sub.signed_at),
  };
  const ready = Object.values(steps).every(Boolean);
  const isEntity = sub.investor_type && !['individual', 'joint', 'ira'].includes(sub.investor_type);

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{ background: 'var(--navy)', color: '#fff' }}>
        <div className="row between" style={{ maxWidth: 860, margin: '0 auto', padding: '14px 16px' }}>
          <div className="brand" style={{ padding: 0 }}><span className="brand-mark">VCG</span> Subscribe</div>
          <Link href="/portal" style={{ color: '#fff' }} className="small">← Back to portal</Link>
        </div>
      </header>

      <main className="stack" style={{ maxWidth: 860, margin: '0 auto', padding: '28px 16px' }}>
        <div>
          <h1>{fund?.name}</h1>
          <p className="sub" style={{ marginBottom: 0 }}>
            Five steps. Your progress saves as you go. Minimum subscription {fmtMoney(fund?.min_commitment ?? 0, true)}.
          </p>
        </div>
        {sp.error && <div className="alert error">{sp.error}</div>}
        {sp.ok && <div className="alert ok">Saved.</div>}
        {sub.status === 'changes_requested' && (
          <div className="alert error"><strong>The fund manager asked for changes:</strong> {sub.review_note} Update the step(s) below, then sign and submit again.</div>
        )}
        {sub.status === 'submitted' && <div className="alert ok">Submitted {new Date(sub.submitted_at).toLocaleDateString()}. The fund manager is reviewing it; you&apos;ll hear back soon.</div>}
        {sub.status === 'approved' && <div className="alert ok">Approved. Your commitment of {fmtMoney(sub.amount)} has been accepted. Funding instructions are on your portal home page.</div>}
        {sub.status === 'declined' && <div className="alert error">This subscription was declined. {sub.review_note}</div>}

        {/* 1. Profile */}
        <section className="card" id="profile">
          <Step n={1} title="Investor information" done={steps.profile} />
          <form action={saveProfile.bind(null, id)} className="stack" style={{ gap: 12 }}>
            <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
              <div className="form-grid">
                <label>Legal name of investor<input name="legal_name" defaultValue={sub.legal_name ?? ''} required placeholder="As it should appear on the subscription" /></label>
                <label>Investor type
                  <select name="investor_type" defaultValue={sub.investor_type ?? 'individual'}>
                    {INVESTOR_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                <label>Phone<input name="phone" defaultValue={sub.phone ?? ''} /></label>
              </div>
              <label>Mailing address<textarea name="address" defaultValue={sub.address ?? ''} required style={{ minHeight: 60 }} /></label>
              <p className="small muted" style={{ margin: 0 }}>For trusts, LLCs, partnerships, corporations:</p>
              <div className="form-grid">
                <label>Authorized signer name<input name="signer_name" defaultValue={sub.signer_name ?? ''} /></label>
                <label>Signer title<input name="signer_title" defaultValue={sub.signer_title ?? ''} placeholder="Trustee, Managing Member…" /></label>
              </div>
              <label>Entity details<input name="entity_details" defaultValue={sub.entity_details ?? ''} placeholder="State and date of formation" /></label>
              <label>Beneficial owners (25% or more)<textarea name="beneficial_owners" defaultValue={sub.beneficial_owners ?? ''} style={{ minHeight: 60 }} placeholder="Name and ownership % of each" /></label>
              <p className="small muted" style={{ margin: 0 }}>Don&apos;t enter your SSN or EIN here. It goes on the W-9 in the next step.</p>
              {editable && <div><button type="submit">Save information</button></div>}
            </fieldset>
          </form>
        </section>

        {/* 2. W-9 */}
        <section className="card" id="w9">
          <Step n={2} title="Tax form (W-9)" done={steps.w9} />
          <p className="small muted" style={{ marginTop: -4 }}>
            Download the IRS Form W-9 from <a href="https://www.irs.gov/pub/irs-pdf/fw9.pdf" target="_blank" rel="noopener noreferrer">irs.gov</a>, fill it in and sign it, then upload it here. It&apos;s stored privately and only the fund team can see it.
          </p>
          {w9 && <p className="small">On file: <a href={`/files/${w9.id}`} target="_blank" rel="noopener">{w9.title}</a></p>}
          {editable && <UploadForm action={uploadFile.bind(null, id, 'w9')} label={w9 ? 'Replace W-9' : 'Upload W-9'} />}
        </section>

        {/* 3. Offering documents */}
        <section className="card" id="documents">
          <Step n={3} title="Read the offering documents" done={steps.documents} />
          {offering?.length ? (
            <>
              <ul className="small">{offering.map((d) => <li key={d.id}><a href={`/files/${d.id}`} target="_blank" rel="noopener">{d.title}</a></li>)}</ul>
              {editable && (
                <form action={acknowledgeDocs.bind(null, id)} className="stack" style={{ gap: 10 }}>
                  <label className="row" style={{ flexDirection: 'row', fontWeight: 400, color: 'var(--ink)', alignItems: 'flex-start' }}>
                    <input type="checkbox" name="confirm" value="yes" required style={{ marginTop: 3 }} />
                    I have received and read the documents listed above, including the risk factors, and I have had the chance to ask questions.
                  </label>
                  <div><button type="submit">Confirm</button></div>
                </form>
              )}
              {sub.docs_ack_at && <p className="small muted">Confirmed {new Date(sub.docs_ack_at).toLocaleString()}.</p>}
            </>
          ) : <p className="small muted">The fund manager hasn&apos;t published the offering documents yet. Check back soon.</p>}
        </section>

        {/* 4. Accreditation */}
        <section className="card" id="accreditation">
          <Step n={4} title="Accredited investor verification" done={steps.accreditation} />
          <p className="small muted" style={{ marginTop: -4 }}>
            This offering is limited to accredited investors, and the fund must verify your status. Upload a letter from your CPA, attorney, registered investment adviser or broker-dealer confirming you&apos;re accredited, dated within the last 90 days. You can also use a verification service and upload its letter.
          </p>
          <form action={setAccreditation.bind(null, id)} className="stack" style={{ gap: 10 }}>
            <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
              {BASES.map(([k, l]) => (
                <label key={k} className="row" style={{ flexDirection: 'row', fontWeight: 400, color: 'var(--ink)', alignItems: 'flex-start' }}>
                  <input type="radio" name="basis" value={k} defaultChecked={sub.accreditation_basis === k} required style={{ marginTop: 3 }} /> {l}
                </label>
              ))}
              <label>Anything to add (optional)<input name="note" defaultValue={sub.accreditation_note ?? ''} /></label>
              {editable && <div><button type="submit" className="ghost">Save</button></div>}
            </fieldset>
          </form>
          {accDoc && <p className="small">Letter on file: <a href={`/files/${accDoc.id}`} target="_blank" rel="noopener">{accDoc.title}</a></p>}
          {editable && <UploadForm action={uploadFile.bind(null, id, 'accreditation')} label={accDoc ? 'Replace letter' : 'Upload verification letter'} />}
        </section>

        {/* 5. Sign */}
        <section className="card" id="sign">
          <Step n={5} title="Sign the subscription agreement" done={steps.sign} />
          {!template ? (
            <p className="small muted">The fund manager hasn&apos;t published the subscription agreement yet.</p>
          ) : sub.signed_at ? (
            <p className="small">
              Signed by <strong>{sub.signature_name}</strong> on {new Date(sub.signed_at).toLocaleString()} for {fmtMoney(sub.amount)}.{' '}
              {packet && <a href={`/files/${packet.id}`} target="_blank" rel="noopener">Download your signed copy</a>}
            </p>
          ) : !(steps.profile && steps.w9 && steps.documents && steps.accreditation) ? (
            <p className="small muted">Finish steps 1–4 first.</p>
          ) : (
            <form action={signSubscription.bind(null, id)} className="stack" style={{ gap: 12 }}>
              <p className="small">Read the agreement before signing: <a href={`/files/${template.id}`} target="_blank" rel="noopener">{template.title}</a></p>
              <div className="form-grid">
                <label>Subscription amount ($)<input name="amount" inputMode="decimal" required placeholder={String(Number(fund?.min_commitment ?? 0))} /></label>
                <label>Type your full legal name to sign<input name="signature_name" required minLength={3} defaultValue={sub.signer_name ?? sub.legal_name ?? ''} style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }} /></label>
              </div>
              <label className="row" style={{ flexDirection: 'row', fontWeight: 400, color: 'var(--ink)', alignItems: 'flex-start' }}>
                <input type="checkbox" name="consent" value="yes" required style={{ marginTop: 3 }} /> {ESIGN_CONSENT}
              </label>
              <div><button type="submit">I agree and sign</button></div>
              <p className="small muted" style={{ margin: 0 }}>We record your name, account, time, IP address and device, plus a fingerprint of the exact document, on a certificate page attached to your signed copy.</p>
            </form>
          )}
        </section>

        {editable && (
          <section className="card" id="submit">
            <h2>Submit for review</h2>
            <p className="small muted" style={{ marginTop: -6 }}>Once submitted, the fund manager reviews everything. You won&apos;t be able to change it unless they ask for changes.</p>
            <form action={submitSubscription.bind(null, id)}><button type="submit" disabled={!ready}>{ready ? 'Submit subscription' : 'Complete all five steps first'}</button></form>
          </section>
        )}
        {isEntity && !sub.signer_name && editable && <p className="small muted">Entities: remember to add the authorized signer in step 1.</p>}
      </main>
    </div>
  );
}

function Step({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <div className="row between" style={{ marginBottom: 10 }}>
      <h2 style={{ margin: 0 }}>{n}. {title}</h2>
      <span className={`pill ${done ? 'good' : ''}`}>{done ? 'Done' : 'To do'}</span>
    </div>
  );
}

function UploadForm({ action, label }: { action: (f: FormData) => Promise<void>; label: string }) {
  return (
    <form action={action} className="row" style={{ marginTop: 8 }}>
      <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" required />
      <button type="submit" className="ghost">{label}</button>
    </form>
  );
}
