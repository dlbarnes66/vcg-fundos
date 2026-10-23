import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { docSpec } from '@/lib/doc-templates';
import { draftToDocx } from '@/lib/docx-export';

/** Word download of a draft. RLS limits this to staff of the draft's organization. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Not signed in', { status: 401 });

  const { data: draft } = await supabase.from('doc_drafts').select('*').eq('id', id).maybeSingle();
  if (!draft) return new NextResponse('Not found', { status: 404 });
  const [{ data: sections }, { data: fund }] = await Promise.all([
    supabase.from('doc_sections').select('heading, content').eq('draft_id', id).order('position'),
    supabase.from('funds').select('name, terms').eq('id', draft.fund_id).single(),
  ]);
  const title = docSpec(draft.kind)?.title ?? draft.kind;
  const fundName = ((fund?.terms as Record<string, string> | undefined)?.fund_entity || fund?.name) ?? 'Fund';

  const buf = await draftToDocx({
    title, fundName, version: draft.version, status: draft.status,
    approvedBy: draft.approved_by_name, approvedAt: draft.approved_at, sections: sections ?? [],
  });
  const file = `${fundName} - ${title} v${draft.version}${draft.status === 'approved' ? '' : ' DRAFT'}.docx`.replace(/[^\w .()-]+/g, '');
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'no-store',
    },
  });
}
