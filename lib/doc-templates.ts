// Outlines for each fund document. The AI drafts one section at a time from these
// instructions plus the fund's own data. Counsel finalizes; these are starting drafts.

export type SectionSpec = { key: string; heading: string; brief: string };
export type DocSpec = { kind: DocKind; title: string; purpose: string; sections: SectionSpec[] };
export type DocKind = 'ppm' | 'lpa' | 'subscription_agreement' | 'investor_questionnaire' | 'capital_call_notice' | 'side_letter';

export const DOCS: DocSpec[] = [
  {
    kind: 'ppm',
    title: 'Private Placement Memorandum',
    purpose: 'Discloses the offering to prospective investors. Must match the LPA exactly on economics.',
    sections: [
      { key: 'cover', heading: 'Cover Page and Legends', brief: 'Fund name, offering, minimum, date placeholder, confidentiality legend, standard private-offering legends (not registered under the Securities Act, restrictions on transfer, no public market), and the exemption only if one is recorded; otherwise a MISSING marker.' },
      { key: 'summary', heading: 'Summary of Principal Terms', brief: 'A term sheet table: fund, GP, manager, target size, minimum commitment, term and extensions, preferred return, management fee, catch-up, carried interest split, distributions, capital calls, transfers, investor eligibility. One row per term, values only from the fund data.' },
      { key: 'fund_strategy', heading: 'The Fund and Its Investment Strategy', brief: 'Describe objectives, strategy, target markets and asset types, the veteran-housing mandate if described, and the investment process, using only the strategy text provided. Target returns may be stated only as targets, with a statement that they are not guaranteed.' },
      { key: 'management', heading: 'Management', brief: 'The GP, the manager, and principals, using only the facts provided about each person. No invented biographies, track record or prior performance.' },
      { key: 'fees', heading: 'Fees and Expenses', brief: 'Management fee (rate and basis; mark the basis missing if not provided), organizational and operating expenses, and how expenses are borne.' },
      { key: 'distributions', heading: 'Distributions and Allocation of Profits', brief: 'The distribution waterfall in order: return of capital, preferred return (rate and compounding), GP catch-up, carried interest split, and distribution frequency. If catch-up or carry are blank, leave MISSING markers for them; do not assume market terms.' },
      { key: 'risk_factors', heading: 'Risk Factors', brief: 'Risk factors appropriate to this strategy: general real estate, leverage (per the leverage policy), illiquidity and transfer restrictions, reliance on management, concentration, government-program risk (e.g. HUD-VASH voucher funding and administration) if the strategy relies on it, tenant risk, interest rates, conflicts, tax, and blind-pool risk. Write substantive risk factors; flag any that need fund-specific facts.' },
      { key: 'conflicts', heading: 'Conflicts of Interest', brief: 'Conflicts arising from the GP and manager structure, other activities of the principals, affiliated transactions, and fee arrangements, using any disclosures provided. Mark unknown affiliated arrangements as MISSING rather than stating there are none.' },
      { key: 'subscription', heading: 'Investor Suitability and Subscription Procedures', brief: 'Eligibility (accredited investors), verification steps if Rule 506(c) is recorded, how to subscribe (subscription agreement, investor questionnaire, funding), and the right to reject subscriptions.' },
      { key: 'transfers', heading: 'Restrictions on Transfer and Withdrawal', brief: 'Transfer and redemption limits from the fund data, and general securities-law restrictions.' },
      { key: 'tax', heading: 'Certain Tax Considerations', brief: 'A high-level outline of the topics counsel or the CPA must complete (partnership taxation, K-1s, UBTI for tax-exempt investors, state taxes), clearly marked as an outline requiring tax counsel. No tax conclusions.' },
      { key: 'legal_other', heading: 'Legal Matters, Reports and Additional Information', brief: 'Fund counsel, administrator and auditor if recorded; reporting to investors (frequency from the fund data); access to the LPA and other documents; how to ask questions.' },
    ],
  },
  {
    kind: 'lpa',
    title: 'Limited Partnership Agreement',
    purpose: 'The binding agreement between the GP and LPs. The PPM describes it; this governs.',
    sections: [
      { key: 'formation', heading: 'Article 1: Formation, Name, Purpose and Term', brief: 'Formation under the recorded state law, fund name, principal office (MISSING if not known), purpose consistent with the strategy, and term and extensions.' },
      { key: 'definitions', heading: 'Article 2: Definitions', brief: 'Defined terms used in the agreement: Capital Contribution, Capital Commitment, Unreturned Capital, Preferred Return, Carried Interest, Distributable Cash, Management Fee, Partnership Expenses, Percentage Interest, and others needed. Definitions must match the economics in the fund data.' },
      { key: 'capital', heading: 'Article 3: Capital Commitments, Contributions and Defaults', brief: 'Commitments, minimum, closings, capital call mechanics and notice period, and default remedies per the capital-call terms provided. MISSING markers where not provided.' },
      { key: 'distributions', heading: 'Article 4: Distributions', brief: 'The waterfall as binding operative language: return of capital, preferred return at the recorded rate and compounding, catch-up, carried interest split, tax distributions (MISSING if unspecified), timing, and withholding.' },
      { key: 'allocations', heading: 'Article 5: Allocations of Profit and Loss', brief: 'Allocations following the distribution waterfall, with a note that tax allocation provisions require tax counsel.' },
      { key: 'management', heading: 'Article 6: Management and Authority of the General Partner', brief: 'GP authority, limits, key-person provisions if provided, and LP non-participation in management.' },
      { key: 'fees', heading: 'Article 7: Fees and Expenses', brief: 'Management fee (rate and basis), organizational expenses, operating expenses, and offsets if provided.' },
      { key: 'lp_rights', heading: 'Article 8: Limited Partners: Rights, Voting and Liability', brief: 'Limited liability, voting matters, consent thresholds (MISSING if not provided), and reports and information rights.' },
      { key: 'transfers', heading: 'Article 9: Transfers and Withdrawals', brief: 'Transfer restrictions and redemption rights per the fund data.' },
      { key: 'indemnity', heading: 'Article 10: Exculpation and Indemnification', brief: 'Standard exculpation and indemnification of the GP and manager, with a note that the standard of care is for counsel to set.' },
      { key: 'books', heading: 'Article 11: Books, Records, Reports and Tax Matters', brief: 'Books and records, reporting frequency, K-1 timing, the partnership representative, and fiscal year.' },
      { key: 'dissolution', heading: 'Article 12: Dissolution and Winding Up', brief: 'Dissolution events, liquidation order, and the final distribution under the waterfall.' },
      { key: 'misc', heading: 'Article 13: Miscellaneous', brief: 'Governing law (the formation state unless provided), dispute resolution (MISSING if not provided), amendments, notices, counterparts, and entire agreement.' },
    ],
  },
  {
    kind: 'subscription_agreement',
    title: 'Subscription Agreement',
    purpose: 'The investor’s offer to buy an interest, with representations.',
    sections: [
      { key: 'subscription', heading: 'Subscription and Acceptance', brief: 'Subscription amount, minimum, the GP’s right to accept or reject, and closing and funding mechanics.' },
      { key: 'reps', heading: 'Investor Representations and Warranties', brief: 'Accredited status, investment intent, receipt and review of the PPM and LPA, sophistication, illiquidity acknowledgement, no reliance on statements outside the documents, authority (for entities), and AML/OFAC.' },
      { key: 'verification', heading: 'Accredited Investor Verification', brief: 'If Rule 506(c) is recorded: the investor’s agreement to provide verification (third-party letter or documentation) before acceptance. Otherwise a MISSING marker for the exemption.' },
      { key: 'joinder', heading: 'Joinder to the Limited Partnership Agreement', brief: 'The investor agrees to be bound by the LPA upon acceptance; power of attorney language for counsel to confirm.' },
      { key: 'misc', heading: 'General Provisions and Signature Page', brief: 'Governing law, survival, and signature blocks for individual and entity investors, with fields for amount, name, address and tax ID (left blank).' },
    ],
  },
  {
    kind: 'investor_questionnaire',
    title: 'Investor Questionnaire',
    purpose: 'Collects investor information and accredited-investor status.',
    sections: [
      { key: 'info', heading: 'Investor Information', brief: 'Fields: legal name, investor type, address, contact details, tax ID, entity formation details, authorized signers, and beneficial owners (25% or more) for entities.' },
      { key: 'accredited', heading: 'Accredited Investor Status', brief: 'Checkboxes for each accredited-investor category under Rule 501(a) for individuals and entities, described in plain language. Note that counsel should confirm the categories are current.' },
      { key: 'verification', heading: 'Verification Method', brief: 'How the investor will be verified if Rule 506(c) is recorded: a third-party verification letter (CPA, attorney, registered broker-dealer or RIA), or income and net-worth documentation, with what each requires.' },
      { key: 'other', heading: 'Other Representations', brief: 'ERISA/benefit plan investor status, tax-exempt status, bad-actor (Rule 506(d)) questions where applicable, wire source account, and signature.' },
    ],
  },
  {
    kind: 'capital_call_notice',
    title: 'Form of Capital Call Notice',
    purpose: 'Template notice requesting a capital contribution.',
    sections: [
      { key: 'notice', heading: 'Capital Call Notice', brief: 'Template with placeholders in [brackets]: date, investor name, commitment, percentage called, amount due, due date (per the notice period in the fund data), purpose of the call, unfunded commitment after the call, and a reference to default provisions in the LPA.' },
      { key: 'wire', heading: 'Funding Instructions and Wire Fraud Warning', brief: 'Placeholders for bank details, plus a prominent warning: wiring instructions will never change by email; verify by phone with a known contact before sending.' },
    ],
  },
  {
    kind: 'side_letter',
    title: 'Form of Side Letter',
    purpose: 'Template for investor-specific terms. Use sparingly; some terms trigger MFN obligations.',
    sections: [
      { key: 'letter', heading: 'Side Letter', brief: 'Template letter from the GP to [Investor] with placeholder provisions commonly negotiated (reporting, fee arrangements, co-investment notice, confidentiality, MFN), each in [brackets] for counsel to select. Note that side letters must be consistent with the LPA and disclosed where required.' },
    ],
  },
];

