import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type Role = 'owner' | 'admin' | 'investor_relations' | 'viewer' | 'investor';

export const STAFF_ROLES: Role[] = ['owner', 'admin', 'investor_relations', 'viewer'];
export const WRITE_ROLES: Role[] = ['owner', 'admin', 'investor_relations'];
export const CAPITAL_ROLES: Role[] = ['owner', 'admin'];

/** Loads the signed-in user and their single organization membership.
 *  The UI uses `role` only to show or hide controls; the database enforces access. */
export async function getSession() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id, role, organizations(name)')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect('/login?error=no-access');

  const org = membership.organizations as unknown as { name: string } | null;
  return {
    supabase,
    user,
    orgId: membership.organization_id as string,
    orgName: org?.name ?? '',
    role: membership.role as Role,
  };
}

export async function requireStaff() {
  const s = await getSession();
  if (!STAFF_ROLES.includes(s.role)) redirect('/portal');
  return s;
}

export async function requireRole(roles: Role[]) {
  const s = await getSession();
  if (!roles.includes(s.role)) throw new Error('You do not have permission to do that.');
  return s;
}
