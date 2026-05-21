'use client';

import { useSyncExternalStore } from 'react';

/**
 * Per-user mute preference for ALL in-app sounds (clicks, drops, win, draw,
 * notify, spoken cues). Backed by localStorage so it survives reloads, and
 * synced across browser tabs via the native `storage` event — toggle the
 * speaker in one tab, every other open tab goes mute too.
 *
 * The sounds.ts module reads the same localStorage key directly via
 * `areSoundsMuted()` so it doesn't need React to short-circuit playback.
 */

// Default for any brand-new visitor: Game Sound is ON. Stored as the literal
// '1' if the user has explicitly muted; absence of the key = unmuted.
// Toggling the speaker icon writes/removes this key — choice persists for
// the browser and syncs across tabs.
const KEY = 'soundsMuted';

const listeners = new Set<() => void>();
function emit() { listeners.forEach(l => l()); }

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(KEY) === '1';
}

function getServerSnapshot(): boolean {
  return false;
}

export function useSoundsMuted(): [boolean, (muted: boolean) => void] {
  const muted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const set = (m: boolean) => {
    if (typeof window === 'undefined') return;
    if (m) window.localStorage.setItem(KEY, '1');
    else   window.localStorage.removeItem(KEY);
    emit();
  };
  return [muted, set];
}

/** Non-React read for sounds.ts — checked on every play() / speak() call. */
export function areSoundsMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
}
