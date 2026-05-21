'use client';

import { useEffect, useRef } from 'react';
import { playTurnChime } from './sounds';
import { useNotifMode } from './useNotifMode';

/**
 * Fires a browser notification + chime when the turn transitions back to the
 * current user, but only if the tab is in the background (hidden or unfocused).
 * No-op if the user hasn't granted notification permission or if Notifications
 * aren't supported (Safari/iOS in private mode, e.g.).
 *
 * Tracks the previous active player via a ref so we only fire on the *edge* —
 * not on every render where activeId === currentUserId.
 */
export function useTurnNotification({
  activeId,
  currentUserId,
  gameName,
  enabled,
}: {
  activeId: string | null;
  currentUserId: string;
  gameName: string;
  /** Master kill-switch (e.g. game is finished, viewer isn't seated). */
  enabled: boolean;
}) {
  const prevActiveRef = useRef<string | null | undefined>(undefined);
  const [mode] = useNotifMode();

  useEffect(() => {
    if (!enabled || mode === 'silent') {
      prevActiveRef.current = activeId;
      return;
    }
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeId;

    // Skip the very first render (prev === undefined) so we don't notify just
    // because you opened a page where it was already your turn.
    if (prev === undefined) return;
    if (prev === activeId) return;
    if (activeId !== currentUserId) return;

    // `background` mode gates on whether the tab is hidden / unfocused.
    // `always` fires on every transition regardless of focus.
    if (mode === 'background') {
      const inBackground =
        typeof document !== 'undefined' &&
        (document.hidden || !document.hasFocus());
      if (!inBackground) return;
    }

    // Chime first — carries even if browser notifications are blocked. Uses
    // the dedicated turn-chime path that bypasses Game Sound mute, so silencing
    // game SFX doesn't also silence "your turn" pings (the bell mode owns that).
    try { playTurnChime(); } catch { /* AudioContext not unlocked yet, ignore */ }

    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      const n = new Notification(`Your turn — ${gameName}`, {
        body: 'Tap to come back.',
        tag: `turn-${gameName}`,           // collapse repeats into one
        silent: false,
        icon: '/favicon.ico',
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // Some browsers throw if called outside a user gesture; safe to swallow.
    }
  }, [activeId, currentUserId, gameName, enabled]);
}
