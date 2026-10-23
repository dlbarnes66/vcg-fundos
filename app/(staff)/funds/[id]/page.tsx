import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, CAPITAL_ROLES } from '@/lib/session';
import { Flash } from '@/lib/flash';
import type { Fund } from '@/lib/funds';
import { FundForm } from '../fund-form';
import { updateFund } from '../actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> };

export default async function FundPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, role } = await requireStaff();
  const { data: fund } = await supabase
    .from('funds')
    .select('id, name, offering_type, status, target_size, min_commitment, pref_rate, mgmt_fee_rate, terms')
    .eq('id', id)
    .maybeSingle();
  if (!fund) notFound();

  return (
    <div className="stack">
      <div>
        <Link href="/funds" className="small">← Funds</Link>
        <h1 style={{ marginTop: 8 }}>{fund.name}</h1>
        <p className="sub" style={{ marginBottom: 0 }}>Every change to these terms is kept in the audit log.</p>
      </div>
      <Flash ok={sp.ok} error={sp.error} />
      <FundForm fund={fund as Fund} action={updateFund.bind(null, id)} canEdit={CAPITAL_ROLES.includes(role)} submitLabel="Save terms" />
    </div>
  );
}
