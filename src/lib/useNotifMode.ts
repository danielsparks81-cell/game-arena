'use client';

import { useSyncExternalStore } from 'react';

/**
 * Three-way user preference for turn notifications:
 *   • silent     — never chime / popup
 *   • background — only when this tab is hidden or unfocused (default)
 *   • always     — every time the turn cycles back to me, focused or not
 *
 * Persisted in localStorage and shared across all components in the page via
 * useSyncExternalStore. Also syncs across browser tabs via the `storage`
 * event, so toggling the bell in one game updates every open game tab too.
 */

export type NotifMode = 'silent' | 'background' | 'always';
const KEY = 'turnNotifMode';
// Default for any brand-new visitor: ping me only when the tab is hidden.
// Once the user clicks the bell to change it, their choice is written to
// localStorage and persists for the browser (cross-tab synced).
const DEFAULT: NotifMode = 'background';

// In-page subscribers (cross-tab updates use the native `storage` event).
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

function getSnapshot(): NotifMode {
  if (typeof window === 'undefined') return DEFAULT;
  const v = window.localStorage.getItem(KEY);
  return v === 'silent' || v === 'always' || v === 'background' ? v : DEFAULT;
}

function getServerSnapshot(): NotifMode {
  return DEFAULT;
}

export function useNotifMode(): [NotifMode, (m: NotifMode) => void] {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const set = (m: NotifMode) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(KEY, m);
    emit();
  };
  return [mode, set];
}

/** Cycle order for the bell click: silent → background → always → silent → … */
export function nextNotifMode(m: NotifMode): NotifMode {
  return m === 'silent' ? 'background' : m === 'background' ? 'always' : 'silent';
}
