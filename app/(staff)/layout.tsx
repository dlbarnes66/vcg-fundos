import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { ROLE_LABELS } from '@/lib/labels';
import { signOut } from '@/app/login/actions';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { user, orgName, role } = await requireStaff();
  return (
    <div className="shell">
      <nav className="side">
        <div className="brand"><span className="brand-mark">VCG</span> FundOS</div>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/investors">Investor pipeline</Link>
        <Link href="/capital">Capital activity</Link>
        <Link href="/documents">Data room</Link>
        <div className="spacer" />
        <div className="who">{user.email}<br />{orgName} · {ROLE_LABELS[role]}</div>
        <form action={signOut}><button type="submit">Sign out</button></form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
