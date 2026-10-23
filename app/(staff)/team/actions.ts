'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, CAPITAL_ROLES, type Role } from '@/lib/session';
import { back, errorText } from '@/lib/flash';
import { signInLink, sendInviteEmail, type InviteState } from '@/lib/invite';
import { adminClient } from '@/lib/supabase/admin';

const STAFF: Role[] = ['owner', 'admin', 'investor_relations', 'viewer'];
const emailOf = (f: FormData) => String(f.get('email') ?? '').trim().toLowerCase();
const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254;

/** Invite a team member: create their login link, grant the role, email the link (or hand it back to copy). */
export async function inviteMember(_prev: InviteState, formData: FormData): Promise<InviteState> {
  try {
    const { supabase, orgId, orgName } = await requireRole(CAPITAL_ROLES);
    const email = emailOf(formData);
    const role = String(formData.get('role') ?? '') as Role;
    if (!validEmail(email)) return { error: 'Enter a valid email address.' };
    if (!STAFF.includes(role)) return { error: 'Choose a role.' };

    const { url, isNew } = await signInLink(supabase, orgId, email);
    const { error } = await supabase.rpc('add_staff_member', { p_org: orgId, p_email: email, p_role: role });
    if (error) throw error;

    revalidatePath('/team');
    const sent = await sendInviteEmail({ to: email, orgName, url, forInvestor: false, isNew }).catch(() => false);
    return sent
      ? { ok: `Invite emailed to ${email}.` }
      : { ok: `${email} was added. Email isn't set up yet, so send them this one-time link yourself:`, link: url };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/** New one-time sign-in link for an existing member (lost password, expired invite). */
export async function sendMemberLink(email: string, _prev: InviteState): Promise<InviteState> {
  try {
    const { supabase, orgId, orgName } = await requireRole(CAPITAL_ROLES);
    const { url } = await signInLink(supabase, orgId, email);
    const sent = await sendInviteEmail({ to: email, orgName, url, forInvestor: false, isNew: false }).catch(() => false);
    return sent ? { ok: `Sign-in link emailed to ${email}.` } : { ok: 'Send them this one-time link:', link: url };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function changeRole(userId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, orgId } = await requireRole(['owner']);
    const { error } = await supabase.rpc('set_member_role', { p_org: orgId, p_user: userId, p_role: String(formData.get('role')) });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back('/team', err ? 'error' : 'ok', err ?? 'Role updated.');
}

export async function removeMember(userId: string) {
  let err: string | undefined;
  try {
    const { supabase, orgId, user } = await requireRole(['owner']);
    if (userId === user.id) throw new Error("You can't remove yourself.");
    const { error } = await supabase.rpc('remove_member', { p_org: orgId, p_user: userId });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back('/team', err ? 'error' : 'ok', err ?? 'Removed. They can no longer sign in to this organization.');
}

/** Owner only: remove a team member's authenticator (lost phone). They set it up again at next sign-in. */
export async function resetMemberMfa(userId: string) {
  let err: string | undefined;
  try {
    const { supabase, orgId, user } = await requireRole(['owner']);
    if (userId === user.id) throw new Error('Manage your own two-factor from Sign-in security.');
    // Confirm they're on this organization's team before touching their account.
    const { data: members, error: mErr } = await supabase.rpc('org_members', { p_org: orgId });
    if (mErr) throw mErr;
    if (!(members as { user_id: string }[]).some((m) => m.user_id === userId)) throw new Error('Not a member of your team');
    const admin = adminClient();
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error) throw error;
    for (const f of data.factors) {
      const { error: dErr } = await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
      if (dErr) throw dErr;
    }
  } catch (e) {
    err = errorText(e);
  }
  back('/team', err ? 'error' : 'ok', err ?? 'Two-factor reset. They will set it up again at their next sign-in.');
}
