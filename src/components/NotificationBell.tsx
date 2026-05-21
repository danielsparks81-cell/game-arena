'use client';

import { useEffect, useState } from 'react';
import { unlockAudio } from '@/lib/sounds';
import { useNotifMode, nextNotifMode, type NotifMode } from '@/lib/useNotifMode';

/**
 * Three-way bell toggle for turn notifications. Click cycles through:
 *   silent → background → always → silent → …
 *
 * Visual cues:
 *   • silent     — grey bell with a slash through it
 *   • background — outline bell with a tiny "bg" pill
 *   • always     — solid emerald bell
 *
 * On any non-silent selection we also (a) unlock the AudioContext using the
 * bell click as the user gesture so the first chime actually plays, and
 * (b) request browser-notification permission once if it's still 'default'.
 * Mode preference syncs across tabs via the `storage` event in useNotifMode.
 */
export default function NotificationBell() {
  const [mode, setMode] = useNotifMode();
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission(null);
      return;
    }
    setPermission(Notification.permission);
  }, []);

  async function onClick() {
    unlockAudio(); // bell click is a user gesture — wake the AudioContext
    const next = nextNotifMode(mode);
    setMode(next);

    // First time the user opts in to notifications: ask the browser.
    if (next !== 'silent'
        && permission === 'default'
        && typeof window !== 'undefined'
        && 'Notification' in window) {
      const result = await Notification.requestPermission();
      setPermission(result);
    }
  }

  // Hide entirely on browsers without the Notification API — the chime still
  // works via sounds.notify(), but there's nothing to toggle here.
  if (permission === null) return null;

  // Turn Notification = chime + browser popup when the turn cycles back to
  // you. Independent of Game Sound (the speaker icon governs that), so a
  // player can mute clicks/win fanfares while still getting pinged on their
  // turn — or vice versa.
  const tipBase: Record<NotifMode, string> = {
    silent:     'Turn Notification: off',
    background: 'Turn Notification: when this tab is hidden',
    always:     'Turn Notification: every turn',
  };
  const permNote = permission === 'denied'
    ? ' (popups blocked by browser — chime still plays)'
    : permission === 'default'
      ? ' — click again to grant permission'
      : '';
  const title = `${tipBase[mode]}${permNote}. Click to cycle.`;

  const palette: Record<NotifMode, string> = {
    silent:     'border-neutral-800 bg-neutral-950 text-neutral-500 hover:bg-neutral-900',
    background: 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800',
    always:     'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`relative flex h-7 w-7 items-center justify-center rounded-md border text-sm transition ${palette[mode]}`}
    >
      {mode === 'silent' ? (
        // Bell with a diagonal slash
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M3.5 3.5l17 17-1.4 1.4L17 19.8a1.5 1.5 0 01-1.5 1.2h-7A1.5 1.5 0 017 19.5h3v.5a1 1 0 002 0v-.5h2.6l-12-12L2.1 4.9 3.5 3.5zM12 2a6 6 0 016 6v3.2l3 3V18l-2-1-13-13V8a6 6 0 015-5.92V2a1 1 0 012 0z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M12 2a6 6 0 00-6 6v3.59l-1.7 1.7A1 1 0 005 15h14a1 1 0 00.7-1.71L18 11.59V8a6 6 0 00-6-6zm0 20a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0012 22z" />
        </svg>
      )}
      {/* Tiny mode-state pip in the corner */}
      {mode === 'background' && (
        <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-neutral-400" />
      )}
      {mode === 'always' && (
        <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
      )}
    </button>
  );
}
