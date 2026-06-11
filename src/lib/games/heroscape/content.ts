// HeroScape — card content (the full 16-card roster) + dice.
//
// Stats are AS PRINTED in docs/heroscape/cards.md (the rebalanced modern
// printing — e.g. Marro Warriors are Range 6 / 105 points there, NOT the
// classic 2004 values). The Master Game uses Move / Range / Attack / Defense /
// Life (Master combat wounds); Height drives climbing/engagement/falls.
//
// SLICE 5 (docs/heroscape/slice-5-spec.md): all 16 cards become DRAFTABLE. Each
// carries a `power: 'live' | 'wip'` flag — `live` cards keep their implemented
// special powers; `wip` cards play STAT-ONLY (no power handler — the engine's
// power dispatch keys off card id/condition, so a `wip` card simply has no
// handler and fights with its printed stats) and are tagged "⚡ powers WIP" in
// the draft UI.
//
// SLICE 6 (docs/heroscape/slice-6-spec.md): the stat-folding power batch lights
// up 6 more cards. Each card also carries its printed `species` + `unitClass`
// (cards.md) so the conditional powers — Range Enhancement ("Soulborg Guards"),
// Orc Warrior Enhancement ("Orc Warriors") — are data-driven. Now live: Raelin
// (Extended Defensive Aura), Deathwalker 9000 (Range Enhancement), Agent Carr
// (Sword of Reckoning 4), Grimnak (Orc Warrior Enhancement), Zettian Guards
// (Zettian Targeting), Syvarris (Double Attack).
//
// SLICE 7 (docs/heroscape/slice-7-spec.md): the movement & defense power batch
// (now 13 live, 3 wip). Data-driven FLAGS on HSCardDef — flying (Raelin,
// Mimring), ghostWalk + disengage (Agent Carr), thorianSpeed + grappleGun
// (Sgt. Drake), stealthDodge (Krav Maga Agents), counterStrike (Izumi Samurai).
// Drake/Krav Maga/Izumi flip to 'live'. The only remaining wip cards are
// Airborne Elite, Mimring (its Fire Line — its Flying is live), and Ne-Gok-Sa —
// each needs a slice-8 special attack / placement / control power.
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
    species: 'Human',
    unitClass: 'Warriors',
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
    species: 'Human',
    unitClass: 'Champion',
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
    species: 'Human',
    unitClass: 'Champion',
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
    species: 'Human',
    unitClass: 'Soldiers',
    power: 'wip', // slice 8: Grenade Special Attack + The Drop
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
    species: 'Human',
    unitClass: 'Soldier',
    power: 'live', // slice 7: Thorian Speed + Grapple Gun 25
    thorianSpeed: true, // slice 7: normal attacks on Drake must be adjacent
    grappleGun: 25, // slice 7: one-space move, climb waived up to 25 levels
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
    species: 'Kyrie',
    unitClass: 'Warrior',
    power: 'live', // slice 6: Extended Defensive Aura; slice 7: Flying (Whirlwind → slice 8)
    flying: true, // slice 7: FLYING — ignore elevation/water/figures, no fall
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
    species: 'Soulborg',
    unitClass: 'Guards',
    power: 'live', // slice 6: Zettian Targeting
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
    species: 'Marro',
    unitClass: 'Warlord',
    power: 'wip', // slice 8: Mind Shackle 20
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
    species: 'Marro',
    unitClass: 'Warriors',
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
    species: 'Soulborg',
    unitClass: 'Deathwalker',
    power: 'live', // slice 6: Range Enhancement (Explosion Special Attack → slice 7)
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
    species: 'Dragon',
    unitClass: 'Beast',
    power: 'wip', // slice 8: Fire Line Special Attack (its Flying is live in slice 7)
    flying: true, // slice 7: FLYING — Mimring flies even though Fire Line is wip
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
    species: 'Orc',
    unitClass: 'Champion',
    power: 'live', // slice 6: Orc Warrior Enhancement (Chomp → slice 7)
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
    species: 'Elf',
    unitClass: 'Archer',
    power: 'live', // slice 6: Double Attack
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
    species: 'Human',
    unitClass: 'Agent',
    power: 'live', // slice 6: Sword of Reckoning 4; slice 7: Ghost Walk + Disengage
    ghostWalk: true, // slice 7: GHOST WALK — moves through all figures
    disengage: true, // slice 7: DISENGAGE — never swiped when leaving engagement
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
    species: 'Human',
    unitClass: 'Agents',
    power: 'live', // slice 7: Stealth Dodge
    stealthDodge: true, // slice 7: one shield blocks all vs a non-adjacent attacker
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
    species: 'Human',
    unitClass: 'Samurai',
    power: 'live', // slice 7: Counter Strike
    counterStrike: true, // slice 7: reflect excess shields onto an adjacent normal attacker
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

