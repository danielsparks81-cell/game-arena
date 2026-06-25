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
  /** HeroScape Ne-Gok-Sa Mind Shackle — a sinister "Mind Freak!" (deep + slow). */
  mindFreak: () => speak('Mind Freak!', { rate: 0.85, pitch: 0.5 }),

  // -------- HeroScape feedback cues --------
  // Wired from HeroScapeBoard: the dice overlays (hsDice + per-figure hit/block/death), the
  // lastEffect special-attack stings, the glyph-reveal banner, and the win/draw banner.
  /** Quick clatter as combat / d20 dice tumble in. */
  hsDice: () => play([
    { freq: 420, duration: 0.03, type: 'square' },
    { freq: 300, duration: 0.03, type: 'square', delay: 0.04 },
    { freq: 520, duration: 0.03, type: 'square', delay: 0.08 },
    { freq: 360, duration: 0.04, type: 'square', delay: 0.12 },
  ], 0.035),
  /** Skulls get through — a meaty thud with a metallic edge. */
  hsHit: () => play([
    { freq: 200, duration: 0.10, type: 'square' },
    { freq: 90, duration: 0.16, type: 'triangle', delay: 0.02 },
    { freq: 1200, duration: 0.04, type: 'square' },
  ], 0.085),
  /** Fully blocked — a bright shield clink, no damage. */
  hsBlocked: () => play([
    { freq: 1400, duration: 0.05, type: 'square' },
    { freq: 1900, duration: 0.06, type: 'sine', delay: 0.03 },
  ], 0.05),
  /** A figure is destroyed — a short descending knell. */
  hsDeath: () => play([
    { freq: 300, duration: 0.14, type: 'triangle' },
    { freq: 180, duration: 0.18, type: 'triangle', delay: 0.10 },
    { freq: 80, duration: 0.30, type: 'sine', delay: 0.22 },
  ], 0.08),
  /** Soft footfall as a figure steps a hex. */
  hsStep: () => play([
    { freq: 150, duration: 0.05, type: 'sine' },
    { freq: 85, duration: 0.05, type: 'triangle', delay: 0.02 },
  ], 0.03),
  /** Chomp — Grimnak's jaws snap shut. */
  hsChomp: () => play([
    { freq: 260, duration: 0.05, type: 'square' },
    { freq: 110, duration: 0.07, type: 'square', delay: 0.05 },
    { freq: 65, duration: 0.11, type: 'triangle', delay: 0.10 },
  ], 0.09),
  /** Blast — grenade / Deathwalker explosion boom. */
  hsBlast: () => play([
    { freq: 160, duration: 0.10, type: 'square' },
    { freq: 70, duration: 0.22, type: 'triangle', delay: 0.03 },
    { freq: 40, duration: 0.30, type: 'sine', delay: 0.08 },
  ], 0.11),
  /** Fire Line — a roaring tunnel of flame. */
  hsFire: () => play([
    { freq: 220, duration: 0.22, type: 'sawtooth' },
    { freq: 320, duration: 0.20, type: 'sawtooth', delay: 0.06 },
    { freq: 170, duration: 0.18, type: 'sawtooth', delay: 0.12 },
  ], 0.055),
  /** Ice Shard — a sharp frozen crack. */
  hsIce: () => play([
    { freq: 2100, duration: 0.04, type: 'square' },
    { freq: 1500, duration: 0.06, type: 'sine', delay: 0.03 },
    { freq: 2700, duration: 0.05, type: 'sine', delay: 0.07 },
  ], 0.05),
  /** Acid Breath — a caustic hiss. */
  hsAcid: () => play([
    { freq: 900, duration: 0.20, type: 'sawtooth' },
    { freq: 680, duration: 0.18, type: 'sawtooth', delay: 0.06 },
    { freq: 480, duration: 0.18, type: 'sawtooth', delay: 0.12 },
  ], 0.04),
  /** Counter Strike — a bright blade clang reflected back at the attacker. */
  hsSword: () => play([
    { freq: 1800, duration: 0.05, type: 'square' },
    { freq: 2400, duration: 0.08, type: 'sine', delay: 0.03 },
    { freq: 1200, duration: 0.10, type: 'triangle', delay: 0.06 },
  ], 0.06),
  /** A glyph is revealed — a mystical ascending chime. */
  hsGlyph: () => play([
    { freq: 700, duration: 0.10, type: 'sine' },
    { freq: 1050, duration: 0.14, type: 'sine', delay: 0.07 },
    { freq: 1400, duration: 0.22, type: 'sine', delay: 0.14 },
  ], 0.06),
  /** A figure falls off a ledge — a descending thud (used for any fall: normal/major/extreme). */
  hsFall: () => play([
    { freq: 240, duration: 0.06, type: 'sine' },
    { freq: 120, duration: 0.10, type: 'triangle', delay: 0.05 },
    { freq: 55, duration: 0.18, type: 'sine', delay: 0.11 },
  ], 0.09),
  /** Order marker flips up at turn start — a soft paper/cardboard tick. Kept quiet (heard every turn). */
  hsTurn: () => play([
    { freq: 520, duration: 0.035, type: 'triangle' },
    { freq: 700, duration: 0.05, type: 'sine', delay: 0.03 },
  ], 0.03),
  /** Berserker Charge — a low rising battle growl as the Tarn re-arm. */
  hsBerserk: () => play([
    { freq: 110, duration: 0.12, type: 'sawtooth' },
    { freq: 165, duration: 0.14, type: 'sawtooth', delay: 0.07 },
    { freq: 90, duration: 0.12, type: 'square', delay: 0.14 },
  ], 0.06),
  /** Throw — an arcing whoosh as Jotun hurls a figure across the board. */
  hsThrow: () => play([
    { freq: 300, duration: 0.06, type: 'sine' },
    { freq: 640, duration: 0.08, type: 'sine', delay: 0.05 },
    { freq: 380, duration: 0.10, type: 'triangle', delay: 0.13 },
  ], 0.05),
  /** The Drop — a descending parachute whistle into a soft landing thud. */
  hsDrop: () => play([
    { freq: 950, duration: 0.10, type: 'sine' },
    { freq: 520, duration: 0.12, type: 'sine', delay: 0.08 },
    { freq: 200, duration: 0.10, type: 'triangle', delay: 0.18 },
    { freq: 85, duration: 0.14, type: 'sine', delay: 0.26 },
  ], 0.06),
  /** Water Clone — a watery shimmer as a Warrior re-forms from the river. */
  hsWaterClone: () => play([
    { freq: 620, duration: 0.06, type: 'sine' },
    { freq: 920, duration: 0.07, type: 'sine', delay: 0.05 },
    { freq: 760, duration: 0.11, type: 'triangle', delay: 0.11 },
  ], 0.045),

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
