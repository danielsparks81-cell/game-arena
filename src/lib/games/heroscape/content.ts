// HeroScape — card content (the full 16-card roster) + dice.
//
// Stats are AS PRINTED in docs/heroscape/cards.md (the rebalanced modern
// printing — e.g. Marro Warriors are Range 6 / 105 points there, NOT the
// classic 2004 values). The Master Game uses Move / Range / Attack / Defense /
// Life (Master combat wounds); Height drives climbing/engagement/falls.
//
// SLICE 5 (docs/heroscape/slice-5-spec.md): all 16 cards become DRAFTABLE. Each
// carries a `power: 'live' | 'wip'` flag — `live` cards (Finn, Thorgrim, Tarn,
// Marro) keep their slice-4 special powers; the other 12 play STAT-ONLY (no
// power handler — the engine's power dispatch keys off card id, so a `wip` card
// simply has no handler and fights with its printed stats) and are tagged
// "⚡ powers WIP" in the draft UI. The remaining powers land in slice 6+.
//
// Figure counts: Hero cards field 1; squad counts are rulebook-sourced
// (cards.md §Roster summary): Tarn 4, Marro 4, Airborne Elite 4, Zettian 2,
// Krav Maga 3, Izumi 3.

import type { CombatFace, HSCardDef, HSGlyphId } from './types';

export const HS_CARDS: Record<string, HSCardDef> = {
  // ---- Jandar ----
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
    power: 'live',
  },
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
    power: 'live',
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
    power: 'live',
  },
  airborne_elite: {
    id: 'airborne_elite',
    name: 'Airborne Elite',
    shortName: 'Airborne',
    type: 'squad',
    figures: 4,
    life: 1,
    move: 4,
    range: 8,
    attack: 3,
    defense: 2,
    height: 5,
    points: 110,
    letter: 'A',
    power: 'wip',
  },
  drake: {
    id: 'drake',
    name: 'Sgt. Drake Alexander',
    shortName: 'Drake',
    type: 'hero',
    figures: 1,
    life: 5,
    move: 5,
    range: 1,
    attack: 6,
    defense: 3,
    height: 5,
    points: 110,
    letter: 'D',
    power: 'wip',
  },
  raelin: {
    id: 'raelin',
    name: 'Raelin the Kyrie Warrior',
    shortName: 'Raelin',
    type: 'hero',
    figures: 1,
    life: 5,
    move: 6,
    range: 1,
    attack: 3,
    defense: 3,
    height: 5,
    points: 120,
    letter: 'R',
    power: 'wip',
  },
  // ---- Utgar ----
  zettian_guards: {
    id: 'zettian_guards',
    name: 'Zettian Guards',
    shortName: 'Zettian',
    type: 'squad',
    figures: 2,
    life: 1,
    move: 4,
    range: 7,
    attack: 2,
    defense: 7,
    height: 5,
    points: 70,
    letter: 'Z',
    power: 'wip',
  },
  ne_gok_sa: {
    id: 'ne_gok_sa',
    name: 'Ne-Gok-Sa',
    shortName: 'Ne-Gok-Sa',
    type: 'hero',
    figures: 1,
    life: 5,
    move: 5,
    range: 1,
    attack: 3,
    defense: 6,
    height: 5,
    points: 90,
    letter: 'N',
    power: 'wip',
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
    power: 'live',
  },
  deathwalker_9000: {
    id: 'deathwalker_9000',
    name: 'Deathwalker 9000',
    shortName: 'Deathwalker',
    type: 'hero',
    figures: 1,
    life: 1,
    move: 5,
    range: 7,
    attack: 4,
    defense: 7,
    height: 7,
    points: 140,
    letter: 'W',
    power: 'wip',
  },
  mimring: {
    id: 'mimring',
    name: 'Mimring',
    shortName: 'Mimring',
    type: 'hero',
    figures: 1,
    life: 5,
    move: 6,
    range: 1,
    attack: 4,
    defense: 3,
    height: 9,
    points: 150,
    letter: 'Y',
    power: 'wip',
  },
  grimnak: {
    id: 'grimnak',
    name: 'Grimnak',
    shortName: 'Grimnak',
    type: 'hero',
    figures: 1,
    life: 5,
    move: 5,
    range: 1,
    attack: 2,
    defense: 4,
    height: 11,
    points: 160,
    letter: 'G',
    power: 'wip',
  },
  // ---- Ullar ----
  syvarris: {
    id: 'syvarris',
    name: 'Syvarris',
    shortName: 'Syvarris',
    type: 'hero',
    figures: 1,
    life: 4,
    move: 5,
    range: 9,
    attack: 3,
    defense: 2,
    height: 5,
    points: 100,
    letter: 'S',
    power: 'wip',
  },
  // ---- Vydar ----
  agent_carr: {
    id: 'agent_carr',
    name: 'Agent Carr',
    shortName: 'Agent Carr',
    type: 'hero',
    figures: 1,
    life: 4,
    move: 5,
    range: 6,
    attack: 2,
    defense: 4,
    height: 5,
    points: 100,
    letter: 'C',
    power: 'wip',
  },
  krav_maga: {
    id: 'krav_maga',
    name: 'Krav Maga Agents',
    shortName: 'Krav Maga',
    type: 'squad',
    figures: 3,
    life: 1,
    move: 6,
    range: 7,
    attack: 3,
    defense: 3,
    height: 4,
    points: 100,
    letter: 'K',
    power: 'wip',
  },
  // ---- Einar ----
  izumi_samurai: {
    id: 'izumi_samurai',
    name: 'Izumi Samurai',
    shortName: 'Izumi',
    type: 'squad',
    figures: 3,
    life: 1,
    move: 6,
    range: 1,
    attack: 2,
    defense: 5,
    height: 5,
    points: 60,
    letter: 'I',
    power: 'wip',
  },
};

/** The full draft pool: every card id in HS_CARDS, in roster (cards.md) order —
 *  General, then points. The draft removes a card from this pool when taken
 *  (all 16 are UNIQUE in this printing, so each is draftable once total). */
export const HS_DRAFT_POOL: readonly string[] = [
  'tarn_vikings', 'finn', 'thorgrim', 'airborne_elite', 'drake', 'raelin',
  'zettian_guards', 'ne_gok_sa', 'marro_warriors', 'deathwalker_9000', 'mimring',
  'grimnak', 'syvarris', 'agent_carr', 'krav_maga', 'izumi_samurai',
];

/** Quick-battle fixed armies by roster index (hero first):
 *  Player 1 = Finn + Tarn Viking Warriors, Player 2 = Thorgrim + Marro
 *  Warriors (the pairing test-maps.md suggests for the Training Field). Used by
 *  the quick-battle mode, which auto-drafts these and auto-places them — it
 *  reproduces the slice-4 fixed-army experience exactly. */
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
