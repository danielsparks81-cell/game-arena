'use client';

// Quest narration via the browser's built-in Speech Synthesis — reads the quest
// briefing and the "special notes" (boxed Quest-Book text) aloud, in a low,
// slow narrator voice. No audio files to host; everything is spoken on-device.

import { useCallback, useEffect, useState } from 'react';

const KEY = 'hq-narration';

export function narrationSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Pick a deepish English voice for the "Zargon" narrator feel, if one exists. */
function pickVoice(): SpeechSynthesisVoice | null {
  const vs = window.speechSynthesis.getVoices();
  if (!vs.length) return null;
  return (
    vs.find(v => /en[-_]GB/i.test(v.lang) && /daniel|george|arthur|male/i.test(v.name)) ||
    vs.find(v => /daniel|george|arthur|male/i.test(v.name)) ||
    vs.find(v => /^en/i.test(v.lang)) ||
    vs[0]
  );
}

/** Speak text aloud (cancelling anything already speaking). */
export function speak(text: string): void {
  if (!narrationSupported() || !text.trim()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 0.94;   // a touch slow + low for gravitas
    u.pitch = 0.85;
    synth.speak(u);
  } catch { /* ignore */ }
}

export function cancelSpeech(): void {
  if (!narrationSupported()) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

/** Narration on/off preference (persisted), plus support detection. */
export function useNarration() {
  const [enabled, setEnabledState] = useState(true);
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v != null) setEnabledState(v === '1'); } catch { /* ignore */ }
    // Some browsers load voices asynchronously — nudge them to populate.
    if (narrationSupported()) { try { window.speechSynthesis.getVoices(); } catch { /* ignore */ } }
  }, []);
  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
    if (!on) cancelSpeech();
  }, []);
  return { enabled, setEnabled, supported: narrationSupported() };
}
