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

import type { CombatFace, HSCardDef, HSEdition, HSGlyphId } from './types';

// ============================================================================
// Card editions — Classic (original 2004-era) vs Modern (the rebalanced printing
// in HS_CARDS, the default). Only a handful of cards differ; each entry lists
// ONLY the Classic value for the fields that change.
//
// SOURCE DISCIPLINE: these are POINTS-ONLY, taken straight from the user's
// confirmed Classic-vs-Modern points table. We deliberately do NOT carry the
// range / attack "reversions" docs/heroscape/cards.md once listed — reading the
// real RotV Raelin card showed that doc had conflated her aura's reach (4) with
// her figure Range (which is 1 in BOTH editions), so its stat claims are not
// trustworthy without the actual card. When the user supplies a Classic card
// that genuinely changes a stat line, add it here then.
//
// NOTE: the card ART (HybridCard scans) is the modern printing, so in Classic
// mode the scanned image still shows modern numbers — only the points badge,
// the draft budget, and combat stats (resolved through effectiveCardDef) become
// Classic. Fixing the art itself would need classic card scans.
export const CLASSIC_OVERRIDES: Record<string, Partial<HSCardDef>> = {
  major_q9: { points: 180 },
  nilfheim: { points: 185 },
  raelin: { points: 80 },
  marro_warriors: { points: 50 },
  grimnak: { points: 120 },
};

/** The card definition for `cardId` under the active `edition`. Modern (or any
 *  absent/unknown edition) returns the printed HS_CARDS entry unchanged; Classic
 *  folds CLASSIC_OVERRIDES over it. Mirrors `HS_CARDS[cardId]` semantics —
 *  returns undefined for an unknown id so existing `?.` call sites still work.
 *  This is the SINGLE source the engine (combat + draft budget) and the UI both
 *  read through, so the number shown can never disagree with the number enforced. */
