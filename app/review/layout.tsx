import Link from 'next/link';
import { requireCounsel } from '@/lib/session';
import { signOut } from '@/app/login/actions';

export default async function ReviewLayout({ children }: { children: React.ReactNode }) {
  const { user, orgName } = await requireCounsel();
  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{ background: 'var(--navy)', color: '#fff' }}>
        <div className="row between" style={{ maxWidth: 1000, margin: '0 auto', padding: '14px 16px' }}>
          <Link href="/review" className="brand" style={{ padding: 0, color: '#fff' }}><span className="brand-mark">VCG</span> Counsel review · {orgName}</Link>
          <div className="row small">
            <span style={{ color: '#9aa6c0' }}>{user.email}</span>
            <Link href="/account/security" style={{ color: '#fff' }}>Security</Link>
            <form action={signOut}><button type="submit" className="ghost" style={{ color: '#fff', borderColor: '#4a5b85' }}>Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="stack" style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 16px' }}>{children}</main>
    </div>
  );
}
