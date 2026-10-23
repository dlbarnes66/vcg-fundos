import { redirect } from 'next/navigation';
import { getSession, STAFF_ROLES } from '@/lib/session';

export default async function Home() {
  const { role } = await getSession();
  redirect(STAFF_ROLES.includes(role) ? '/dashboard' : role === 'counsel' ? '/review' : '/portal');
}
