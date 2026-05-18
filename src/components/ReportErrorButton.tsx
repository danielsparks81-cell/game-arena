'use client';

import { useState, useTransition } from 'react';
import { reportError } from '@/app/rooms/[id]/actions';

/**
 * Small red exclamation button that opens a modal for the user to describe a bug.
 * Submits to the `reportError` server action which saves to DB and (if configured)
 * emails the report.
 */
export default function ReportErrorButton({ roomId }: { roomId: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setText('');
    setSubmitted(false);
    setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const description = text.trim();
    if (!description) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await reportError({
          roomId,
          description,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          url: typeof window !== 'undefined' ? window.location.href : undefined,
        });
        if (res.ok) setSubmitted(true);
        else setError(res.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not submit report');
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Report a bug"
        aria-label="Report a bug"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-red-500/70 bg-red-500/10 text-sm font-bold text-red-400 transition hover:bg-red-500/30"
      >
        !
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-5"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-1 text-lg font-semibold">Report a bug</h3>
            <p className="mb-3 text-xs text-neutral-400">
              Briefly describe what went wrong. We&apos;ll send it along with the room ID and your browser info.
            </p>

            {submitted ? (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                Thanks — the report was submitted.
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={5}
                  maxLength={2000}
                  required
                  placeholder="What happened? Steps to reproduce, what you expected vs. what you saw…"
                  className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <div className="flex items-center justify-between text-[10px] text-neutral-500">
                  <span>{text.length}/2000</span>
                  {error && <span className="text-red-400">{error}</span>}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pending || !text.trim()}
                    className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {pending ? 'Sending…' : 'Send report'}
                  </button>
                </div>
              </form>
            )}

            {submitted && (
              <div className="mt-3 text-right">
                <button
                  onClick={close}
                  className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