// ============================================================================
// Special-power descriptions — keyed by card id, for the PLAY-screen hover
// popover (the small roster cards show the full card on hover). Text is the
// faithful printed power text from docs/heroscape/cards.md (terse — one line
// per power, numbers and conditions preserved). All 16 cards are listed; a
// card with no special power gets an empty array.
// ============================================================================
export const POWER_DESCRIPTIONS: Record<string, { name: string; text: string }[]> = {
  // ---- Jandar ----
  tarn_vikings: [
    {
      name: 'Berserker Charge',
      text: 'After moving and before attacking, roll the 20-sided die. If you roll a 15 or higher, you may move all Tarn Viking Warriors again.',
    },
  ],
  finn: [
    {
      name: 'Attack Aura 1',
      text: 'All friendly figures adjacent to Finn with a range of 1 add 1 die to their normal attack.',
    },
    {
      name: "Warrior's Attack Spirit 1",
      text: 'When destroyed, place this figure on any unique Army Card. Adds 1 to the normal attack number on that card.',
    },
  ],
  thorgrim: [
    {
      name: 'Defensive Aura 1',
      text: 'All friendly figures adjacent to Thorgrim add 1 die to their defense.',
    },
    {
      name: "Warrior's Armor Spirit 1",
      text: "When Thorgrim is destroyed, place this figure on any unique Army Card. Thorgrim's Spirit adds 1 to the defense number on that card.",
    },
  ],
  airborne_elite: [
    {
      name: 'Grenade Special Attack',
      text: 'Range 5. Lob 12. Attack 2. Once per game, throw grenades one at a time with each Airborne Elite: choose a figure to attack (no clear line of sight needed). Figures adjacent to the chosen figure are also affected. Roll 2 attack dice once for all affected figures; each figure rolls defense separately.',
    },
    {
      name: 'The Drop',
      text: 'Airborne Elite do not start on the battlefield. At the start of each round, before placing Order Markers, roll the 20-sided die. On a 13 or higher you may place all 4 figures on any empty spaces. You cannot place them adjacent to each other or other figures, or on glyphs.',
    },
  ],
  drake: [
    {
      name: 'Thorian Speed',
      text: 'Opponents’ figures must be adjacent to Sgt. Drake Alexander to attack him with a normal attack.',
    },
    {
      name: 'Grapple Gun 25',
      text: "Instead of Sgt. Drake Alexander's normal move, he may move only one space. This space may be up to 25 levels higher. All engagement rules still apply.",
    },
  ],
  raelin: [
    {
      name: 'Whirlwind Assault',
      text: 'Raelin may attack any or all figures adjacent to her. Roll each attack separately.',
    },
    {
      name: 'Extended Defensive Aura',
      text: 'All figures you control within 6 clear sight spaces of Raelin add 1 to their defense dice. Does not affect Raelin.',
    },
    {
      name: 'Flying',
      text: 'When counting spaces for Raelin’s movement, ignore elevations. She may fly over water without stopping and pass over figures and obstacles without becoming engaged. If engaged when she starts to fly, she takes any leaving-engagement attacks.',
    },
  ],
  // ---- Utgar ----
  zettian_guards: [
    {
      name: 'Zettian Targeting',
      text: 'When attacking, if your second Zettian Guard attacks the same figure as the first Zettian Guard, add one attack die to the second Guard’s attack.',
    },
  ],
  ne_gok_sa: [
    {
      name: 'Mind Shackle 20',
      text: 'After moving and before attacking, you may choose any unique figure adjacent to Ne-Gok-Sa. Roll the 20-sided die. On a 20, take control of that figure and its Army Card (and all figures on it); remove any Order Markers on that card. Control is retained even if Ne-Gok-Sa is destroyed.',
    },
  ],
  marro_warriors: [
    {
      name: 'Water Clone',
      text: 'Instead of attacking, roll the 20-sided die for each Marro Warrior in play. On a 15 or higher, place a previously destroyed Marro Warrior on a same-level space adjacent to that Warrior. A Warrior on a water space needs a 10 or higher. You may only Water Clone after you move.',
    },
  ],
  deathwalker_9000: [
    {
      name: 'Explosion Special Attack',
      text: 'Range 7. Attack 3. Choose a figure to attack; figures adjacent to it are also affected. Needs only a clear sight shot at the chosen figure. Roll 3 attack dice once for all affected figures; each rolls defense separately. Deathwalker can be affected by his own explosion.',
    },
    {
      name: 'Range Enhancement',
      text: 'Any Soulborg Guards adjacent to Deathwalker add 2 spaces to their range.',
    },
  ],
  mimring: [
    {
      name: 'Fire Line Special Attack',
      text: 'Range Special. Attack 4. Choose 8 spaces in a straight line from Mimring. All figures on those spaces who are in line of sight are affected. Roll 4 attack dice once for all affected figures; each rolls defense separately.',
    },
    {
      name: 'Flying',
      text: 'When counting spaces for Mimring’s movement, ignore elevations. He may fly over water without stopping and pass over figures and obstacles without becoming engaged. If engaged when he starts to fly, he takes any leaving-engagement attacks.',
    },
  ],
  grimnak: [
    {
      name: 'Chomp',
      text: 'Before attacking, choose one medium or small figure adjacent to Grimnak. A Squad figure is destroyed. For a Hero figure, roll the 20-sided die; on a 16 or higher, destroy the chosen Hero.',
    },
    {
      name: 'Orc Warrior Enhancement',
      text: 'All friendly Orc Warriors adjacent to Grimnak roll an additional attack die and an additional defense die.',
    },
  ],
  // ---- Ullar ----
  syvarris: [
    {
      name: 'Double Attack',
      text: 'When Syvarris attacks, he may attack one additional time.',
    },
  ],
  // ---- Vydar ----
  agent_carr: [
    {
      name: 'Ghost Walk',
      text: 'Agent Carr can move through all figures.',
    },
    {
      name: 'Sword of Reckoning 4',
      text: 'If Agent Carr is attacking an adjacent figure, add 4 dice to his attack.',
    },
    {
      name: 'Disengage',
      text: 'Agent Carr is never attacked when leaving an engagement.',
    },
  ],
  krav_maga: [
    {
      name: 'Stealth Dodge',
      text: 'When a Krav Maga Agent rolls defense dice against an attacking figure who is not adjacent, one shield will block all damage.',
    },
  ],
  // ---- Einar ----
  izumi_samurai: [
    {
      name: 'Counter Strike',
      text: 'When rolling defense dice against a normal attack from an adjacent attacking figure, all excess shields count as unblockable hits on the attacker. Does not work against other Samurai.',
    },
  ],
};
