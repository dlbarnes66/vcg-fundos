'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function setPassword(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const fail = (m: string) => redirect(`/welcome?error=${encodeURIComponent(m)}`);

  if (password.length < 12) fail('Use at least 12 characters.');
  if (password !== confirm) fail("The two passwords don't match.");

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) fail(error.message);
  redirect('/');
}
