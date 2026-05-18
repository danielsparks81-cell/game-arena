// Lightweight Web Audio SFX — no asset files needed.
// All tones are generated on the fly. Safe to call before user gesture (browsers
// will lazily resume the context).

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

function play(tones: Tone[], volume = 0.06) {
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
};
