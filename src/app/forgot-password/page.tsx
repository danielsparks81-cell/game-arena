'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <h1 className="text-2xl font-semibold">Reset password</h1>

        {sent ? (
          <>
            <p className="text-sm text-emerald-400">
              Done. If <span className="font-medium">{email}</span> is registered, a reset link is on the way.
              Check your inbox (and spam) and click the link to set a new password.
            </p>
            <Link
              href="/login"
              className="block w-full rounded-md border border-neutral-700 px-4 py-2 text-center text-sm hover:bg-neutral-800"
            >
              Back to log in
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-sm text-neutral-400">
              Enter the email you signed up with and we&apos;ll send you a link to set a new password.
            </p>
            <label className="block">
              <span className="mb-1 block text-sm text-neutral-400">Email</span>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-emerald-500"
              />
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit" disabled={loading || !email.trim()}
              className="w-full rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <p className="text-center text-sm text-neutral-400">
              Remembered it? <Link href="/login" className="text-emerald-400 hover:underline">Log in</Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
