'use server';

import { revalidatePath } from 'next/cache';
import { requireRole, CAPITAL_ROLES } from '@/lib/session';
import { back, errorText } from '@/lib/flash';
import { docSpec, fundFacts } from '@/lib/doc-templates';
import { draftSection, checkConsistency, extractMarkers } from '@/lib/drafting';
import type { Fund } from '@/lib/funds';

const FUND_COLS = 'id, name, offering_type, status, target_size, min_commitment, pref_rate, mgmt_fee_rate, terms';
const MAX_CHECK_BYTES = 30 * 1024 * 1024;

/** New version of a document. Copies the latest version's sections so edits carry forward. */
export async function createVersion(fundId: string, kind: string) {
  let id: string | undefined;
  let err: string | undefined;
  try {
    const { supabase, orgId, user } = await requireRole(CAPITAL_ROLES);
    const spec = docSpec(kind);
    if (!spec) throw new Error('Unknown document type');
    const { data: fund } = await supabase.from('funds').select(FUND_COLS).eq('id', fundId).single();
    if (!fund) throw new Error('Fund not found');

    const { data: prev } = await supabase
      .from('doc_drafts').select('id, version, status').eq('fund_id', fundId).eq('kind', kind)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    const { data: prevSections } = prev
      ? await supabase.from('doc_sections').select('key, content, missing, ai_generated, edited_by_human').eq('draft_id', prev.id)
      : { data: [] };

    const { data: draft, error } = await supabase
      .from('doc_drafts')
      .insert({
        organization_id: orgId, fund_id: fundId, kind,
        version: (prev?.version ?? 0) + 1,
        terms_snapshot: fundFacts(fund as Fund).snapshot,
        created_by: user.id,
      })
      .select('id').single();
    if (error) throw error;
    id = draft.id;

    const carried = new Map((prevSections ?? []).map((s) => [s.key, s]));
    const { error: secErr } = await supabase.from('doc_sections').insert(
      spec.sections.map((s, i) => ({
        organization_id: orgId, draft_id: draft.id, position: i, key: s.key, heading: s.heading,
        content: carried.get(s.key)?.content ?? null,
        missing: carried.get(s.key)?.missing ?? [],
        ai_generated: carried.get(s.key)?.ai_generated ?? false,
        edited_by_human: carried.get(s.key)?.edited_by_human ?? false,
      })),
    );
    if (secErr) throw secErr;

    if (prev && prev.status !== 'superseded') {
      await supabase.from('doc_drafts').update({ status: 'superseded' }).eq('id', prev.id);
    }
  } catch (e) {
    err = errorText(e);
  }
  if (err) back(`/studio?fund=${fundId}`, 'error', err);
  back(`/studio/${id}`, 'ok', 'New version started.');
}

async function loadEditable(sectionId: string) {
  const s = await requireRole(CAPITAL_ROLES);
  const { data: section } = await s.supabase
    .from('doc_sections').select('id, draft_id, key, heading, content').eq('id', sectionId).single();
  if (!section) throw new Error('Section not found');
  const { data: draft } = await s.supabase
    .from('doc_drafts').select('id, kind, status, fund_id').eq('id', section.draft_id).single();
  if (!draft) throw new Error('Draft not found');
  if (draft.status === 'approved' || draft.status === 'superseded') throw new Error(`This version is ${draft.status}. Start a new version to make changes.`);
  return { ...s, section, draft };
}

/** Draft (or redraft) one section with Claude. Called one section at a time by the page. */
export async function generateSection(sectionId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, section, draft } = await loadEditable(sectionId);
    const spec = docSpec(draft.kind)!;
    const sectionSpec = spec.sections.find((x) => x.key === section.key);
    if (!sectionSpec) throw new Error('This section is no longer in the template');
    const { data: fund } = await supabase.from('funds').select(FUND_COLS).eq('id', draft.fund_id).single();
    const facts = fundFacts(fund as Fund);

    const { content, missing } = await draftSection({
      doc: spec, section: sectionSpec, facts: facts.text, unknown: facts.unknown,
      priorHeadings: spec.sections.map((x) => x.heading),
    });
    const { error } = await supabase.from('doc_sections')
      .update({ content, missing, ai_generated: true, edited_by_human: false, updated_at: new Date().toISOString() })
      .eq('id', sectionId);
    if (error) throw error;
    revalidatePath(`/studio/${draft.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

export async function saveSection(sectionId: string, formData: FormData) {
  let err: string | undefined;
  let draftId = '';
  try {
    const { supabase, draft } = await loadEditable(sectionId);
    draftId = draft.id;
    const content = String(formData.get('content') ?? '');
    if (content.length > 100_000) throw new Error('Section is too long');
    const { error } = await supabase.from('doc_sections')
      .update({ content, missing: extractMarkers(content), edited_by_human: true, updated_at: new Date().toISOString() })
      .eq('id', sectionId);
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/studio/${draftId}#s-${sectionId}`, err ? 'error' : 'ok', err ?? 'Section saved.');
}