export function effectiveCardDef(cardId: string, edition?: HSEdition): HSCardDef | undefined {
  const base = HS_CARDS[cardId];
  if (!base || edition !== 'classic') return base;
  const ov = CLASSIC_OVERRIDES[cardId];
  return ov ? { ...base, ...ov } : base;
}

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
  eldgrim: {
    id: 'eldgrim',
    name: 'Eldgrim the Viking Champion',
    shortName: 'Eldgrim',
    type: 'hero',
    figures: 1,
    life: 3,
    move: 5,
    range: 1,
    attack: 2,
    defense: 2,
    height: 4,
    points: 30,
    letter: 'E',
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
    power: 'live', // Grenade Special Attack + The Drop (both wired)
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
    points: 125, // RotV card (Index_3x5 …-ROTV.pdf), verified vs the printed card
    letter: 'R',
    species: 'Kyrie',
    unitClass: 'Warrior',
    power: 'live', // DEFENSIVE AURA (within 4 clear sight, +2 def) + FLYING — per the RotV card
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
    power: 'live', // slice 8: Mind Shackle 20 (implemented)
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
    defense: 9, // Defense 9 — verified 2026-06-27 from Index_3x5_Deathwalker_9000.pdf (was wrongly 7)
    height: 7,
    size: 'large', // cards.md: Large 7 — cannot be Chomped
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
    size: 'huge', // cards.md: Huge 9 — cannot be Chomped
    points: 150,
    letter: 'Y',
    species: 'Dragon',
    unitClass: 'Beast',
    power: 'live', // slice 8: Fire Line Special Attack implemented (Flying live since slice 7)
    flying: true, // slice 7: FLYING
    baseSize: 2, // DOUBLE-SPACE dragon — occupies two adjacent hexes
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
    size: 'huge', // cards.md: Huge 11 — cannot be Chomped
    points: 160,
    letter: 'G',
    species: 'Orc',
    unitClass: 'Champion',
    power: 'live', // slice 6: Orc Warrior Enhancement + slice 8: Chomp
    baseSize: 2, // DOUBLE-SPACE Orc-on-Tyrannosaurus — occupies two adjacent hexes
  },
  // ---- Utgar: classic Grut orc squads, Deathreavers, and the Swog Rider (added 2026-06-26
  //      from the user's printed cards). LIVE: Disengage, Climb x2, Scatter (Deathreavers),
  //      Orc Archer Enhancement (Swog Rider aura). PENDING: Orc Champion + Beast Bonding → 'wip'.
  deathreavers: {
    id: 'deathreavers',
    name: 'Deathreavers',
    shortName: 'Deathreaver',
    type: 'squad',
    figures: 4,
    life: 1,
    move: 6,
    range: 1,
    attack: 1,
    defense: 4,
    height: 3,
    size: 'small', // SMALL 3
    points: 60,
    letter: 'R',
    species: 'Soulborg',
    unitClass: 'Deathreaver',
    common: true, // COMMON SQUAD — verified 2026-06-27 from the user's Index_3x5_Deathreavers card
    power: 'live', // Disengage + Climb x2 + Scatter
    disengage: true,
    climbX2: true, // CLIMB X2 — double Height for the climb limit + fall threshold
    scatter: true, // SCATTER — reactive: scuttle 2 rats up to 4 after defending a normal attack
  },
  blade_gruts: {
    id: 'blade_gruts',
    name: 'Blade Gruts',
    shortName: 'Blade Grut',
    type: 'squad',
    figures: 4,
    life: 1,
    move: 6,
    range: 1,
    attack: 2,
    defense: 2,
    height: 4,
    size: 'medium',
    points: 40,
    letter: 'B',
    species: 'Orc',
    unitClass: 'Warriors', // plural (like Tarn/Marro squads) so Grimnak's Orc Warrior Enhancement buffs them
    common: true, // COMMON squad — draftable multiple times (Utgar's common orcs)
    power: 'live', // Disengage + Orc Champion Bonding (free bonus turn with an Orc Champion)
    disengage: true,
    bonding: 'champion',
  },
  heavy_gruts: {
    id: 'heavy_gruts',
    name: 'Heavy Gruts',
    shortName: 'Heavy Grut',
    type: 'squad',
    figures: 4,
    life: 1,
    move: 5,
    range: 1,
    attack: 3,
    defense: 3,
    height: 4,
    size: 'medium',
    points: 70,
    letter: 'H',
    species: 'Orc',
    unitClass: 'Warriors', // plural (like Tarn/Marro squads) so Grimnak's Orc Warrior Enhancement buffs them
    common: true, // COMMON squad — draftable multiple times (Utgar's common orcs)
    power: 'live', // Disengage + Orc Champion Bonding (free bonus turn with an Orc Champion)
    disengage: true,
    bonding: 'champion',
  },
  arrow_gruts: {
    id: 'arrow_gruts',
    name: 'Arrow Gruts',
    shortName: 'Arrow Grut',
    type: 'squad',
    figures: 3, // 3-figure squad (Blade/Heavy Gruts are 4)
    life: 1,
    move: 6,
    range: 6,
    attack: 1,
    defense: 1,
    height: 4,
    size: 'medium',
    points: 40,
    letter: 'A',
    species: 'Orc',
    unitClass: 'Archer',
    common: true, // COMMON squad — draftable multiple times (Utgar's common orcs)
    power: 'live', // Disengage + Beast Bonding (free bonus turn with a Beast)
    disengage: true,
    bonding: 'beast',
  },
  swog_rider: {
    id: 'swog_rider',
    name: 'Swog Rider',
    shortName: 'Swog Rider',
    type: 'hero',
    figures: 1,
    life: 1,
    move: 8,
    range: 1,
    attack: 3,
    defense: 3,
    height: 6,
    size: 'large', // LARGE 6
    points: 25,
    letter: 'S',
    species: 'Orc',
    unitClass: 'Beast',
    common: true, // COMMON HERO — may be drafted multiple times
    baseSize: 2, // DOUBLE-SPACE — orc-on-saber-tooth sits on a peanut base
    power: 'live', // Disengage + Orc Archer Enhancement (aura → adjacent Orc Archers)
    disengage: true,
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
  otonashi: {
    id: 'otonashi',
    name: 'Otonashi',
    shortName: 'Otonashi',
    type: 'hero',
    figures: 1,
    life: 1,
    move: 6,
    range: 1,
    attack: 2,
    defense: 3,
    height: 4, // Medium 4
    points: 10,
    letter: 'O',
    species: 'Human',
    unitClass: 'Ninja',
    power: 'live',
    ghostWalk: true,        // PHANTOM WALK — moves through all figures…
    disengage: true,        // …and is never attacked when leaving an engagement
    attackTheWild: 2,       // ATTACK THE WILD 2 — +2 dice vs a Wild-personality figure
    trickySpeed: 4,         // TRICKY SPEED 4 — +4 move if starting adjacent to a friendly Tricky figure
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
  // ---- Big Heroes (large/huge uniques, stats AS PRINTED on the user's cards).
  //      All double-space. Their NAMED special attacks (Ice Shard / Acid Breath /
  //      Queglix Gun / Wild Swing / Throw / Carry) are `wip` — not yet wired — so
  //      they draft + fight with printed stats; FLYING is already live (slice-7
  //      flag) for the three flyers. Cut-outs pending → disc fallback until then.
  nilfheim: {
    id: 'nilfheim',
    name: 'Nilfheim',
    shortName: 'Nilfheim',
    type: 'hero',
    figures: 1,
    life: 6,
    move: 6,
    range: 1,
    attack: 6,
    defense: 4,
    height: 12,
    size: 'huge',
    points: 240,
    letter: 'N',
    species: 'Dragon',
    unitClass: 'King',
    power: 'live', // Ice Shard Breath Special Attack (Range 5, Attack 4, +2 extra attacks, no repeats)
    flying: true,
    baseSize: 2,
  },
  su_bak_na: {
    id: 'su_bak_na',
    name: 'Su-Bak-Na',
    shortName: 'Su-Bak-Na',
    type: 'hero',
    figures: 1,
    life: 5,
    move: 6,
    range: 1,
    attack: 7,
    defense: 3,
    height: 12,
    size: 'huge',
    points: 160,
    letter: 'B',
    species: 'Marro',
    unitClass: 'Hivelord',
    power: 'live', // FLYING + HIVE SUPREMACY (+1 d20 for the owner's Marro/Wulsinu cards)
    flying: true,
    hiveSupremacy: true,
    baseSize: 2,
  },
  braxas: {
    id: 'braxas',
    name: 'Braxas',
    shortName: 'Braxas',
    type: 'hero',
    figures: 1,
    life: 8,
    move: 6,
    range: 1,
    attack: 5,
    defense: 3,
    height: 13,
    size: 'huge',
    points: 210,
    letter: 'X',
    species: 'Dragon',
    unitClass: 'Queen',
    power: 'live', // Poisonous Acid Breath (up to 3 small/medium in 4 sight; d20 squad 8+ / hero 17+ destroy)
    flying: true,
    baseSize: 2,
  },
  theracus: {
    id: 'theracus',
    name: 'Theracus',
    shortName: 'Theracus',
    type: 'hero',
    figures: 1,
    life: 3,
    move: 7,
    range: 1,
    attack: 3,
    defense: 3,
    height: 5,
    size: 'large',
    points: 40,
    letter: 'T',
    species: 'Gryphillin',
    unitClass: 'Scout',
    power: 'live', // Carry (move an adjacent friendly small/medium along with him)
    flying: true,
    baseSize: 2,
  },
  major_q9: {
    id: 'major_q9',
    name: 'Major Q9',
    shortName: 'Major Q9',
    type: 'hero',
    figures: 1,
    life: 4,
    move: 5,
    range: 8,
    attack: 4,
    defense: 7,
    height: 7,
    size: 'large',
    points: 250,
    letter: 'Q',
    species: 'Soulborg',
    unitClass: 'Major',
    power: 'live', // Queglix Gun Special Attack (Range 8; a pool of 9 dice spent 1-3 per shot)
    baseSize: 2,
  },
  jotun: {
    id: 'jotun',
    name: 'Jotun',
    shortName: 'Jotun',
    type: 'hero',
    figures: 1,
    life: 7,
    move: 6,
    range: 1,
    attack: 8,
    defense: 4,
    height: 10,
    size: 'huge',
    points: 225,
    letter: 'J',
    species: 'Giant',
    unitClass: 'Warrior',
    power: 'live', // Wild Swing Special Attack (splash) + Throw (d20 reposition + damage)
    baseSize: 2,
  },
};

/** The full draft pool: every card id in HS_CARDS, in roster order — the 16 base
 *  uniques + the 5 Big Heroes. The draft removes a UNIQUE card when taken (so it's
 *  draftable once total); a COMMON card (`common: true`) stays in the pool and can
 *  be drafted again. Every card in this roster is Unique, so today nothing repeats —
 *  the rule is in place for future Common cards. */
export const HS_DRAFT_POOL: readonly string[] = [
  'tarn_vikings', 'finn', 'thorgrim', 'eldgrim', 'airborne_elite', 'drake', 'raelin',
  'zettian_guards', 'ne_gok_sa', 'marro_warriors', 'deathwalker_9000', 'mimring',
  'grimnak', 'syvarris', 'agent_carr', 'krav_maga', 'otonashi', 'izumi_samurai',
  'theracus', 'jotun', 'braxas', 'nilfheim', 'su_bak_na', 'major_q9',
  'deathreavers', 'blade_gruts', 'heavy_gruts', 'arrow_gruts', 'swog_rider',
];

/** Title-bar GENERAL plus the printed PERSONALITY and WORLD rows — the identity
 *  bits not needed for rules (so not on HSCardDef). Combined with each card's
 *  species/unitClass/size to render the reconstructed HTML header; `general`
 *  also drives the card's army colour. (cards.md for the 16; Big-Hero scans.) */
export const CARD_IDENTITY: Record<string, { general: string; personality: string; world: string }> = {
  tarn_vikings: { general: 'Jandar', personality: 'Wild', world: 'Earth' },
  finn: { general: 'Jandar', personality: 'Valiant', world: 'Earth' },
  thorgrim: { general: 'Jandar', personality: 'Valiant', world: 'Earth' },
  eldgrim: { general: 'Jandar', personality: 'Valiant', world: 'Earth' },
  airborne_elite: { general: 'Jandar', personality: 'Disciplined', world: 'Earth' },
  drake: { general: 'Jandar', personality: 'Valiant', world: 'Earth' },
  raelin: { general: 'Jandar', personality: 'Merciful', world: 'Valhalla' },
  zettian_guards: { general: 'Utgar', personality: 'Precise', world: 'Alpha Prime' },
  ne_gok_sa: { general: 'Utgar', personality: 'Tricky', world: 'Marr' },
  marro_warriors: { general: 'Utgar', personality: 'Wild', world: 'Marr' },
  deathwalker_9000: { general: 'Utgar', personality: 'Precise', world: 'Alpha Prime' },
  mimring: { general: 'Utgar', personality: 'Ferocious', world: 'Icaria' },
  grimnak: { general: 'Utgar', personality: 'Ferocious', world: 'Grut' },
  deathreavers: { general: 'Utgar', personality: 'Tricky', world: 'Alpha Prime' },
  blade_gruts: { general: 'Utgar', personality: 'Wild', world: 'Grut' },
  heavy_gruts: { general: 'Utgar', personality: 'Wild', world: 'Grut' },
  arrow_gruts: { general: 'Utgar', personality: 'Wild', world: 'Grut' },
  swog_rider: { general: 'Utgar', personality: 'Wild', world: 'Grut' },
  syvarris: { general: 'Ullar', personality: 'Precise', world: 'Feylund' },
  agent_carr: { general: 'Vydar', personality: 'Tricky', world: 'Earth' },
  krav_maga: { general: 'Vydar', personality: 'Tricky', world: 'Earth' },
  otonashi: { general: 'Vydar', personality: 'Tricky', world: 'Earth' },
  izumi_samurai: { general: 'Einar', personality: 'Disciplined', world: 'Earth' },
  nilfheim: { general: 'Jandar', personality: 'Ferocious', world: 'Icaria' },
  su_bak_na: { general: 'Utgar', personality: 'Tricky', world: 'Marr' },
  braxas: { general: 'Vydar', personality: 'Wild', world: 'Icaria' },
  theracus: { general: 'Ullar', personality: 'Disciplined', world: 'Feylund' },
  major_q9: { general: 'Vydar', personality: 'Precise', world: 'Alpha Prime' },
  jotun: { general: 'Ullar', personality: 'Wild', world: 'Feylund' },
};

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
  /** Map/badge key letter — 05-glyphs §1 / Glyphs Key. */
  letter: string;
  kind: HSGlyphKind;
  /** Short power label shown ON the board (e.g. "Attack +1"). */
  power: string;
  /** Full effect text — shown only on HOVER (not on the board face). */
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
  // ---- permanent: active only while one of your figures stands on the glyph ----
  astrid: {
    id: 'astrid',
    name: 'Glyph of Astrid',
    letter: 'A',
    kind: 'permanent',
    power: 'Attack +1',
    effect: 'Each figure you control rolls one extra attack die when using a normal attack.',
    active: true,
  },
  gerda: {
    id: 'gerda',
    name: 'Glyph of Gerda',
    letter: 'G',
    kind: 'permanent',
    power: 'Defense +1',
    effect: 'Each figure you control rolls one extra defense die.',
    active: true,
  },
  ivor: {
    id: 'ivor',
    name: 'Glyph of Ivor',
    letter: 'I',
    kind: 'permanent',
    power: 'Range +2',
    effect: 'Each figure you control with Range 4 or more adds 2 to its Range number.',
    active: true,
  },
  valda: {
    id: 'valda',
    name: 'Glyph of Valda',
    letter: 'V',
    kind: 'permanent',
    power: 'Move +2',
    effect: 'Each figure you control adds 2 to its Move. (Not applied to the move off the glyph.)',
    active: true,
  },
  dagmar: {
    id: 'dagmar',
    name: 'Glyph of Dagmar',
    letter: 'D',
    kind: 'permanent',
    power: 'Initiative +8',
    effect: 'Add 8 to your initiative die roll.',
    active: true,
  },
  jalgard: {
    id: 'jalgard',
    name: 'Glyph of Jalgard',
    letter: 'J',
    kind: 'permanent',
    power: 'Defense +2',
    effect: 'Each figure you control rolls two extra defense dice.',
    active: true,
  },
  lodin: {
    id: 'lodin',
    name: 'Glyph of Lodin',
    letter: 'L',
    kind: 'permanent',
    power: 'D20 +1',
    effect: 'While standing here, add 1 to any 20-sided die roll you make.',
    active: true,
  },
  rannveig: {
    id: 'rannveig',
    name: 'Glyph of Rannveig',
    letter: 'R',
    kind: 'permanent',
    power: 'No Flying',
    effect: 'All figures with the Flying power lose it while any figure stands on this glyph.',
    active: true,
  },
  proftaka: {
    id: 'proftaka',
    name: 'Glyph of Proftaka',
    letter: 'P',
    kind: 'permanent',
    power: 'Trap',
    effect: 'The figure on this glyph cannot move unless a friendly figure occupies an adjacent space.',
    active: true,
  },
  thorian: {
    id: 'thorian',
    name: 'Glyph of Thorian',
    letter: 'T',
    kind: 'permanent',
    power: 'Melee Only',
    effect: "All opponents' figures must be adjacent to your figures to make a normal attack against them.",
    active: true,
  },
  wannok: {
    id: 'wannok',
    name: 'Glyph of Wannok',
    letter: 'W',
    kind: 'permanent',
    power: 'Curse',
    effect: 'At end of each round the controller rolls a d20: on 1 the figure here takes a wound; on 2+ choose an opponent who must wound one of their own figures.',
    active: true, // wave 3: end-of-round trigger + cross-player choice
  },
  brandar: {
    id: 'brandar',
    name: 'Glyph of Brandar',
    letter: 'B',
    kind: 'artifact',
    power: 'Artifact',
    effect: 'Rules vary by scenario; only used if the scenario dictates. Not in the standard random pool.',
    active: false, // scenario-only artifact (never auto-active)
  },
  // ---- temporary: fires once when a figure stops on it, then removed ----
  kelda: {
    id: 'kelda',
    name: 'Glyph of Kelda',
    letter: 'K',
    kind: 'temporary',
    power: 'Healer',
    effect: "Remove all wound markers from the stopping figure's army card. Only figures with wounds may stop here. Once revealed it stays until used.",
    active: true,
  },
  erland: {
    id: 'erland',
    name: 'Glyph of Erland',
    letter: 'E',
    kind: 'temporary',
    power: 'Summoning',
    effect: "Move any one figure (yours or an opponent's) to a space adjacent to the figure on this glyph. No leaving-engagement attacks.",
    active: true, // wave 3: summon (pick any figure → adjacent, pure teleport)
  },
  mitonsoul: {
    id: 'mitonsoul',
    name: 'Glyph of Mitonsoul',
    letter: 'M',
    kind: 'temporary',
    power: 'Massive Curse',
    effect: 'Each player rolls a d20 for each of their figures on the battlefield. Each that rolls a 1 is destroyed.',
    active: true,
  },
  sturla: {
    id: 'sturla',
    name: 'Glyph of Sturla',
    letter: 'S',
    kind: 'temporary',
    power: 'Resurrection',
    effect: 'Each player rolls a d20 for each of their figures destroyed this battle; on a 20 place it in any of that owner’s starting zones, otherwise it stays destroyed.',
    active: true,
  },
  nilrend: {
    id: 'nilrend',
    name: 'Glyph of Nilrend',
    letter: 'N',
    kind: 'temporary',
    power: 'Negation',
    effect: "Roll a d20: on 1 choose one of your unique figures; on 2+ choose any opponent's unique figure — its special powers are negated for the rest of the game.",
    active: true, // wave 3: d20 + negate the chosen card's powers (game-long)
  },
  oreld: {
    id: 'oreld',
    name: 'Glyph of Oreld',
    letter: 'O',
    kind: 'temporary',
    power: 'Remove Marker',
    effect: "Roll a d20: on 1 a random order marker is removed from your unrevealed markers; on 2+ remove one random order marker from an opponent's army card.",
    active: true,
  },
};

