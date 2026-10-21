'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, CAPITAL_ROLES } from '@/lib/session';
import { back, errorText } from '@/lib/flash';

export type CreateKeyState = { key?: string; error?: string };

/** Returns the plaintext key to the form once. It is never stored or put in a URL. */
export async function createKey(_prev: CreateKeyState, formData: FormData): Promise<CreateKeyState> {
  try {
    const { supabase, orgId } = await requireRole(CAPITAL_ROLES);
    const { data, error } = await supabase.rpc('create_intake_key', {
      p_org: orgId,
      p_label: String(formData.get('label') ?? ''),
    });
    if (error) throw error;
    revalidatePath('/settings');
    return { key: data as string };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function revokeKey(id: string) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const { error } = await supabase.rpc('revoke_intake_key', { p_id: id });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back('/settings', err ? 'error' : 'ok', err ?? 'Key revoked. CRM OS calls with it will now fail.');
}
