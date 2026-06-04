// HeroQuest map sandbox — author-time tool for laying out quest maps on the
// grid (double-wide halls and all) and exporting ready-to-paste quest data.
// Auth-gated to keep it discoverable only to signed-in users. Fully client
// side: state lives in localStorage, output is code you paste into content.ts.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SandboxTabs from '@/components/heroquest/SandboxTabs';

export default async function HeroQuestSandboxPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/heroquest-sandbox');
  return <SandboxTabs />;
}
