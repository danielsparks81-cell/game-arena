import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import TopBar from '@/components/TopBar';
import ProfileForm from './ProfileForm';

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, created_at')
    .eq('id', user.id)
    .single();

  const username = profile?.username ?? 'player';
  const joined = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar username={username} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Profile</h1>
          <Link href="/lobby" className="text-sm text-emerald-400 hover:underline">← Back to lobby</Link>
        </div>

        <section className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <ProfileForm initialUsername={username} />
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm">
          <h2 className="mb-3 font-medium text-neutral-300">Account</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-neutral-400">
            <dt>Email</dt><dd className="text-neutral-200">{user.email}</dd>
            <dt>Joined</dt><dd className="text-neutral-200">{joined}</dd>
            <dt>User ID</dt><dd className="font-mono text-xs text-neutral-500">{user.id}</dd>
          </dl>
        </section>
      </main>
    </div>
  );
}
