'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords don’t match.'); return; }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      // Most common cause: the recovery link expired or was already used.
      setError(error.message + ' — try requesting a new reset link.');
      return;
    }
    router.push('/lobby');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6"
      >
        <h1 className="text-2xl font-semibold">Set a new password</h1>
        <p className="text-sm text-neutral-400">
          You&apos;re signed in from the reset link. Pick a new password and you&apos;ll be taken to the lobby.
        </p>

        <label className="block">
          <span className="mb-1 block text-sm text-neutral-400">New password (min 6 chars)</span>
          <input
            type="password" required minLength={6}
            value={password} onChange={e => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-emerald-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-neutral-400">Confirm password</span>
          <input
            type="password" required minLength={6}
            value={confirm} onChange={e => setConfirm(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-emerald-500"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit" disabled={loading}
          className="w-full rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Save new password'}
        </button>

        <p className="text-center text-sm text-neutral-400">
          Changed your mind? <Link href="/lobby" className="text-emerald-400 hover:underline">Back to lobby</Link>
        </p>
      </form>
    </main>
  );
}
