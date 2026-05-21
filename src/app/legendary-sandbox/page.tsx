// Card sandbox — author-time tool for designing Legendary hero card packs.
// Auth-gated (just to keep it tidy / discoverable only to signed-in users).
// The sandbox itself is fully client-side: state lives in localStorage, no
// DB roundtrip. Output is TypeScript code you paste into the codebase.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import LegendarySandbox from '@/components/LegendarySandbox';

export default async function SandboxPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/legendary-sandbox');
  return <LegendarySandbox />;
}