export async function sendToCounsel(draftId: string) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(CAPITAL_ROLES);
    const { error } = await supabase.from('doc_drafts')
      .update({ status: 'in_review', sent_to_counsel_at: new Date().toISOString() }).eq('id', draftId).eq('status', 'draft');
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/studio/${draftId}`, err ? 'error' : 'ok', err ?? 'Marked as sent to counsel. Export the Word file and send it to them.');
}

/** Records that counsel approved this version. Blocked while any section is empty or has open markers. */
export async function recordApproval(draftId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase } = await requireRole(['owner']);
    const counsel = String(formData.get('counsel') ?? '').trim();
    const note = String(formData.get('note') ?? '').trim() || null;
    if (counsel.length < 3) throw new Error("Enter counsel's name (and firm).");
    if (formData.get('confirm') !== 'yes') throw new Error('Tick the box to confirm counsel approved this exact version.');

    const { data: sections } = await supabase.from('doc_sections').select('heading, content, missing').eq('draft_id', draftId);
    const empty = (sections ?? []).filter((s) => !s.content?.trim()).map((s) => s.heading);
    const open = (sections ?? []).reduce((n, s) => n + extractMarkers(s.content ?? '').length, 0);
    if (empty.length) throw new Error(`These sections are still empty: ${empty.join(', ')}`);
    if (open) throw new Error(`${open} Missing/Counsel item(s) are still open. Resolve them in the text first.`);

    const { error } = await supabase.from('doc_drafts')
      .update({ status: 'approved', approved_by_name: counsel, approved_at: new Date().toISOString(), approval_note: note })
      .eq('id', draftId);
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/studio/${draftId}`, err ? 'error' : 'ok', err ?? 'Approval recorded. This version is now locked.');
}

export async function deleteDraft(draftId: string) {
  let err: string | undefined;
  let fundId = '';
  try {
    const { supabase } = await requireRole(['owner']);
    const { data: d } = await supabase.from('doc_drafts').select('fund_id').eq('id', draftId).single();
    fundId = d?.fund_id ?? '';
    const { error } = await supabase.from('doc_drafts').delete().eq('id', draftId);
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/studio${fundId ? `?fund=${fundId}` : ''}`, err ? 'error' : 'ok', err ?? 'Draft deleted.');
}

/** Consistency check of selected data-room PDFs and/or drafts against the fund record. */
export async function runCheck(fundId: string, formData: FormData) {
  let err: string | undefined;
  try {
    const { supabase, orgId, user } = await requireRole(CAPITAL_ROLES);
    const docIds = formData.getAll('doc').map(String).slice(0, 4);
    const draftIds = formData.getAll('draft').map(String).slice(0, 4);
    if (!docIds.length && !draftIds.length) throw new Error('Choose at least one document to check.');

    const { data: fund } = await supabase.from('funds').select(FUND_COLS).eq('id', fundId).single();
    if (!fund) throw new Error('Fund not found');
    const docs: { title: string; pdfBase64?: string; text?: string }[] = [];
    const sources: { type: string; id: string; title: string }[] = [];
    let bytes = 0;

    if (docIds.length) {
      const { data: rows } = await supabase.from('documents').select('id, title, storage_path').in('id', docIds);
      for (const r of rows ?? []) {
        if (!r.storage_path.toLowerCase().endsWith('.pdf')) throw new Error(`"${r.title}" isn't a PDF. Save it as PDF and upload it to the data room.`);
        const { data: blob, error } = await supabase.storage.from('documents').download(r.storage_path);
        if (error || !blob) throw new Error(`Couldn't open "${r.title}"`);
        bytes += blob.size;
        if (bytes > MAX_CHECK_BYTES) throw new Error('Those files are too large to check together. Check them one or two at a time.');
        docs.push({ title: r.title, pdfBase64: Buffer.from(await blob.arrayBuffer()).toString('base64') });
        sources.push({ type: 'document', id: r.id, title: r.title });
      }
    }
    for (const did of draftIds) {
      const { data: d } = await supabase.from('doc_drafts').select('id, kind, version').eq('id', did).single();
      const { data: secs } = await supabase.from('doc_sections').select('heading, content, position').eq('draft_id', did).order('position');
      if (!d) continue;
      const title = `${docSpec(d.kind)?.title ?? d.kind} (FundOS draft v${d.version})`;
      docs.push({ title, text: (secs ?? []).map((s) => `## ${s.heading}\n\n${s.content ?? '(empty)'}`).join('\n\n') });
      sources.push({ type: 'draft', id: d.id, title });
    }

    const result = await checkConsistency({ facts: fundFacts(fund as Fund).text, docs });
    const { error } = await supabase.from('doc_checks').insert({
      organization_id: orgId, fund_id: fundId, sources, findings: result.findings, summary: result.summary, created_by: user.id,
    });
    if (error) throw error;
  } catch (e) {
    err = errorText(e);
  }
  back(`/studio?fund=${fundId}#checks`, err ? 'error' : 'ok', err ?? 'Check complete. Results are below.');
}

