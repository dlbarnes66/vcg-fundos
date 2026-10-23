'use server';

import { requireRole, WRITE_ROLES, CAPITAL_ROLES } from '@/lib/session';
import { back, errorText } from '@/lib/flash';

export async function completeItem(id: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, user } = await requireRole(WRITE_ROLES);
    const notRequired = formData.get('not_required') === 'yes';
    const completedOn = String(formData.get('completed_on') ?? '') || new Date().toISOString().slice(0, 10);
    const reference = String(formData.get('reference') ?? '').trim() || null;
    const notes = String(formData.get('notes') ?? '').trim() || null;
    if (!notRequired && !reference) throw new Error('Enter the filing or confirmation number (or mark it Not required).');
    if (notRequired && !notes) throw new Error('Note why it is not required (e.g. "Counsel: no filing in this state").');
    const { error } = await supabase.from('compliance_items').update({
      status: notRequired ? 'not_required' : 'done', completed_on: completedOn, completed_by: user.id,
      reference, notes: notes?.slice(0, 2000),
    }).eq('id', id);
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back('/compliance', err ? 'error' : 'ok', err ?? 'Recorded.');
}

export async function reopenItem(id: string) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const { error } = await supabase.from('compliance_items').update({ status: 'open', completed_on: null, completed_by: null }).eq('id', id);
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back('/compliance', err ? 'error' : 'ok', err ?? 'Reopened.');
}

export async function addItem(formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, orgId } = await requireRole(WRITE_ROLES);
    const title = String(formData.get('title') ?? '').trim();
    const due = String(formData.get('due_date') ?? '');
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Enter a title and due date');
    const { error } = await supabase.from('compliance_items').insert({
      organization_id: orgId, fund_id: String(formData.get('fund_id')), kind: 'custom',
      state: String(formData.get('state') ?? '') || null, title: title.slice(0, 200), due_date: due,
      basis: String(formData.get('basis') ?? '').trim().slice(0, 1000) || null,
    });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back('/compliance', err ? 'error' : 'ok', err ?? 'Added.');
}

export async function deleteItem(id: string) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const { error } = await supabase.from('compliance_items').delete().eq('id', id).eq('kind', 'custom');
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back('/compliance', err ? 'error' : 'ok', err ?? 'Deleted.');
}
