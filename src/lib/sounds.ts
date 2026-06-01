// Lightweight Web Audio SFX — no asset files needed.
// All tones are generated on the fly. Safe to call before user gesture (browsers
// will lazily resume the context).
//
// Mute respects the global user preference managed by useSoundsMuted: both
// play() and speak() bail early when the user has toggled the speaker icon off.

import { areSoundsMuted } from './useSoundsMuted';

let audioCtx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch { return null; }
  }
  return audioCtx;
}

/** Call once on first user gesture (e.g. clicking a cell) to permit playback. */
export function unlockAudio() {
  if (unlocked) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  unlocked = true;
}

type Tone = { freq: number; duration?: number; type?: OscillatorType; delay?: number };

function play(tones: Tone[], volume = 0.06, { ignoreMute = false }: { ignoreMute?: boolean } = {}) {
  if (!ignoreMute && areSoundsMuted()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const t0 = c.currentTime;
  for (const { freq, duration = 0.12, type = 'sine', delay = 0 } of tones) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(volume, t0 + delay);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + duration);
    osc.connect(g).connect(c.destination);
    osc.start(t0 + delay);
    osc.stop(t0 + delay + duration + 0.02);
  }
}

/**
 * Speak a phrase using the browser's built-in SpeechSynthesis API. No audio assets needed.
 * Safe no-op on SSR or when speechSynthesis is unavailable.
 */
function speak(text: string, opts: { rate?: number; pitch?: number; volume?: number } = {}) {
  if (areSoundsMuted()) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate ?? 1.05;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 1;
    // Cancel any in-progress utterance so the announcement isn't delayed
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* no-op */ }
}

/**
 * Plays the "your turn" chime, intentionally bypassing the Game Sound mute.
 * Turn notifications are governed by a separate user preference (the bell)
 * so a player who silenced clicks/win-sounds can still get pinged on their
 * turn. Use `sounds.notify()` for any other purely-informational chimes
 * that should respect Game Sound mute.
 */
export function playTurnChime() {
  play([
    { freq: 880,  duration: 0.10, type: 'sine' },
    { freq: 1175, duration: 0.15, type: 'sine', delay: 0.08 },
  ], 0.07, { ignoreMute: true });
}

