'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null);
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    if (data.session) {
      router.push('/lobby');
      router.refresh();
    } else {
      setInfo('Account created. Check your email for a confirmation link, then log in.');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <h1 className="text-2xl font-semibold">Create account</h1>
        <label className="block">
          <span className="mb-1 block text-sm text-neutral-400">Email</span>
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-emerald-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-neutral-400">Password (min 6 chars)</span>
          <input
            type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-emerald-500"
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {info  && <p className="text-sm text-emerald-400">{info}</p>}
        <button
          type="submit" disabled={loading}
          className="w-full rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-center text-sm text-neutral-400">
          Already have an account? <Link href="/login" className="text-emerald-400 hover:underline">Log in</Link>
        </p>
      </form>
    </main>
  );
}
