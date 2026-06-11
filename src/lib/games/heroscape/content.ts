// HeroScape — card content (slice-1 roster) + dice.
//
// Stats are AS PRINTED in docs/heroscape/cards.md (the rebalanced modern
// printing — e.g. Marro Warriors are Range 6 / 105 points there, NOT the
// classic 2004 values). Slice 2 uses Move / Range / Attack / Defense / Life
// (Master combat wounds) and IGNORES special powers entirely; Height rides
// along as card data for later slices.

import type { CombatFace, HSCardDef, HSGlyphId } from './types';

export const HS_CARDS: Record<string, HSCardDef> = {
  finn: {
    id: 'finn',
    name: 'Finn the Viking Champion',
    shortName: 'Finn',
    type: 'hero',
    figures: 1,
    life: 4,
    move: 5,
    range: 1,
    attack: 3,
    defense: 4,
    height: 5,
    points: 80,
    letter: 'F',
  },
  thorgrim: {
    id: 'thorgrim',
    name: 'Thorgrim the Viking Champion',
    shortName: 'Thorgrim',
    type: 'hero',
    figures: 1,
    life: 4,
    move: 5,
    range: 1,
    attack: 3,
    defense: 4,
    height: 5,
    points: 80,
    letter: 'T',
  },
  tarn_vikings: {
    id: 'tarn_vikings',
    name: 'Tarn Viking Warriors',
    shortName: 'Tarn Viking',
    type: 'squad',
    figures: 4,
    life: 1,
    move: 4,
    range: 1,
    attack: 3,
    defense: 4,
    height: 5,
    points: 50,
    letter: 'T',
  },
  marro_warriors: {
    id: 'marro_warriors',
    name: 'Marro Warriors',
    shortName: 'Marro Warrior',
    type: 'squad',
    figures: 4,
    life: 1,
    move: 6,
    range: 6,
    attack: 2,
    defense: 3,
    height: 4,
    points: 105,
    letter: 'M',
  },
};

/** Slice-1 fixed armies by roster index (hero first):
 *  Player 1 = Finn + Tarn Viking Warriors, Player 2 = Thorgrim + Marro
 *  Warriors (the pairing test-maps.md suggests for the Training Field). */
export const SLICE1_ARMIES: ReadonlyArray<readonly string[]> = [
  ['finn', 'tarn_vikings'],
  ['thorgrim', 'marro_warriors'],
];

/**
 * The combat d6: 3 skulls / 2 shields / 1 blank.
 * ⚠ Documented assumption — the rulebook never states the face distribution;
 * this is the community-standard split adopted by the slice-1 spec. The
 * SERVER action samples uniformly from this array (the engine never rolls).
 */
export const COMBAT_DIE_FACES: readonly CombatFace[] = [
  'skull',
  'skull',
  'skull',
  'shield',
  'shield',
  'blank',
];

// ============================================================================
// Glyphs — static definitions (slice 4; docs/heroscape/05-glyphs-special-
// powers.md + extraction/resolutions.md, verbatim effects).
// ============================================================================

/** How a glyph activates (05-glyphs §1, "Permanent vs. temporary"):
 *  • 'permanent' — active ONLY while one of your figures stands on the glyph;
 *    benefits the WHOLE army of the occupying figure's controller (army-wide
 *    aura, not occupant-only). Switches controller on occupancy change.
 *  • 'temporary' — fires exactly once when a figure stops on it, then the glyph
 *    is removed from the game.
 *  • 'artifact'  — Brandar; no fixed power (scenario-defined; deferred). */
export type HSGlyphKind = 'permanent' | 'temporary' | 'artifact';

export type HSGlyphDef = {
  id: HSGlyphId;
  /** Glyph's proper name (e.g. "Glyph of Astrid"). */
  name: string;
  /** Map/badge key letter (A/G/I/V/D/K/E/M/B) — 05-glyphs §1 / Glyphs Key. */
  letter: string;
  kind: HSGlyphKind;
  /** One-line effect text for the UI tooltip. */
  effect: string;
  /** True once its effect is implemented in slice 4. Deferred glyphs
   *  (Erland/Mitonsoul/Brandar) are placed but inert (still a forced stop). */
  active: boolean;
};

/**
 * Glyph effect table. Slice 4 implements the five PERMANENT glyphs and the
 * temporary HEALER (Kelda); the rest carry definitions so the framework slots
 * them in later but are inert (`active:false`). Effect text is taken verbatim
 * from the resolutions extraction.
 */
export const HS_GLYPHS: Record<HSGlyphId, HSGlyphDef> = {
  astrid: {
    id: 'astrid',
    name: 'Glyph of Astrid',
    letter: 'A',
    kind: 'permanent',
    effect: 'Attack +1 — each figure you control rolls one extra attack die.',
    active: true,
  },
  gerda: {
    id: 'gerda',
    name: 'Glyph of Gerda',
    letter: 'G',
    kind: 'permanent',
    effect: 'Defense +1 — each figure you control rolls one extra defense die.',
    active: true,
  },
  ivor: {
    id: 'ivor',
    name: 'Glyph of Ivor',
    letter: 'I',
    kind: 'permanent',
    effect: 'Range +4 — each figure you control with Range 4 or more adds 4 to its Range.',
    active: true,
  },
  valda: {
    id: 'valda',
    name: 'Glyph of Valda',
    letter: 'V',
    kind: 'permanent',
    effect: 'Move +2 — each figure you control adds 2 to its Move (not the move off the glyph).',
    active: true,
  },
  dagmar: {
    id: 'dagmar',
    name: 'Glyph of Dagmar',
    letter: 'D',
    kind: 'permanent',
    effect: 'Initiative +8 — add 8 to your initiative roll.',
    active: true,
  },
  kelda: {
    id: 'kelda',
    name: 'Glyph of Kelda',
    letter: 'K',
    kind: 'temporary',
    effect: 'Healer — only a wounded figure may stop here; it loses all wounds, then the glyph is removed.',
    active: true,
  },
  // ---- deferred (framework only; placed inert, still a forced stop) ----
  erland: {
    id: 'erland',
    name: 'Glyph of Erland',
    letter: 'E',
    kind: 'temporary',
    effect: 'Summoning (not yet implemented).',
    active: false, // slice 5: Erland summon
  },
  mitonsoul: {
    id: 'mitonsoul',
    name: 'Glyph of Mitonsoul',
    letter: 'M',
    kind: 'temporary',
    effect: 'Massive Curse (not yet implemented).',
    active: false, // slice 5: Mitonsoul mass curse
  },
  brandar: {
    id: 'brandar',
    name: 'Glyph of Brandar',
    letter: 'B',
    kind: 'artifact',
    effect: 'Artifact — rules vary per Game Scenario.',
    active: false, // scenario: Brandar artifact
  },
};
