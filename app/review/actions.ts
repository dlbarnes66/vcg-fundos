'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/session';
import { errorText } from '@/lib/flash';

export async function counselApprove(draftId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(['counsel']);
    if (formData.get('confirm') !== 'yes') throw new Error('Tick the box to confirm.');
    const { error } = await supabase.rpc('counsel_approve', { p_draft: draftId, p_note: String(formData.get('note') ?? '').trim() || null });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  redirect(`/review/${draftId}?${err ? `error=${encodeURIComponent(err)}` : 'ok=1'}`);
}
