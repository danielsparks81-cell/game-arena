'use client';

import { useSoundsMuted } from '@/lib/useSoundsMuted';
import { sounds, unlockAudio } from '@/lib/sounds';

/**
 * Single speaker icon button that toggles all in-app sounds on/off. Lives in
 * the TopBar (right side) so it's reachable from anywhere — lobby, room,
 * profile. The preference persists via localStorage and syncs across tabs
 * through the `storage` event in useSoundsMuted.
 */
export default function SoundToggle() {
  const [muted, setMuted] = useSoundsMuted();

  function onClick() {
    if (muted) {
      // Un-muting on a user click is a perfect moment to unlock the
      // AudioContext and play a tiny acknowledgement so you can confirm sound
      // is actually working.
      setMuted(false);
      unlockAudio();
      try { sounds.click(); } catch { /* AudioContext race, ignore */ }
    } else {
      setMuted(true);
    }
  }

  // Game Sound = in-game SFX (move clicks, drops, win/draw fanfares, spoken
  // race cues). Independent of Turn Notification, which the bell governs.
  const label = muted
    ? 'Game Sound: off (click to unmute)'
    : 'Game Sound: on (click to mute)';
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md border text-sm transition ${
        muted
          ? 'border-neutral-800 bg-neutral-950 text-neutral-500 hover:bg-neutral-900'
          : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
      }`}
    >
      {muted ? (
        // Speaker with a slash through it
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M3.5 3.5l17 17-1.4 1.4-3.4-3.4-1.7 1.7v.3L9 22V14.4L3 8.4 4.4 7 5.6 8.2 9 5V2l5 4 1.6 1.6L20.5 2.1 3.5 3.5zM14 7.4L11 5v3l3 3V7.4z" />
        </svg>
      ) : (
        // Standard speaker
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4zM14 3v2a7 7 0 010 14v2a9 9 0 000-18z" />
        </svg>
      )}
    </button>
  );
}