export const docSpec = (kind: string) => DOCS.find((d) => d.kind === kind);

/** The fund facts the drafter may use. Blank values are listed so the model can flag them. */
export function fundFacts(fund: {
  name: string; offering_type: string; target_size: string; min_commitment: string; pref_rate: string; mgmt_fee_rate: string; terms: Record<string, unknown>;
}) {
  const t = fund.terms as Record<string, string | null | undefined>;
  const pct = (r: string) => `${(Number(r) * 100).toFixed(2).replace(/\.00$/, '')}%`;
  const money = (v: string) => `$${Number(v).toLocaleString('en-US')}`;
  const exemption: Record<string, string> = { '506c': 'Regulation D Rule 506(c)', '506b': 'Regulation D Rule 506(b)', other: 'Other (see notes)' };
  const structure: Record<string, string> = { limited_partnership: 'Limited partnership (GP/LP)', llc: 'LLC (manager/members)', master_feeder: 'Master-feeder' };

  const facts: [string, string | null | undefined][] = [
    ['Fund display name', fund.name],
    ['Fund legal name', t.fund_entity],
    ['Legal structure', t.legal_structure ? structure[t.legal_structure] ?? t.legal_structure : null],
    ['State of formation', t.formation_state],
    ['General partner / managing member', t.gp_entity],
    ['Investment manager', t.manager_entity],
    ['Principals and key people', t.principals],
    ['Securities exemption', t.exemption ? exemption[t.exemption] : null],
    ['Offering label in FundOS', fund.offering_type],
    ['Target fund size', Number(fund.target_size) > 0 ? money(fund.target_size) : null],
    ['Minimum commitment', Number(fund.min_commitment) > 0 ? money(fund.min_commitment) : null],
    ['Preferred return', Number(fund.pref_rate) > 0 ? `${pct(fund.pref_rate)} per year, ${String(t.pref_compounding ?? 'simple').replace('_', ' ')}` : null],
    ['Management fee rate', Number(fund.mgmt_fee_rate) > 0 ? `${pct(fund.mgmt_fee_rate)} per year (basis not specified unless stated in notes)` : null],
    ['GP catch-up', t.gp_catch_up],
    ['Carried interest split', t.carry_split],
    ['Distribution frequency', t.distribution_frequency],
    ['Hold period', t.hold_period_years ? `${t.hold_period_years} years` : null],
    ['Term and extensions', t.term_extension],
    ['Target net IRR (target only)', t.target_net_irr],
    ['Target equity multiple (target only)', t.target_equity_multiple],
    ['Investment strategy', t.strategy],
    ['Target markets / asset types', t.target_markets],
    ['Leverage policy', t.leverage_policy],
    ['Investor eligibility', t.investor_eligibility],
    ['Capital calls and defaults', t.capital_call_terms],
    ['Transfers and redemptions', t.transfer_redemption],
    ['Fund counsel', t.fund_counsel],
    ['Fund administrator', t.administrator],
    ['Auditor / CPA', t.auditor],
    ['Other disclosures', t.other_disclosures],
    ['Other terms / notes', t.notes as string | null],
  ];
  const known = facts.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `- ${k}: ${String(v).trim()}`);
  const unknown = facts.filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
  return { text: known.join('\n'), unknown, snapshot: Object.fromEntries(facts.map(([k, v]) => [k, v ?? null])) };
}
