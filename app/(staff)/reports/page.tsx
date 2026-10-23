import { requireStaff, CAPITAL_ROLES } from '@/lib/session';

const ITEMS: [string, string, string][] = [
  ['capital', 'Capital transactions', 'Every contribution, distribution, return of capital, fee and reversal, with signed amounts for reconciliation.'],
  ['capital-accounts', 'Capital accounts', 'Per investor: committed, contributed, unfunded, distributed, capital returned.'],
  ['commitments', 'Commitments', 'Amounts, status and signing dates by investor and fund.'],
  ['investors', 'Investors', 'Contact details, pipeline stage and accreditation status with dates.'],
  ['subscriptions', 'Subscriptions', 'Onboarding status, amounts, signature and review dates. No tax IDs.'],
  ['audit', 'Audit log', 'Full change history as JSON, for an auditor.'],
];

export default async function ReportsPage() {
  const { role } = await requireStaff();
  const allowed = CAPITAL_ROLES.includes(role);
  return (
    <div className="stack">
      <div>
        <h1>Exports</h1>
        <p className="sub" style={{ marginBottom: 0 }}>CSV files that open in Excel or Numbers, for your CPA, fund administrator or auditor.</p>
      </div>
      {!allowed && <div className="alert error">Only owners and admins can export.</div>}
      <div className="grid g2">
        {ITEMS.map(([k, title, desc]) => (
          <div className="card" key={k}>
            <h2>{title}</h2>
            <p className="small muted">{desc}</p>
            {allowed && <a className="btn" href={`/export/${k}`}>Download CSV</a>}
          </div>
        ))}
      </div>
      <p className="small muted">Exports contain confidential investor information. Store and share them securely.</p>
    </div>
  );
}
