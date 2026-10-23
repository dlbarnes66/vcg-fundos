// Leads and early contact live in CRM OS. FundOS starts once a prospect is qualified.
// ('lead' and 'contacted' remain in the database enum for compatibility only.)
export const STAGES = [
  ['qualified', 'Qualified'],
  ['due_diligence', 'Due diligence'],
  ['soft_circled', 'Soft-circled'],
  ['docs_sent', 'Docs sent'],
  ['committed', 'Committed'],
  ['funded', 'Funded'],
  ['declined', 'Declined'],
] as const;
export type Stage = (typeof STAGES)[number][0];
const LEGACY_STAGES: Record<string, string> = { lead: 'Lead', contacted: 'Contacted' };
export const stageLabel = (s: string) => STAGES.find(([k]) => k === s)?.[1] ?? LEGACY_STAGES[s] ?? s;

export const INVESTOR_TYPES = [
  ['individual', 'Individual'],
  ['joint', 'Joint'],
  ['trust', 'Trust'],
  ['llc', 'LLC'],
  ['partnership', 'Partnership'],
  ['corporation', 'Corporation'],
  ['ira', 'Self-directed IRA'],
  ['other', 'Other'],
] as const;

export const ACCREDITATION = [
  ['not_started', 'Not started', ''],
  ['pending', 'Pending', 'warn'],
  ['verified', 'Verified', 'good'],
  ['expired', 'Expired', 'bad'],
  ['rejected', 'Rejected', 'bad'],
] as const;
export const accreditation = (s: string) => ACCREDITATION.find(([k]) => k === s) ?? ACCREDITATION[0];

export const TXN_KINDS = [
  ['contribution', 'Contribution'],
  ['distribution', 'Distribution'],
  ['return_of_capital', 'Return of capital'],
  ['fee', 'Fee'],
] as const;
export const txnLabel = (s: string) => (s === 'reversal' ? 'Reversal' : TXN_KINDS.find(([k]) => k === s)?.[1] ?? s);

export const DOC_CATEGORIES = [
  ['offering', 'Offering (PPM, fact sheet)'],
  ['subscription', 'Subscription docs'],
  ['report', 'Quarterly report'],
  ['tax', 'Tax (K-1, W-9)'],
  ['accreditation', 'Accreditation evidence'],
  ['notice', 'Notice'],
  ['general', 'General'],
] as const;

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  investor_relations: 'Investor relations',
  viewer: 'Viewer',
  investor: 'Investor',
};
