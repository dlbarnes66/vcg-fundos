'use server';

import { requireRole, WRITE_ROLES, CAPITAL_ROLES } from '@/lib/session';
import { back, errorText } from '@/lib/flash';
import { DOC_CATEGORIES } from '@/lib/labels';

const ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
]);
const MAX_BYTES = 25 * 1024 * 1024;

export async function uploadDocument(formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, user, orgId } = await requireRole(WRITE_ROLES);
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) throw new Error('Choose a file');
    if (file.size > MAX_BYTES) throw new Error('Files are limited to 25 MB');
    if (!ALLOWED.has(file.type)) throw new Error('Upload a PDF, Word, Excel, PNG or JPEG file');

    const title = String(formData.get('title') ?? '').trim() || file.name;
    const category = String(formData.get('category') ?? 'general');
    if (!DOC_CATEGORIES.some(([k]) => k === category)) throw new Error('Unknown category');
    const visibility = String(formData.get('visibility') ?? 'internal');
    const investorId = String(formData.get('investor_id') ?? '') || null;
    const fundId = String(formData.get('fund_id') ?? '') || null;
    if (visibility === 'investor' && !investorId) throw new Error('Choose which investor this is for');

    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
    const path = `${orgId}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from('documents').upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (upErr) throw upErr;

    const { error } = await supabase.from('documents').insert({
      organization_id: orgId,
      fund_id: fundId,
      investor_id: visibility === 'investor' ? investorId : null,
      title,
      category,
      visibility,
      storage_path: path,
      size_bytes: file.size,
      uploaded_by: user.id,
    });
    if (error) {
      await supabase.storage.from('documents').remove([path]);
      throw error;
    }
  } catch (e) {
    err = errorText(e);
  }
  back('/documents', err ? 'error' : 'ok', err ?? 'Uploaded.');
}

export async function deleteDocument(id: string) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const { data: doc } = await supabase.from('documents').select('storage_path').eq('id', id).single();
    if (!doc) throw new Error('Document not found');
    const { error: rmErr } = await supabase.storage.from('documents').remove([doc.storage_path]);
    if (rmErr) throw rmErr;
    const { error } = await supabase.from('documents').delete().eq('id', id);
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back('/documents', err ? 'error' : 'ok', err ?? 'Deleted.');
}