// ============================================================================
// ============================================================================
// SPECIAL-ABILITY GLOSSARY — every distinct ability defined ONCE and character-
// neutral, so a shared keyword (Flying, ...) is never duplicated across the cards
// that have it. Cards list their abilities by NAME in CARD_ABILITIES; the per-card
// POWER_DESCRIPTIONS used by the card/hover display is DERIVED from the two below.
//
// Fidelity notes:
//  - Text is the printed power text with the figure's OWN name swapped for a
//    generic reference ("this figure" / "this card's figures"); every number,
//    range and condition is preserved, and rule-relevant GROUP names (Orc
//    Warriors, Soulborg Guards, Samurai...) are kept because they scope the rule.
//  - kind: 'active' = a power the player initiates on their turn (the tap target
//    for the activation panel); 'passive' = automatic / always-on / triggered.
//  - Flying =/= Stealth Flying: Stealth Flying does NOT take leaving-engagement
//    attacks, so it must be a SEPARATE entry if ever added -- never merge them.
//  - A parameterized keyword keeps its number in the name for now (Mind Shackle
//    20, Attack Aura 1, ...); split it into a value param only once two cards
//    share one base keyword with different numbers.
// ============================================================================
export interface Ability { text: string; kind: 'active' | 'passive'; }

export const ABILITIES: Record<string, Ability> = {
  // ---- shared keywords (defined once) ----
  'Flying': { kind: 'passive', text: "When counting spaces for movement, ignore elevations. This figure may fly over water without stopping and pass over figures and obstacles without becoming engaged. If it is engaged when it starts to fly, it takes any leaving-engagement attacks." },
  'Disengage': { kind: 'passive', text: "This figure is never attacked when leaving an engagement." },

  // ---- unique abilities ----
  'Berserker Charge': { kind: 'active', text: "After moving and before attacking, roll the 20-sided die. If you roll a 15 or higher, you may move all of this card's figures again." },
  'Attack Aura 1': { kind: 'passive', text: "All friendly figures adjacent to this figure with a range of 1 add 1 die to their normal attack." },
  "Warrior's Attack Spirit 1": { kind: 'passive', text: "When destroyed, place this figure on any unique Army Card. Adds 1 to the normal attack number on that card." },
  'Defensive Aura 1': { kind: 'passive', text: "All friendly figures adjacent to this figure add 1 die to their defense." },
  "Warrior's Armor Spirit 1": { kind: 'passive', text: "When destroyed, place this figure on any unique Army Card. Adds 1 to the defense number on that card." },
  "Warrior's Swiftness Spirit": { kind: 'passive', text: "When destroyed, place this figure on any unique Army Card. Adds 1 to the move number on that card." },
  'Overextend Attack': { kind: 'active', text: "After taking a turn with this figure, you may place a wound marker on it and take another turn with it. You may use this power only once during a round." },
  'Grenade Special Attack': { kind: 'active', text: "Range 5. Lob 12. Attack 2. Once per game, throw grenades one at a time with each of this card's figures: choose a figure to attack (no clear line of sight needed). Figures adjacent to the chosen figure are also affected. Roll 2 attack dice once for all affected figures; each figure rolls defense separately." },
  'The Drop': { kind: 'active', text: "These figures do not start on the battlefield. At the start of each round, before placing Order Markers, roll the 20-sided die. On a 13 or higher you may place all 4 figures on any empty spaces. You cannot place them adjacent to each other or other figures, or on glyphs." },
  'Thorian Speed': { kind: 'passive', text: "Opponents' figures must be adjacent to this figure to attack it with a normal attack." },
  'Grapple Gun 25': { kind: 'active', text: "Instead of its normal move, this figure may move only one space. This space may be up to 25 levels higher. All engagement rules still apply." },
  'Whirlwind Assault': { kind: 'active', text: "This figure may attack any or all figures adjacent to it. Roll each attack separately." },
  'Extended Defensive Aura': { kind: 'passive', text: "All figures you control within 4 clear sight spaces of this figure add 2 to their defense dice. Does not affect this figure." },
  'Zettian Targeting': { kind: 'passive', text: "When attacking, if your second figure from this card attacks the same figure as the first, add one attack die to the second's attack." },
  'Mind Shackle 20': { kind: 'active', text: "After moving and before attacking, you may choose any unique figure adjacent to this figure. Roll the 20-sided die. On a 20, take control of that figure and its Army Card (and all figures on it); remove any Order Markers on that card. Control is retained even if this figure is destroyed." },
  'Water Clone': { kind: 'active', text: "Instead of attacking, roll the 20-sided die for each of this card's figures in play. On a 15 or higher, place a previously destroyed figure from this card on a same-level space adjacent to that figure. A figure on a water space needs a 10 or higher. You may only Water Clone after you move." },
  'Explosion Special Attack': { kind: 'active', text: "Range 7. Attack 3. Choose a figure to attack; figures adjacent to it are also affected. Needs only a clear sight shot at the chosen figure. Roll 3 attack dice once for all affected figures; each rolls defense separately. This figure can be affected by its own explosion." },
  'Range Enhancement': { kind: 'passive', text: "Any Soulborg Guards adjacent to this figure add 2 spaces to their range." },
  'Fire Line Special Attack': { kind: 'active', text: "Range Special. Attack 4. Choose 8 spaces in a straight line from this figure. All figures on those spaces who are in line of sight are affected. Roll 4 attack dice once for all affected figures; each rolls defense separately." },
  'Chomp': { kind: 'active', text: "Before attacking, choose one medium or small figure adjacent to this figure. A Squad figure is destroyed. For a Hero figure, roll the 20-sided die; on a 16 or higher, destroy the chosen Hero." },
  'Orc Warrior Enhancement': { kind: 'passive', text: "All friendly Orc Warriors adjacent to this figure roll an additional attack die and an additional defense die." },
  'Double Attack': { kind: 'passive', text: "When this figure attacks, it may attack one additional time." },
  'Ghost Walk': { kind: 'passive', text: "This figure can move through all figures." },
  'Sword of Reckoning 4': { kind: 'passive', text: "If this figure is attacking an adjacent figure, add 4 dice to its attack." },
  'Stealth Dodge': { kind: 'passive', text: "When this figure rolls defense dice against an attacking figure who is not adjacent, one shield will block all damage." },
  'Counter Strike': { kind: 'passive', text: "When rolling defense dice against a normal attack from an adjacent attacking figure, all excess shields count as unblockable hits on the attacker. Does not work against other Samurai." },
  'Ice Shard Breath Special Attack': { kind: 'active', text: "Range 5. Attack 4. When attacking with the Ice Shard Breath Special Attack, this figure may attack 2 additional times. It cannot attack the same figure more than once." },
  'Poisonous Acid Breath': { kind: 'active', text: "Instead of attacking, you may choose up to 3 different small or medium figures within 4 clear sight spaces of this figure. One at a time, roll the 20-sided die for each chosen figure. If the chosen figure is a Squad figure and you roll an 8 or higher, destroy it. If the chosen figure is a Hero figure and you roll a 17 or higher, destroy the chosen Hero." },
  'Carry': { kind: 'active', text: "Before moving, choose an unengaged friendly small or medium figure adjacent to this figure. After moving, place the chosen figure adjacent to this figure." },
  'Queglix Gun Special Attack': { kind: 'active', text: "Range 8. Attack 1, 2 or 3. This figure starts each turn with 9 attack dice. Choose any figure within range and attack by rolling 1, 2 or 3 attack dice. This figure may keep making special attacks with 1, 2 or 3 attack dice until it has rolled all 9 attack dice. It may target the same or different figures with each attack." },
  'Wild Swing Special Attack': { kind: 'active', text: "Range 1. Attack 4. Choose a target; every figure adjacent to it is also hit. Roll the attack once for all affected figures, then each rolls defense separately. Immune to its own Wild Swing." },
  'Throw 14': { kind: 'active', text: "After moving and before attacking, choose an adjacent small or medium non-flying figure and roll the 20-sided die. On 14 or higher, you may throw it to any empty space within 4 spaces and in clear sight. Roll again for damage: on 11 or higher the thrown figure takes 2 wounds — but skip the damage roll if it lands on water or higher than this figure's height. The thrown figure takes no leaving-engagement attacks." },
  'Phantom Walk': { kind: 'passive', text: "Otonashi can move through all figures and is never attacked when leaving an engagement." },
  'Attack the Wild 2': { kind: 'passive', text: "When attacking a figure who has a Wild personality, Otonashi rolls 2 additional attack dice." },
  'Tricky Speed 4': { kind: 'passive', text: "If Otonashi starts her turn adjacent to any figure you control with a Tricky personality, she may move 4 additional spaces." },
  'Hive Supremacy': { kind: 'passive', text: "Anytime you roll the 20-sided die for a Marro or Wulsinu Army Card, you may add 1 to your die roll." },
  // ---- classic Grut / Deathreaver / Swog Rider keywords (2026-06-26) ----
  'Scatter': { kind: 'passive', text: "After a figure on this card rolls defense dice against a normal attack, you may move any 2 of this card's figures up to 4 spaces each." },
  'Climb X2': { kind: 'passive', text: "When moving up or down levels of terrain, this card's figures may double their Height." },
  'Orc Champion Bonding': { kind: 'passive', text: "Before taking a turn with this card's figures, you may first take a turn with any Orc Champion you control." },
  'Beast Bonding': { kind: 'passive', text: "Before taking a turn with this card's figures, you may first take a turn with any Beast you control." },
  'Orc Archer Enhancement': { kind: 'passive', text: "All friendly Orc Archers adjacent to this figure receive an additional attack die and an additional defense die." },
};

