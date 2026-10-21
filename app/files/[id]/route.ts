import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Opens a document for staff or investors. RLS decides whether the row (and the
 *  storage object) is visible; every successful open is written to the access log. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('Not signed in', { status: 401 });

  const { data: doc } = await supabase
    .from('documents')
    .select('id, organization_id, storage_path')
    .eq('id', id)
    .maybeSingle();
  if (!doc) return new NextResponse('Not found', { status: 404 });

  const { data: signed, error } = await supabase.storage.from('documents').createSignedUrl(doc.storage_path, 60);
  if (error || !signed) return new NextResponse('Could not open file', { status: 500 });

  await supabase.from('document_access_log').insert({
    organization_id: doc.organization_id,
    document_id: doc.id,
    user_id: user.id,
  });

  return NextResponse.redirect(signed.signedUrl);
}