export const sounds = {
  click: () => play([
    { freq: 880, duration: 0.05, type: 'square' },
    { freq: 660, duration: 0.05, type: 'square', delay: 0.04 },
  ], 0.04),
  drop: () => play([
    { freq: 240, duration: 0.06, type: 'sine' },
    { freq: 140, duration: 0.10, type: 'sine', delay: 0.03 },
    { freq:  80, duration: 0.08, type: 'triangle', delay: 0.08 },
  ], 0.08),
  win: () => play([
    { freq: 523, duration: 0.20, type: 'triangle' },                  // C5
    { freq: 659, duration: 0.20, type: 'triangle', delay: 0.10 },     // E5
    { freq: 784, duration: 0.35, type: 'triangle', delay: 0.20 },     // G5
    { freq: 1047, duration: 0.45, type: 'triangle', delay: 0.30 },    // C6
  ], 0.08),
  draw: () => play([
    { freq: 330, duration: 0.25, type: 'triangle' },
    { freq: 247, duration: 0.30, type: 'triangle', delay: 0.15 },
  ], 0.06),
  notify: () => play([
    { freq: 880, duration: 0.10, type: 'sine' },
    { freq: 1175, duration: 0.15, type: 'sine', delay: 0.08 },
  ], 0.07),
  /** Spoken announcement at race start: "And they're off!" */
  theyreOff: () => speak("And they're off!", { rate: 1.1, pitch: 1.05 }),
  /** Spoken cue after the host rolls: "When the [N] horse moves". */
  whenHorseMoves: (n: number) => speak(`When the ${n} horse moves`, { rate: 1.05, pitch: 1.0 }),

  // -------- Spellduel feedback cues --------
  // Each is mapped 1:1 to an SDEvent kind by SpellduelBoard's event-diff effect.
  /** Soft whoosh as a card moves from hand into the field. */
  sdCardPlay: () => play([
    { freq: 540, duration: 0.07, type: 'sine' },
    { freq: 800, duration: 0.09, type: 'sine', delay: 0.05 },
  ], 0.05),
  /** Punchy thud for a damaging spell connecting. */
  sdDamage: () => play([
    { freq: 220, duration: 0.10, type: 'square' },
    { freq:  90, duration: 0.16, type: 'triangle', delay: 0.04 },
  ], 0.09),
  /** Gentle uplift for heal. */
  sdHeal: () => play([
    { freq: 523, duration: 0.14, type: 'sine' },                      // C5
    { freq: 784, duration: 0.18, type: 'sine', delay: 0.08 },         // G5
  ], 0.06),
  /** Sharp ding for prevent_damage triggers firing. */
  sdCounter: () => play([
    { freq: 1320, duration: 0.06, type: 'square' },
    { freq: 1760, duration: 0.10, type: 'sine', delay: 0.04 },
  ], 0.06),
  /** Bright shimmer for drawing a card. */
  sdDraw: () => play([
    { freq: 988, duration: 0.06, type: 'triangle' },
    { freq: 1318, duration: 0.08, type: 'triangle', delay: 0.05 },
  ], 0.045),
  /** Mana gain — short bright bell. */
  sdMana: () => play([
    { freq: 1175, duration: 0.07, type: 'sine' },
    { freq: 1568, duration: 0.10, type: 'sine', delay: 0.05 },
  ], 0.05),
  /** Tense thump for paying HP cost (Sacrifice). */
  sdPayHp: () => play([
    { freq: 180, duration: 0.10, type: 'sine' },
  ], 0.07),
  /** Single clock tick — short, punchy mechanical click for countdown use. */
  tick: () => play([
    { freq: 1100, duration: 0.016, type: 'square'   },
    { freq:  650, duration: 0.022, type: 'triangle', delay: 0.013 },
  ], 0.08),
  /** Tense low hum as a trigger arms. */
  sdTriggerArmed: () => play([
    { freq: 280, duration: 0.12, type: 'triangle' },
    { freq: 360, duration: 0.10, type: 'triangle', delay: 0.06 },
  ], 0.05),
  /** Defeat tone for losing the duel. */
  sdLose: () => play([
    { freq: 392, duration: 0.18, type: 'triangle' },                  // G4
    { freq: 330, duration: 0.20, type: 'triangle', delay: 0.12 },     // E4
    { freq: 247, duration: 0.45, type: 'triangle', delay: 0.24 },     // B3
  ], 0.07),

  // -------- Long Shot feedback cues --------
  /** Ascending fanfare when a horse crosses the finish line in 1st place. */
  lsHorseFinish1st: () => play([
    { freq: 523,  duration: 0.12, type: 'triangle' },               // C5
    { freq: 659,  duration: 0.12, type: 'triangle', delay: 0.08 },  // E5
    { freq: 784,  duration: 0.12, type: 'triangle', delay: 0.16 },  // G5
    { freq: 1047, duration: 0.30, type: 'triangle', delay: 0.24 },  // C6
    { freq: 1319, duration: 0.35, type: 'triangle', delay: 0.32 },  // E6
  ], 0.09),
  /** Shorter ding for a 2nd-place finish. */
  lsHorseFinish2nd: () => play([
    { freq: 587, duration: 0.12, type: 'triangle' },                // D5
    { freq: 740, duration: 0.12, type: 'triangle', delay: 0.09 },   // F#5
    { freq: 880, duration: 0.30, type: 'triangle', delay: 0.18 },   // A5
  ], 0.07),
  /** Brief tone for a 3rd-place finish. */
  lsHorseFinish3rd: () => play([
    { freq: 440, duration: 0.10, type: 'triangle' },                // A4
    { freq: 554, duration: 0.25, type: 'triangle', delay: 0.08 },   // C#5
  ], 0.06),
  /** Alert jingle when the 3rd horse finishes and the final round begins. */
  lsFinalRound: () => play([
    { freq: 880, duration: 0.10, type: 'sine' },
    { freq: 740, duration: 0.10, type: 'sine', delay: 0.08 },
    { freq: 587, duration: 0.22, type: 'sine', delay: 0.16 },
  ], 0.07),
  /** Soft confirmation click for buy / helmet / jersey actions. */
  lsAction: () => play([
    { freq: 660, duration: 0.06, type: 'triangle' },
    { freq: 880, duration: 0.08, type: 'triangle', delay: 0.05 },
  ], 0.04),
};
