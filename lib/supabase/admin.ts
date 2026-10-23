import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. SERVER ONLY, and used for exactly one thing: creating sign-in
 * links for invites. All permission checks happen first, with the caller's own session,
 * in database functions (add_staff_member, link_portal_user, user_exists).
 * Never import this from a client component, and never use it to read or write fund data.
 */
export function adminClient() {
  if (typeof window !== 'undefined') throw new Error('adminClient is server-only');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Invites need SUPABASE_SERVICE_ROLE_KEY set in Vercel (type: Secret).');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
