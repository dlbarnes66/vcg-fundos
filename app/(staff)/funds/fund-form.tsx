import type { Fund } from '@/lib/funds';

const pctValue = (r: string | undefined) => (r == null ? '' : String(Number((Number(r) * 100).toFixed(4))));
const num = (v: string | undefined) => (v == null ? '' : String(Number(v)));

/** Shared create/edit form. Rates are shown and entered as percentages. */
export function FundForm({
  fund,
  action,
  canEdit,
  submitLabel,
}: {
  fund?: Fund;
  action: (formData: FormData) => Promise<void>;
  canEdit: boolean;
  submitLabel: string;
}) {
  const t = (fund?.terms ?? {}) as Record<string, string | null>;
  return (
    <form action={action} className="stack">
      <fieldset disabled={!canEdit} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="card">
          <h2>Basics</h2>
          <div className="form-grid">
            <label>Fund name<input name="name" defaultValue={fund?.name ?? ''} required maxLength={200} /></label>
            <label>Offering type<input name="offering_type" defaultValue={fund?.offering_type ?? 'Reg D 506(c)'} /></label>
            <label>Status
              <select name="status" defaultValue={fund?.status ?? 'draft'}>
                <option value="draft">Draft</option>
                <option value="raising">Raising</option>
                <option value="closed">Closed (no new investors)</option>
                <option value="operating">Operating</option>
                <option value="wound_down">Wound down</option>
              </select>
            </label>
          </div>
        </div>

        <div className="card">
          <h2>Raise</h2>
          <div className="form-grid">
            <label>Target size ($)<input name="target_size" inputMode="decimal" required defaultValue={num(fund?.target_size)} placeholder="10000000" /></label>
            <label>Minimum commitment ($)<input name="min_commitment" inputMode="decimal" defaultValue={num(fund?.min_commitment)} placeholder="50000" /></label>
          </div>
        </div>

        <div className="card">
          <h2>Economics</h2>
          <div className="form-grid">
            <label>Preferred return (%)<input name="pref_rate" inputMode="decimal" defaultValue={pctValue(fund?.pref_rate)} placeholder="7" /></label>
            <label>Pref compounding
              <select name="pref_compounding" defaultValue={t.pref_compounding ?? 'simple'}>
                <option value="simple">Simple</option>
                <option value="compounded_annually">Compounded annually</option>
                <option value="compounded_quarterly">Compounded quarterly</option>
              </select>
            </label>
            <label>Management fee (%)<input name="mgmt_fee_rate" inputMode="decimal" defaultValue={pctValue(fund?.mgmt_fee_rate)} placeholder="2" /></label>
            <label>GP catch-up<input name="gp_catch_up" defaultValue={t.gp_catch_up ?? ''} placeholder="e.g. 100% to GP until 20/80, or None" /></label>
            <label>Carry split (LP/GP)<input name="carry_split" defaultValue={t.carry_split ?? ''} placeholder="e.g. 80/20 above the pref" /></label>
          </div>
          <p className="note" style={{ marginBottom: 0, marginTop: 14 }}>
            Copy catch-up and carry wording exactly from the PPM. The distribution waterfall will be built from these terms.
          </p>
        </div>

        <div className="card">
          <h2>Investor-facing targets</h2>
          <div className="form-grid">
            <label>Distribution frequency<input name="distribution_frequency" defaultValue={t.distribution_frequency ?? ''} placeholder="quarterly" /></label>
            <label>Hold period (years)<input name="hold_period_years" defaultValue={t.hold_period_years ?? ''} placeholder="7-10" /></label>
            <label>Target net IRR<input name="target_net_irr" defaultValue={t.target_net_irr ?? ''} placeholder="14-18%" /></label>
            <label>Target equity multiple<input name="target_equity_multiple" defaultValue={t.target_equity_multiple ?? ''} placeholder="2.0-2.5x" /></label>
          </div>
          <label style={{ marginTop: 12 }}>Other terms / notes<textarea name="terms_notes" defaultValue={t.notes ?? ''} /></label>
        </div>

        <div className="card">
          <h2>Legal profile (for Document Studio)</h2>
          <p className="muted small" style={{ marginTop: -6 }}>
            These are the only facts the document drafts use. Leave anything you don&apos;t know blank: it gets flagged as missing for you or counsel, never made up.
          </p>
          <div className="form-grid">
            <label>Legal structure
              <select name="legal_structure" defaultValue={t.legal_structure ?? ''}>
                <option value="">Not set</option>
                <option value="limited_partnership">Limited partnership (GP/LP)</option>
                <option value="llc">LLC (manager/members)</option>
                <option value="master_feeder">Master-feeder</option>
              </select>
            </label>
            <label>State of formation<input name="formation_state" defaultValue={t.formation_state ?? ''} placeholder="Delaware" /></label>
            <label>Fund legal name<input name="fund_entity" defaultValue={t.fund_entity ?? ''} placeholder="VCG Veterans Housing Fund I, LP" /></label>
            <label>General partner / managing member<input name="gp_entity" defaultValue={t.gp_entity ?? ''} /></label>
            <label>Investment manager<input name="manager_entity" defaultValue={t.manager_entity ?? ''} placeholder="Venture Collective Group, LLC" /></label>
            <label>Securities exemption
              <select name="exemption" defaultValue={t.exemption ?? ''}>
                <option value="">Not decided (counsel to advise)</option>
                <option value="506c">Reg D Rule 506(c)</option>
                <option value="506b">Reg D Rule 506(b)</option>
                <option value="other">Other (see notes)</option>
              </select>
            </label>
            <label>Fund counsel<input name="fund_counsel" defaultValue={t.fund_counsel ?? ''} /></label>
            <label>Fund administrator<input name="administrator" defaultValue={t.administrator ?? ''} placeholder="Leave blank if none" /></label>
            <label>Auditor / CPA<input name="auditor" defaultValue={t.auditor ?? ''} /></label>
          </div>
          <div className="grid g2" style={{ marginTop: 12 }}>
            <label>Investment strategy<textarea name="strategy" defaultValue={t.strategy ?? ''} placeholder="What the fund buys, how it creates value, the veteran-housing mandate, HUD-VASH approach…" /></label>
            <label>Principals &amp; key people<textarea name="principals" defaultValue={t.principals ?? ''} placeholder="Names, roles, relevant experience (facts only)" /></label>
            <label>Target markets / asset types<textarea name="target_markets" defaultValue={t.target_markets ?? ''} placeholder="Multifamily primary; single-family and duplexes secondary; regions…" /></label>
            <label>Leverage policy<textarea name="leverage_policy" defaultValue={t.leverage_policy ?? ''} placeholder="Target and maximum loan-to-value, recourse, etc." /></label>
            <label>Investor eligibility<textarea name="investor_eligibility" defaultValue={t.investor_eligibility ?? ''} placeholder="Accredited investors only; verification method…" /></label>
            <label>Term &amp; extensions<textarea name="term_extension" defaultValue={t.term_extension ?? ''} placeholder="e.g. 7 years plus up to two 1-year extensions at GP discretion" /></label>
            <label>Capital calls &amp; defaults<textarea name="capital_call_terms" defaultValue={t.capital_call_terms ?? ''} placeholder="Notice period, funded at close vs. called, default remedies" /></label>
            <label>Transfers &amp; redemptions<textarea name="transfer_redemption" defaultValue={t.transfer_redemption ?? ''} placeholder="GP consent for transfers; no redemptions…" /></label>
          </div>
          <label style={{ marginTop: 12 }}>Other facts counsel should know<textarea name="other_disclosures" defaultValue={t.other_disclosures ?? ''} placeholder="Affiliated parties, conflicts, prior funds, litigation (or none)…" /></label>
        </div>

        {canEdit && <div><button type="submit">{submitLabel}</button></div>}
      </fieldset>
      {!canEdit && <p className="muted small">Only an owner or admin can change fund terms.</p>}
    </form>
  );
}
