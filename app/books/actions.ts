'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, CAPITAL_ROLES } from '@/lib/session';
import { back, errorText } from '@/lib/flash';
import { sendEmail } from '@/lib/notify';

/** Upload one investor's K-1 (or other tax form). It appears in their portal; they're emailed if email is set up. */
export async function uploadTaxForm(investorId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, orgId, user } = await requireRole(['accountant', ...CAPITAL_ROLES]);
    const file = formData.get('file');
    const year = String(formData.get('year') ?? '');
    const form = String(formData.get('form') ?? 'Schedule K-1');
    if (!/^20\d\d$/.test(year)) throw new Error('Choose the tax year');
    if (!(file instanceof File) || file.size === 0) throw new Error('Choose a PDF');
    if (file.type !== 'application/pdf') throw new Error('Tax forms must be PDFs');
    if (file.size > 20 * 1024 * 1024) throw new Error('Files are limited to 20 MB');
    const { data: inv } = await supabase.from('investors').select('display_name, portal_user_id').eq('id', investorId).single();
    if (!inv) throw new Error('Investor not found');

    const path = `${orgId}/tax/${year}/${investorId}-${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { contentType: 'application/pdf', upsert: false });
    if (upErr) throw upErr;
    const title = `${form.slice(0, 60)} (${year})`;
    const { error } = await supabase.from('documents').insert({
      organization_id: orgId, investor_id: investorId, title, category: 'tax', visibility: 'investor',
      storage_path: path, size_bytes: file.size, uploaded_by: user.id,
    });
    if (error) throw error;

    if (inv.portal_user_id && formData.get('notify') === 'yes') {
      const { data: email } = await supabase.rpc('portal_email', { p_investor_id: investorId });
      if (email) await sendEmail({
        to: [email as string],
        subject: `Your ${title} is ready`,
        heading: 'Tax document available',
        lines: [`Your ${title} is now in your investor portal under Documents.`],
        button: { label: 'Open investor portal', path: '/portal' },
      });
    }
  } catch (e) {
    err = errorText(e);
  }
  revalidatePath('/books');
  back('/books#tax', err ? 'error' : 'ok', err ?? 'Uploaded to the investor\'s portal.');
}
