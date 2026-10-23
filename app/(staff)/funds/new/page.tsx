import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { Flash } from '@/lib/flash';
import { FundForm } from '../fund-form';
import { createFund } from '../actions';

export default async function NewFundPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const { role } = await requireStaff();
  if (!CAPITAL_ROLES.includes(role)) redirect('/funds');
  return (
    <div className="stack">
      <div>
        <Link href="/funds" className="small">← Funds</Link>
        <h1 style={{ marginTop: 8 }}>New fund</h1>
        <p className="sub" style={{ marginBottom: 0 }}>Start as Draft. Switch to Raising when the PPM is final.</p>
      </div>
      <Flash error={sp.error} />
      <FundForm action={createFund} canEdit submitLabel="Create fund" />
    </div>
  );
}
