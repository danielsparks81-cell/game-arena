'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateUsername, updateAccentColor } from './actions';
import { ACCENT_PALETTE, safeAccent } from '@/lib/accentColors';

export default function ProfileForm({
  initialUsername,
  initialAccent,
}: {
  initialUsername: string;
  initialAccent?: string | null;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(initialUsername);
  const [accent, setAccent] = useState<string>(safeAccent(initialAccent));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(false);
    const fd = new FormData();
    fd.set('username', username);
    startTransition(async () => {
      const res = await updateUsername(fd);
      if (res.ok) {
        setSuccess(true);
        router.refresh();
      } else {
        setError(res.error || 'Could not update.');
      }
    });
  }

  const changed = username.trim() !== initialUsername;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-neutral-400">Username / nickname</span>
        <input
          value={username}
          onChange={e => { setUsername(e.target.value); setSuccess(false); setError(null); }}
          maxLength={20}
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-emerald-500"
        />
        <span className="mt-1 block text-xs text-neutral-500">
          3–20 characters · letters, digits, <code>_</code>, or <code>-</code>. This is what other players see.
        </span>
      </label>

      {/* Accent color — click-to-save (no submit). Shown as a swatch grid
          plus a live preview of your name in the chosen color. */}
      <div>
        <span className="mb-1 block text-sm text-neutral-400">Display color</span>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PALETTE.map(c => {
            const selected = accent === c;
            return (
              <button
                key={c}
                type="button"
                disabled={pending}
                onClick={() => {
                  setAccent(c);
                  setSuccess(false); setError(null);
                  startTransition(async () => {
                    const res = await updateAccentColor(c);
                    if (res.ok) { setSuccess(true); router.refresh(); }
                    else setError(res.error || 'Could not update color.');
                  });
                }}
                aria-label={`Accent color ${c}`}
                className={`h-7 w-7 rounded-full border-2 transition ${
                  selected ? 'border-neutral-100 ring-2 ring-neutral-100/30' : 'border-neutral-700 hover:border-neutral-400'
                } disabled:cursor-not-allowed`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Preview: <span className="font-medium" style={{ color: accent }}>{username || 'your name'}</span>
        </p>
      </div>

      {error   && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-400">Saved.</p>}

      <button
        type="submit"
        disabled={!changed || pending}
        className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
