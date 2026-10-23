'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, WRITE_ROLES } from '@/lib/session';
import { errorText } from '@/lib/flash';
import { redirect } from 'next/navigation';

/** Staff writers and outside counsel can comment on draft sections. `back` is the page to return to. */
export async function addComment(draftId: string, sectionId: string | null, back: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, orgId, user } = await requireRole([...WRITE_ROLES, 'counsel']);
    const body = String(formData.get('body') ?? '').trim();
    if (!body) throw new Error('Write a comment first');
    const { error } = await supabase.from('doc_comments').insert({
      organization_id: orgId, draft_id: draftId, section_id: sectionId, author_id: user.id, body: body.slice(0, 4000),
    });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  revalidatePath(back);
  redirect(`${back}${err ? `?error=${encodeURIComponent(err)}` : ''}#${sectionId ? `s-${sectionId}` : 'comments'}`);
}

export async function resolveComment(commentId: string, back: string) {
  const { supabase, user } = await requireRole([...WRITE_ROLES, 'counsel']);
  await supabase.from('doc_comments').update({ resolved_at: new Date().toISOString(), resolved_by: user.id }).eq('id', commentId);
  revalidatePath(back);
  redirect(back);
}