// Which abilities each card has, in printed order. References the glossary keys.
export const CARD_ABILITIES: Record<string, string[]> = {
  // Jandar
  tarn_vikings: ['Berserker Charge'],
  finn: ['Attack Aura 1', "Warrior's Attack Spirit 1"],
  thorgrim: ['Defensive Aura 1', "Warrior's Armor Spirit 1"],
  eldgrim: ['Overextend Attack', "Warrior's Swiftness Spirit"],
  airborne_elite: ['Grenade Special Attack', 'The Drop'],
  drake: ['Thorian Speed', 'Grapple Gun 25'],
  raelin: ['Extended Defensive Aura', 'Flying'],
  // Utgar
  zettian_guards: ['Zettian Targeting'],
  ne_gok_sa: ['Mind Shackle 20'],
  marro_warriors: ['Water Clone'],
  deathwalker_9000: ['Explosion Special Attack', 'Range Enhancement'],
  mimring: ['Fire Line Special Attack', 'Flying'],
  grimnak: ['Chomp', 'Orc Warrior Enhancement'],
  deathreavers: ['Scatter', 'Disengage', 'Climb X2'],
  blade_gruts: ['Orc Champion Bonding', 'Disengage'],
  heavy_gruts: ['Orc Champion Bonding', 'Disengage'],
  arrow_gruts: ['Beast Bonding', 'Disengage'],
  swog_rider: ['Disengage', 'Orc Archer Enhancement'],
  // Ullar
  syvarris: ['Double Attack'],
  // Vydar
  agent_carr: ['Ghost Walk', 'Sword of Reckoning 4', 'Disengage'],
  krav_maga: ['Stealth Dodge'],
  otonashi: ['Phantom Walk', 'Attack the Wild 2', 'Tricky Speed 4'],
  // Einar
  izumi_samurai: ['Counter Strike'],
  // Big Heroes
  nilfheim: ['Ice Shard Breath Special Attack', 'Flying'],
  su_bak_na: ['Hive Supremacy', 'Flying'],
  braxas: ['Poisonous Acid Breath', 'Flying'],
  theracus: ['Carry', 'Flying'],
  major_q9: ['Queglix Gun Special Attack'],
  jotun: ['Wild Swing Special Attack', 'Throw 14'],
};

// Per-card power list for the card/hover display — DERIVED from the glossary, so
// the card text and the glossary can never drift apart.
export const POWER_DESCRIPTIONS: Record<string, { name: string; text: string }[]> =
  Object.fromEntries(
    Object.entries(CARD_ABILITIES).map(([id, names]) => [
      id,
      names.map((name) => ({ name, text: ABILITIES[name]?.text ?? '' })),
    ]),
  );
