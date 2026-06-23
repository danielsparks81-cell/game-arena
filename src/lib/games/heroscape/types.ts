// HeroScape — shared type definitions.
//
// SLICE 2 (docs/heroscape/slice-2-spec.md): the MASTER GAME round engine — 2
// players, fixed armies, the flat TEST-1 "Training Field" map. Each round:
// secret order markers (1/2/3/X) → d20 initiative (ties re-roll) → 3 turns per
// player driven by the revealed marker — plus Master combat (wounds vs Life).
//
// SLICE 4 (docs/heroscape/slice-4-spec.md): GLYPHS + SPECIAL POWERS. Glyphs on
// the battlefield (forced stop on entry; permanent-while-occupied vs
// fire-once-temporary), the four cards' printed powers (Finn/Thorgrim auras +
// Spirits, Tarn Berserker Charge, Marro Water Clone), and the PendingChoice
// machinery — player decisions are PROMPTED, never auto-resolved.

/** Axial hex coordinate (pointy-top). Stored in state as a "q,r" key. */
export type Axial = { q: number; r: number };
export type HexKey = string; // `${q},${r}`

export type Terrain = 'grass' | 'rock' | 'sand' | 'water';

export type HexCell = {
  q: number;
  r: number;
  /** Tile-stack height in levels. Slice-2 maps are all height 1 (flat). */
  height: number;
  terrain: Terrain;
};

/**
 * Combat die face. Each d6 carries 3 skulls / 2 shields / 1 blank.
 * ⚠ Documented assumption: the rulebook never prints the face distribution
 * (docs/heroscape/04-combat-range-los-attack.md "The combat die"); this is the
 * community-standard split the spec adopts. Only skulls count on attack rolls
 * and only shields on defense rolls — off-symbols and blanks are ignored.
 */
export type CombatFace = 'skull' | 'shield' | 'blank';

export type HSCardType = 'hero' | 'squad';

/** Static army-card definition (content.ts). Stats AS PRINTED in
 *  docs/heroscape/cards.md (the rebalanced modern printing). */
export type HSCardDef = {
  id: string;
  name: string;
  /** Short name used in logs / figure labels ("Finn", "Marro Warrior"). */
  shortName: string;
  type: HSCardType;
  /** Figures fielded by the card (a Hero card = 1). */
  figures: number;
  /** Printed Life: a figure is destroyed when its wounds reach Life (p. 14). */
  life: number;
  move: number;
  range: number;
  attack: number;
  defense: number;
  /** Printed Height in levels (drives climbing/engagement in later slices). */
  height: number;
  /** Printed SIZE category (cards.md). Only the non-medium figures carry it —
   *  absent ⇒ Medium. Used by Grimnak's Chomp ("medium or small figure"), which
   *  cannot target Large/Huge figures. */
  size?: 'small' | 'medium' | 'large' | 'huge';
  /** BASE SIZE in hexes: a DOUBLE-SPACE figure (Mimring, Grimnak) occupies TWO
   *  adjacent same-level hexes; every other figure occupies one. Absent → 1. */
  baseSize?: 1 | 2;
  points: number;
  /** Single letter shown on the figure's disc. */
  letter: string;
  /**
   * Printed SPECIES line ("Soulborg", "Orc", "Human", "Marro"…) and unit CLASS
   * ("Guards", "Warriors", "Champion", "Archer"…) from cards.md (slice 6). These
   * make the conditional powers data-driven instead of hard-coded ids — e.g.
   * Range Enhancement reads "Soulborg Guards" and Orc Warrior Enhancement reads
   * "Orc Warriors" off these fields, so any future card with the same
   * species/class qualifies automatically. Populated for all 16 cards.
   */
  species: string;
  unitClass: string;
  /** Card RARITY (printed): a COMMON card may be drafted UNLIMITED times (field
   *  multiple copies); a UNIQUE card only once. Absent ⇒ Unique — the entire
   *  current roster is Unique (cards.md), so this is here for FUTURE Common cards.
   *  The draft keeps a Common in the shared pool after it's picked; a Unique
   *  leaves. Read via effectiveCardDef so it can vary by edition if ever needed. */
  common?: boolean;
  /**
   * Special-power implementation status (slice 5; extended slice 6).
   *   • 'live' — the card's printed power(s) are implemented. slice 4:
   *     Finn/Thorgrim auras + Spirits, Tarn Berserker Charge, Marro Water Clone.
   *     slice 6 (stat-folding batch): Raelin (Extended Defensive Aura),
   *     Deathwalker 9000 (Range Enhancement), Agent Carr (Sword of Reckoning 4),
   *     Grimnak (Orc Warrior Enhancement), Zettian Guards (Zettian Targeting),
   *     Syvarris (Double Attack).
   *   • 'wip'  — the card is draftable and fights with its printed stats, but
   *     its special power is NOT yet wired (no handler). The draft UI tags it
   *     "⚡ powers WIP". slice 7 (movement & defense batch) flips Drake/Krav
   *     Maga/Izumi live; after it the only wip cards are Airborne Elite, Mimring
   *     (its Fire Line — its Flying is live), and Ne-Gok-Sa (all need a slice-8
   *     special attack / placement / control power).
   * The engine's power dispatch keys off card id, so a `wip` card simply has no
   * handler — this flag drives the UI label, not engine branching.
   */
  power: 'live' | 'wip';
  // ---- slice 7: movement & defense power flags (cards.md exact text) --------
  // Data-driven so the movement search / move-consequence / damage code reads a
  // FLAG, not a hard-coded card id. Set in content.ts (raelin/mimring.flying,
  // agent_carr.ghostWalk+disengage, drake.thorianSpeed+grappleGun:25,
  // krav_maga.stealthDodge, izumi_samurai.counterStrike). Absent → falsey.
  /** FLYING (Raelin, Mimring): movement ignores elevation entirely (flat cost,
   *  no climb limit), passes over water without stopping and over ANY figure
   *  without engaging, and takes NO fall (it descends). Takeoff-while-engaged
   *  leaving swipes are UNCHANGED (start-vs-end adjacency). */
  flying?: boolean;
  /** GHOST WALK (Agent Carr): "can move through all figures" — the movement
   *  search may pass through ENEMY figures too (not just friendlies). Unlike
   *  Flying it still pays climb cost, still falls, still water-stops; still
   *  cannot END on an occupied hex. */
  ghostWalk?: boolean;
  /** DISENGAGE (Agent Carr): "never attacked when leaving an engagement" —
   *  moveConsequences yields zero leaving-engagement swipes, unconditionally. */
  disengage?: boolean;
  /** THORIAN SPEED (Sgt. Drake): opponents must be ADJACENT to attack Drake with
   *  a NORMAL attack — a non-adjacent normal (ranged) attack cannot target him.
   *  Special attacks are unrestricted. Defensive; gates targetBlockReason. */
  thorianSpeed?: boolean;
  /** STEALTH DODGE (Krav Maga Agents): when defending against a NON-adjacent
   *  attacker, one shield blocks ALL damage. Defensive; gates the damage calc. */
  stealthDodge?: boolean;
  /** COUNTER STRIKE (Izumi Samurai): when defending a NORMAL attack from an
   *  ADJACENT attacker (not another Samurai with this same power), excess shields
   *  (shields − skulls) become unblockable hits on the ATTACKER. Reflective. */
  counterStrike?: boolean;
  /** GRAPPLE GUN N (Sgt. Drake, N=25): as his move, Drake may step exactly ONE
   *  space whose height is up to N levels higher (climb limit waived ≤ N); it
   *  REPLACES his normal move. Engagement rules still apply. The number is the
   *  printed "25" level cap. */
  grappleGun?: number;
};

/** A placeable order-marker face: 1/2/3 grant your 1st/2nd/3rd turn this
 *  round; X is a pure decoy and never grants a turn (02-rounds §Step 1). */
export type OrderMarkerValue = '1' | '2' | '3' | 'X';

/**
 * An order marker sitting on an army card. Unrevealed marker values are
 * SECRET to everyone but the owner: `projectStateForViewer` replaces them
 * with the 'hidden' placeholder before state leaves the server, so 'hidden'
 * only ever appears in PROJECTED states, never in stored server state. The
 * X decoy must be indistinguishable from 1/2/3 in every projected byte.
 */
export type OrderMarker = {
  marker: OrderMarkerValue | 'hidden';
  revealed: boolean;
};

/** An army card in play, owned by a seat. */
export type ArmyCardInstance = {
  uid: string; // unique within the game, e.g. "s0-finn"
  cardId: string; // -> HS_CARDS in content.ts
  ownerSeat: number;
  /** This round's order markers on the card. Cleared every round. */
  orderMarkers: OrderMarker[];
  /** PERMANENT Spirit bonuses (slice 4). When Finn is destroyed his Warrior's
   *  Attack Spirit is placed on any unique Army Card, adding +1 to that card's
   *  attack number forever (cards.md); Thorgrim's Armor Spirit adds +1 defense.
   *  These persist for the rest of the game and fold into the effective-stat
   *  helpers. Default 0; absent on slice-2/3 saves → treated as 0. */
  attackMod: number;
  defenseMod: number;
  /** Airborne Elite GRENADE SPECIAL ATTACK is ONCE PER GAME (the single grenade
   *  marker). Set true when the squad throws; never reset. Absent → not yet
   *  used. Only ever set on the Airborne Elite card. */
  grenadeUsed?: boolean;
};

export type Figure = {
  id: string; // `${cardUid}-${index}`
  cardUid: string;
  ownerSeat: number;
  /** Hex the figure stands on; null once destroyed. For a DOUBLE-SPACE figure
   *  this is the anchor / leading hex. */
  at: HexKey | null;
  /** DOUBLE-SPACE figures (baseSize 2: Mimring, Grimnak) also occupy this
   *  TRAILING hex — adjacent to `at`, same level. null/absent for 1-hex figures
   *  and once destroyed; the footprint is {at, at2}. */
  at2?: HexKey | null;
  /** 1-based index within its card (squad disc numbering). */
  index: number;
  /** Wound markers taken. Destroyed when wounds reach the card's Life. */
  wounds: number;
  /** Player-set FACING — a hex direction 0-5 (indexing the board's DIRS). For a
   *  DOUBLE-SPACE figure it tracks the lead→trailing direction so the base
   *  orients to match; for a 1-hex figure it is purely cosmetic (HeroScape has
   *  no facing rules). Absent → 0. Set via the `orient_figure` action. */
  facing?: number;
  /** RESERVE (Airborne Elite — THE DROP, Big Heroes slice): the figure is OFF the
   *  battlefield but ALIVE — it has not been deployed yet (`at` is null, same as a
   *  destroyed figure, so `reserve` is what distinguishes the two). A reserve
   *  figure counts as living for the elimination / order-marker checks but cannot
   *  be targeted, occupies no hex, and cannot act until The Drop places it (which
   *  clears this flag). Absent → a normal figure (on-board if `at`, else dead). */
  reserve?: boolean;
};

export type HSPlayer = {
  /** Room seat — stable for the whole match (turn-order invariant). */
  seat: number;
  playerId: string;
  username: string;
  accent_color?: string;
  /** Team id (multiplayer / teams). Players sharing a `team` are ALLIES: they
   *  win/lose together, don't engage one another, and draft from a shared
   *  budget. ABSENT ⇒ the player is their own team (free-for-all), so a 2-player
   *  game is always 1-v-1 and every pre-teams save loads unchanged. Assigned by
   *  the host in the lobby (by colour). See `teamOfSeat` / `teamBudgetFor`. */
  team?: number;
  /** AI opponent. A bot seat is filled by the engine (not a human join); its
   *  `playerId` is synthetic ("bot-<seat>"). The server drives its draft /
   *  placement / turns via `ai_step` (see ai.ts). Absent ⇒ a human player. */
  bot?: boolean;
};

export type HSLogEntry = {
  seq: number;
  text: string;
  /** 'fall' surfaces falling-damage and leaving-engagement swipe rolls; 'power'
   *  surfaces special-power triggers (Berserker Charge, Water Clone, Spirits);
   *  'glyph' surfaces glyph activations/heals; the rest are slice-2 categories. */
  tag: 'info' | 'roll' | 'move' | 'attack' | 'fall' | 'win' | 'power' | 'glyph';
};

/**
 * One d20 initiative attempt: every seat's roll. Ties for highest re-roll;
 * every attempt (including the tied ones) is kept for the board's display.
 *
 * `roll` is the EFFECTIVE roll used to decide order. Slice 4: the Glyph of
 * Dagmar adds +8 to its controller's initiative (05-glyphs), so the server may
 * report a `roll` above 20. The optional `raw`/`bonus` break it out for the
 * engine to re-validate (raw 1-20, bonus exactly the Dagmar +8 the controlling
 * seat is owed) and for the board to show "14 (+8 Dagmar)". When `raw`/`bonus`
 * are absent (slice-2/3 attempts), `roll` is a bare 1-20 d20.
 */
export type InitiativeAttempt = { seat: number; roll: number; raw?: number; bonus?: number }[];

/** The most recent attack, for the board's dice display. */
export type LastAttack = {
  attackerId: string;
  targetId: string;
  attackerLabel: string;
  targetLabel: string;
  attackRoll: CombatFace[];
  defenseRoll: CombatFace[];
  /** SPECIAL ATTACKS that splash multiple figures (Fire Line / Grenade / Wild
   *  Swing) roll ONE shared attack, then each affected figure rolls defense
   *  SEPARATELY. This carries one entry per affected figure so the dice overlay
   *  can reveal each figure's own defense roll in turn (the player asked to
   *  "see each roll of defense"). Absent for normal single-target attacks — the
   *  overlay then falls back to the single `defenseRoll`. */
  defenseGroups?: { label: string; roll: CombatFace[]; shields: number; wounds: number; destroyed: boolean }[];
  skulls: number;
  shields: number;
  /** Unblocked skulls = wounds inflicted (skulls − shields, min 0). */
  wounds: number;
  destroyed: boolean;
  /** COUNTER STRIKE reflected wounds (slice 7): when an Izumi Samurai defends a
   *  NORMAL attack from an adjacent non-Samurai attacker and rolls more shields
   *  than skulls, the excess (shields − skulls) is dealt back to the ATTACKER as
   *  unblockable wounds. Surfaced here for the dice panel ("Izumi counters for
   *  N!"). Absent / 0 when Counter Strike did not fire. */
  counterWounds?: number;
  /** Height-advantage bonus dice folded into the rolls (04-combat): extra
   *  ATTACK dice the higher attacker rolled / extra DEFENSE dice the higher
   *  defender rolled. 0 when neither figure was uphill. For the dice-panel
   *  caption only — the counts are already reflected in attack/defenseRoll. */
  heightBonusAttacker?: number;
  heightBonusDefender?: number;
  /** Human-readable breakdown of HOW the attack/defense dice counts were
   *  reached (slice 4): e.g. ["Attack 3 printed", "+1 height", "+1 Astrid"],
   *  then ["Defense 4 printed", "+1 Thorgrim aura"]. Drives the dice-panel
   *  caption so a player can see why the count is what it is. The values are
   *  already folded into attackRoll/defenseRoll. */
  breakdown?: string[];
  /** Monotonic counter so the UI can detect a fresh roll. */
  seq: number;
};

/** The last NON-combat d20 roll (initiative + every d20 special power: Mind
 *  Shackle, Chomp, Berserker Charge, The Drop, Marro resurrection, Throw…). Drives
 *  a centered dice overlay so these rolls are as VISIBLE as attack rolls — they
 *  used to only appear as a log line. Shared state ⇒ both players see it. */
export type LastRoll = {
  /** Short headline, e.g. "Initiative", "Mind Shackle". */
  title: string;
  /** The d20 value(s), in display order (initiative = one per seat in roll
   *  order; single-die powers have one; Marro resurrect = one per Warrior). */
  dice: number[];
  /** Optional caption per die, aligned with `dice` (initiative: player names). */
  labels?: string[];
  /** Outcome caption, e.g. "Natural 20 — seizes the Izumi Samurai!". */
  detail: string;
  /** Result styling: true = success (green), false = fail (red), undefined =
   *  neutral (e.g. an initiative report just states the order). */
  success?: boolean;
  /** Monotonic counter so the UI can detect a fresh roll. */
  seq: number;
};

// ============================================================================
// Glyphs (slice 4 — docs/heroscape/05-glyphs-special-powers.md)
// ============================================================================

/**
 * Glyph identity. Slice 4 implements the five PERMANENT glyphs
 * (Astrid/Gerda/Ivor/Valda/Dagmar) and the temporary HEALER glyph (Kelda).
 * Erland (summon) and Mitonsoul (mass curse) and the two Brandar artifacts are
 * deferred (slice 5 / scenario) — the framework carries them so they slot in
 * later, but their effects are inert in slice 4.
 */
export type HSGlyphId =
  // --- permanent (active only while a figure stands on the glyph) ---
  | 'astrid' // Attack +1 for all your figures, NORMAL attacks only
  | 'gerda' // Defense +1 for all your figures
  | 'ivor' // Range +2 for your figures with printed Range ≥ 4
  | 'valda' // Move +2 for all your figures (not the move off the glyph)
  | 'dagmar' // Initiative +8
  | 'jalgard' // Defense +2 for all your figures (two extra defense dice)
  | 'lodin' // D20 +1 — +1 to any d20 the controlling player rolls
  | 'rannveig' // No Flying — figures lose Flying while any figure stands here
  | 'proftaka' // Trap — the figure here can't move unless a friendly is adjacent
  | 'thorian' // Melee Only — opponents must be adjacent to attack your figures
  | 'wannok' // Curse — end-of-round d20: wound the figure here, or an opponent's
  | 'brandar' // scenario: artifact (no fixed power; excluded from the random pool)
  // --- temporary (fires once when a figure stops on it) ---
  | 'kelda' // Heal all wounds, then removed (only the wounded may stop)
  | 'erland' // Summon: move any one figure adjacent to the figure here
  | 'mitonsoul' // Massive Curse: every figure rolls d20; a 1 is destroyed
  | 'sturla' // Resurrection: each owner rolls d20 per dead figure; a 20 returns it
  | 'nilrend' // Negation: d20 picks a unique figure; its powers off for the game
  | 'oreld'; // Remove Marker: d20 removes one of your / an opponent's order markers

/**
 * A glyph on the battlefield. `faceUp` (power-side up) is always true in
 * slice 4 — glyphs are placed power-side-up so their effects are known. The
 * symbol-side-up + flip-on-first-land mechanic (faceUp:false) is deferred; the
 * shape carries the flag so it slots in later (05-glyphs §1).
 */
export type HSGlyph = {
  id: HSGlyphId;
  at: HexKey;
  faceUp: boolean;
};

// ============================================================================
// PendingChoice (slice 4 — Long Shot / Legendary pattern)
// ============================================================================

/**
 * A player decision that must be PROMPTED, never auto-resolved
 * (rules-fidelity §choice). While `HSState.pendingChoice` is set, the engine
 * blocks every normal action and accepts ONLY a matching `resolve_choice` from
 * the owning `seat`. `getActivePlayerId` points at that seat so the hourglass
 * follows the decider.
 *   • berserker_charge   — Tarn's "you MAY move all again" after a 15+ d20.
 *   • water_clone_place  — choose each returned Marro Warrior's landing hex.
 *   • spirit_placement   — on Finn/Thorgrim's destruction, choose any unique
 *                          Army Card to receive the +1 attack/defense Spirit.
 */
export type HSPendingChoice =
  | { kind: 'berserker_charge'; seat: number; cardUid: string }
  | {
      kind: 'water_clone_place';
      seat: number;
      /** One entry per SUCCESSFUL Water Clone roll that has a legal landing AND
       *  a destroyed Marro available. `cloneFigureId` is the destroyed Marro
       *  being returned; `options` are the same-level empty hexes adjacent to
       *  the Warrior that rolled. Resolved in order; `chosen` accumulates. */
      placements: { cloneFigureId: string; rollerFigureId: string; options: HexKey[] }[];
      chosen: HexKey[];
    }
  | {
      kind: 'spirit_placement';
      seat: number;
      spirit: 'attack' | 'defense';
      /** Living unique Army Card uids the Spirit may be placed on (ANY owner —
       *  Finn/Thorgrim's text is not friendly-restricted, cards.md). */
      options: string[];
    }
  | {
      // Airborne GRENADE SPECIAL ATTACK throw sequence (cards.md) — "one at a
      // time … with each Airborne Elite." `throwers` is the ordered queue of
      // living Elite figure ids still to throw; the FIRST is throwing now. The
      // owner resolves each with a `grenade_throw` action (a chosen Range-5
      // target); the engine shifts the queue, auto-skipping any Elite with no
      // figure in range, until it is empty.
      kind: 'grenade_throw';
      seat: number;
      cardUid: string;
      throwers: string[];
    }
  | {
      // Airborne Elite THE DROP placement (cards.md) — opened when the d20 roll
      // (the_drop action) lands 13+, BEFORE order markers, so the global roll is
      // seen first. The owner then deploys all `count` reserve Airborne onto chosen
      // empty spaces (not adjacent to each other or any figure, not on glyphs). The
      // pendingChoice gate forces this to resolve before markers/anything else.
      kind: 'airborne_drop';
      seat: number;
      cardUid: string;
      count: number;
    };

/** Payload that resolves a `pendingChoice` — `kind` must match the open one. */
export type HSChoiceResolution =
  | { kind: 'berserker_charge'; remove: boolean } // true = re-move (re-grant), false = decline
  | { kind: 'water_clone_place'; hex: HexKey } // landing for the NEXT pending placement
  | { kind: 'spirit_placement'; cardUid: string } // unique card to receive the Spirit
  | { kind: 'airborne_drop'; placements: HexKey[] }; // landings for all reserve Airborne Elite

/**
 * Game phase. Slice 5 inserts a `draft` (army-building) and a `placement`
 * (arrange-your-figures) phase between lobby and playing — but only in `draft`
 * mode. `quick` mode auto-fills the preset armies and auto-places them, going
 * straight to `playing` (preserving the slice-4 fast path).
 *
 *   lobby → (draft → placement)? → playing(rounds…) → finished
 */
export type HSPhase = 'lobby' | 'draft' | 'placement' | 'playing' | 'finished';

/**
 * Draft state (slice 5; phase === 'draft'). The 2-player procedure from
 * docs/heroscape/extraction/resolutions.md (verified): both roll d20 (re-roll
 * ties); the HIGH roller picks 1 card, the OTHER picks 2, then alternate 1 each
 * starting back with the high roller (A, B, B, A, B, A, …). A UNIQUE card is
 * removed from `pool` when drafted (once total); a COMMON card stays and can be
 * re-drafted (whole current roster is Unique, so this only bites future Commons).
 * A player may not pick a
 * card whose Points push their army over `pointBudget`; they MUST pass when no
 * affordable card remains, and MAY pass voluntarily under budget. Passing
 * permanently completes that army. Draft ends when BOTH have passed.
 *
 * Open draft: every field here is PUBLIC (you watch the opponent's army form) —
 * projection adds nothing hidden.
 */
export type HSDraftState = {
  /** Remaining (un-drafted) card ids. A taken card is spliced out. */
  pool: string[];
  /** All seats in pick order, highest roll first — the SNAKE's forward direction. */
  order: number[];
  /** Current snake direction: +1 = forward through `order`, -1 = reverse. Flips at
   *  each end so the draft serpentines EVERY round (the end seat picks twice in a
   *  row at the turnaround), for any player count. Absent ⇒ +1 (forward). */
  dir?: 1 | -1;
  /** Every d20 roll-off attempt (ties re-rolled), for the board's display. */
  rollOff: InitiativeAttempt[];
  /** Whose pick it is now; null once every seat has passed (draft over). */
  turnSeat: number | null;
  /** Picks left in the current seat's turn (always 1 now — the snake balances
   *  going-late via the turnaround). Decrements per pick; at 0 the turn advances. */
  remainingPicks: number;
  /** Seats that have completed their army (passed). They leave the rotation. */
  passed: number[];
  /** seat → drafted card ids, in pick order (public). */
  armies: Record<number, string[]>;
  /** seat → points spent so far (Σ Points of drafted cards). */
  spent: Record<number, number>;
};

export type HSMode = 'draft' | 'quick';

/** Card-stat edition (chosen in the lobby). 'modern' = the rebalanced printing in
 *  HS_CARDS (the default everywhere). 'classic' applies CLASSIC_OVERRIDES (content.ts)
 *  — the original 2004-era points / range / attack for the handful of cards that
 *  differ. Absent on pre-edition saves → treated as 'modern' (current behaviour). */
export type HSEdition = 'classic' | 'modern';

/** Where a round stands while phase === 'playing' (02-rounds §The round):
 *  'place_markers' — all players simultaneously assign 1/2/3/X (ready-gated);
 *  'turns'         — initiative is rolled; players take turns 1→2→3. */
export type HSSubPhase = 'place_markers' | 'turns';

export type HSState = {
  version: number;
  phase: HSPhase;
  players: HSPlayer[];
  /** Battlefield id -> MAPS in maps.ts. Map geometry is static content, not
   *  stored in state (keeps the room JSONB lean). */
  mapId: string;
  /** Army-building mode chosen in the lobby (slice 5). 'draft' runs the roll-off
   *  + pick procedure; 'quick' auto-fills the preset armies. Absent on pre-
   *  slice-5 saves → treated as 'quick' (the old fixed-army behaviour). */
  mode: HSMode;
  /** Card-stat edition chosen in the lobby (Classic vs Modern). Frozen at game
   *  start; combat stats + draft budget resolve through it. Absent ⇒ 'modern'. */
  edition?: HSEdition;
  /** Point budget for the draft. The default cap a drafted army may not exceed;
   *  a team with no `teamBudgets` entry uses this. Custom amounts allowed
   *  (lobby free-entry). Unused by quick mode. */
  pointBudget: number;
  /** Per-TEAM point budgets (multiplayer / teams): team id → budget. The host
   *  may give each team a DIFFERENT total (a 3-v-2-v-1 can be balanced by hand).
   *  A team absent here falls back to `pointBudget`. Players sharing a team
   *  draft from this ONE shared pool (Σ their spend ≤ the team budget). Absent
   *  ⇒ every team uses `pointBudget` (the 2-player / FFA default). */
  teamBudgets?: Record<number, number>;
  /** Draft state — present only while phase === 'draft' (slice 5). */
  draft?: HSDraftState;
  /** Placement hands — present only while phase === 'placement' (slice 5):
   *  seat → ids of that seat's figures still IN HAND (not yet placed). A figure
   *  leaves the hand when placed and returns when unplaced. Figures left in hand
   *  at `placement_ready` are dropped (unused — faithful to "excess figures are
   *  unused", 01-components §5). */
  hand?: Record<number, string[]>;
  /** Seats that have locked in their placement (slice 5, phase === 'placement').
   *  Both ready → playing, round 1, place_markers. */
  placementReady?: number[];
  cards: ArmyCardInstance[];
  figures: Figure[];
  /** Round step — only meaningful while phase === 'playing'. */
  subPhase: HSSubPhase;
  /** 1-based round counter (the Round Marker Track). */
  round: number;
  /** Stalemate backstop (digital-only): the living-figure count at the last round
   *  where it CHANGED, and that round. If it stays unchanged for too many rounds the
   *  armies can't engage and the engine ends the game by surviving army. Absent until
   *  the first round advance. */
  staleLiving?: number;
  staleSinceRound?: number;
  /** Which of your 3 turns the current slot is (the marker being resolved). */
  turnNumber: 1 | 2 | 3;
  /** Seats in this round's acting order: the initiative winner first, then
   *  passing left in seat order (02-rounds §Step 2). Empty until rolled. */
  initiative: number[];
  /** Every d20 attempt this round, ties included, for the board's display.
   *  Replaced each round. */
  initiativeRolls: InitiativeAttempt[];
  /** Index into `initiative` of the player acting now. */
  turnPointer: number;
  /** Seats that have locked in their markers this round. */
  markersReady: number[];
  /** Seat whose turn it is; null while placing markers / lobby / finished.
   *  Always initiative[turnPointer] during 'turns'. */
  turnSeat: number | null;
  /** Figures that completed their (single) move this turn. */
  movedFigureIds: string[];
  /** UNDO STACK for movement this turn. Each entry is a JSON snapshot of the
   *  whole state taken JUST BEFORE a move was applied (with `moveHistory` itself
   *  stripped, so snapshots don't nest/grow). `undo_move` pops the last one and
   *  restores it — a full rewind, including any leaving-engagement / fall dice the
   *  move caused. CLEARED the moment the turn commits past movement (any attack /
   *  special / end_turn / new active card / round rollover), which is the
   *  "before committing" boundary. Absent on pre-existing saves ⇒ treat as []. */
  moveHistory?: string[];
  /** In-progress STEP-BY-STEP walk (tap each space). Absent when no walk is underway.
   *  `swiped` = enemies that have ALREADY taken their one leaving-engagement swipe this walk
   *  (so each swipes once even if you weave in and out). Leaving is judged PER STEP from the
   *  figure's CURRENT footprint, so engaging an enemy mid-walk and then leaving still provokes
   *  it. `usedCost` = Move points spent so far (≤ effectiveMove). `stopped` once a water/glyph
   *  forced-stop step was taken. Cleared when the walk finalizes / the mover dies / turn ends. */
  stepMove?: { figureId: string; usedCost: number; startHex: HexKey; swiped: string[]; stopped?: boolean };
  /** Set true by "End move": the player has finished the MOVE phase and entered the ATTACK
   *  phase. While true no figure may move (movableFigure blocks it) and the board only lets the
   *  player attack. Cleared at each turn boundary and when Berserker Charge re-grants movement. */
  movementEnded?: boolean;
  /**
   * Per-turn attack log (slice 6) — one entry per attack resolved this turn,
   * in order. This is the SINGLE source of truth for "what has attacked":
   *   • `turnAttacks.length > 0` → some figure has attacked → the turn's
   *     movement is over and "instead of attacking" powers are spent.
   *   • count of entries with a given `attackerId` → how many times that figure
   *     has attacked → attack-eligibility gates on `count < maxAttacks(card)`
   *     (Syvarris's Double Attack = 2, every other figure = 1).
   *   • Zettian Targeting reads it to learn whether the FIRST Zettian Guard
   *     already hit this target this turn.
   * It is NOT a buff token — it is the turn's attack history, recomputed never
   * (it accumulates as attacks resolve) and cleared at the same boundaries as
   * `movedFigureIds` (turn start / end_turn / new active card / round rollover).
   * (Replaces the slice-2 `attackedFigureIds` boolean array — the redundancy is
   * removed; this carries strictly more information.)
   */
  turnAttacks: {
    attackerId: string;
    targetId: string;
    /** Which SPECIAL ATTACK produced this entry (Big Heroes, slice 8b): tags
     *  multi-attack specials so their per-turn limits and "no mixing with the
     *  normal attack" gates can read the history. Absent ⇒ a normal attack (or a
     *  pre-Big-Heroes save). Ice Shard caps at 3 + distinct targets; Queglix
     *  reads it alongside `queglixDiceSpent`. */
    special?: 'ice_shard' | 'queglix' | 'wild_swing' | 'acid_breath';
  }[];
  lastAttack: LastAttack | null;
  /** The last non-combat d20 roll (initiative + d20 special powers), for the
   *  dice overlay. Absent on pre-existing saves ⇒ treat as null. */
  lastRoll?: LastRoll | null;
  /** Transient spatial VFX for the 3D board — a breath/line special attack's SOURCE hex
   *  and the hexes it HITS, with a seq so every viewer's board replays the effect exactly
   *  once. Purely cosmetic; the projection passes it through (the attack is public). */
  lastEffect?: { kind: 'fire_line' | 'acid_breath' | 'ice_shard' | 'chomp' | 'blast' | 'counter_strike'; from: HexKey; to: HexKey[]; seq: number };
  /** Winning SEAT — a representative living seat of the winning team (for FFA /
   *  2-player this is simply the survivor). Null until the game finishes. */
  winnerSeat: number | null;
  /** Winning TEAM id (teams). Equals `teamOfSeat(winnerSeat)`; carried
   *  explicitly so the end banner can name the whole allied side, not one seat.
   *  Null until finished. */
  winnerTeam?: number | null;
  /** Glyphs on the battlefield (slice 4). Placed from a per-map layout; a
   *  temporary glyph (Kelda) is spliced out of this array once it fires. A
   *  permanent glyph's effect is active only while a figure stands on its hex —
   *  recomputed from positions, never stored as a token. */
  glyphs: HSGlyph[];
  /** An open player decision (slice 4). While set, ONLY the owning seat may act
   *  and ONLY via resolve_choice. Public — projection adds no hidden info. */
  pendingChoice?: HSPendingChoice;
  /** Whether the active card has already used its once-per-turn "instead of
   *  attacking" Water Clone this turn (slice 4) — set when Marro Water Clones,
   *  so the engine knows the card's attack is consumed. Cleared each turn. */
  waterClonedThisTurn?: boolean;
  /** Whether Tarn's Berserker Charge has been SPENT this turn by a FAILED d20
   *  (<15) — "one roll" on a miss (cards.md). A SUCCESS does not set this (the
   *  charge may repeat). Cleared each turn. */
  berserkerSpent?: boolean;
  /** Whether Ne-Gok-Sa has already made his ONE Mind Shackle attempt this turn
   *  (cards.md — one d20 in the after-move/before-attack window). Set on the
   *  attempt regardless of success. Cleared each turn. */
  mindShackleSpent?: boolean;
  /** Whether Grimnak has already Chomped this turn (cards.md — one chomp in the
   *  before-attack window). Set on the attempt regardless of result. Cleared each
   *  turn. */
  chompedThisTurn?: boolean;
  /** Airborne Elite THE DROP (Big Heroes slice): the ROUND number in which the
   *  Airborne owner last rolled The Drop's d20. The card allows one roll per round
   *  (at round start, before order markers) until it succeeds; this gates a second
   *  roll in the same round. A success deploys the figures (no reserve left), so
   *  the action then has nothing to do. Persists across rounds (compared to
   *  `round`); absent ⇒ never rolled. */
  airborneDropRound?: number;
  /** Major Q9 QUEGLIX GUN (Big Heroes): attack dice spent so far this turn from
   *  his 9-die pool. Each shot spends 1-3; he may keep shooting until all 9 are
   *  rolled. Cleared each turn; absent ⇒ 0 (pool full). */
  queglixDiceSpent?: number;
  /** Whether Jotun has used his THROW (Big Heroes) this turn — one attempt in the
   *  after-move/before-attack window, regardless of the d20 result. Does NOT
   *  consume his attack. Cleared each turn. */
  threwThisTurn?: boolean;
  log: HSLogEntry[];
  logSeq: number;
};

/**
 * Engine action union. All dice values are SERVER-ROLLED (makeMoveHS in
 * src/app/rooms/[id]/actions.ts) and passed in — the engine never calls
 * Math.random, so it stays pure, deterministic, and unit-testable.
 */
export type HSAction =
  | {
      kind: 'start_game';
      /** Battlefield the host chose in the lobby (validated against MAPS).
       *  Omitted → the default Training Field. */
      mapId?: string;
      /** Point budget for the draft (slice 5). Omitted → DEFAULT_POINT_BUDGET. */
      pointBudget?: number;
      /** Army-building mode (slice 5). Omitted → 'draft'. 'quick' skips the
       *  draft, auto-fills the preset armies, and auto-places them. */
      mode?: HSMode;
      /** Card-stat edition. Omitted → 'modern'. */
      edition?: HSEdition;
    }
  | {
      // Host changes the lobby settings (battlefield / budget / mode) BEFORE the
      // battle starts. Stored in shared state so every player sees the change —
      // not just the host's local UI. Host-gated in the server action.
      kind: 'set_lobby_config';
      mapId?: string;
      pointBudget?: number;
      mode?: HSMode;
      /** Card-stat edition (Classic vs Modern). Stored in shared state. */
      edition?: HSEdition;
      /** Team assignment (teams): seat → team id. Players sharing a team id are
       *  allies. Omitted seats fall back to their own seat (free-for-all). */
      teams?: Record<number, number>;
      /** Per-team budgets (teams): team id → points. Merged into state.
       *  A team absent here uses `pointBudget`. */
      teamBudgets?: Record<number, number>;
    }
  | {
      // Host adds an AI opponent to the next empty seat (lobby only). Optional
      // team assigns it to a side. The bot drafts / places / plays via ai_step.
      kind: 'add_bot';
      team?: number;
    }
  | {
      // Host removes an AI from a seat (lobby only).
      kind: 'remove_bot';
      seat: number;
    }
  | {
      // SERVER-rolled draft roll-off (slice 5): both seats' d20 attempts, ties
      // re-rolled (capped). Issued by makeMoveHS when entering the draft; the
      // engine validates the tie discipline and sets the pick order.
      kind: 'draft_roll';
      attempts: InitiativeAttempt[];
    }
  | {
      // Draft a card (slice 5): must be in the pool, affordable within the
      // seat's remaining budget, and it must be this seat's pick.
      kind: 'draft_card';
      cardId: string;
    }
  | {
      // Pass in the draft (slice 5): completes this seat's army permanently. The
      // engine FORCES a pass when nothing is affordable and ALLOWS a voluntary
      // pass under budget — but rejects passing with an empty army while an
      // affordable card still exists (≥1 card per player).
      kind: 'draft_pass';
    }
  | {
      // Placement (slice 5): set a still-in-hand figure onto an EMPTY hex of the
      // owner's OWN start zone.
      kind: 'place_figure';
      figureId: string;
      to: HexKey;
    }
  | {
      // Placement (slice 5): return a placed figure to the hand.
      kind: 'unplace_figure';
      figureId: string;
    }
  | {
      // Placement (slice 5): lock in this seat's placement (≥1 figure placed).
      // Figures left in hand are dropped (unused). Both ready → playing.
      kind: 'placement_ready';
    }
  | {
      kind: 'place_markers';
      /** Exactly four: one each of 1/2/3/X, each on one of your living cards
       *  (stacking — several markers on one card — is legal). */
      assignments: { marker: OrderMarkerValue; cardUid: string }[];
    }
  | {
      kind: 'roll_initiative';
      /** Sent by the SERVER automatically when the last player locks in.
       *  Every attempt before the last must be a tie for highest (that is why
       *  it was re-rolled); the final attempt must be tie-free. */
      attempts: InitiativeAttempt[];
    }
  | {
      kind: 'move_figure';
      figureId: string;
      to: HexKey;
      /** SERVER-rolled falling dice, supplied ONLY when the destination
       *  triggers a Fall/Major Fall (03-movement §4). The engine recomputes
       *  whether — and how many — dice are due and rejects a roll of the wrong
       *  shape (an unneeded roll, or a missing-but-required one). */
      fallRoll?: CombatFace[];
      /** SERVER-rolled d20 for an Extreme Fall (drop − Height ≥ 20). */
      extremeFallD20?: number;
      /** SERVER-rolled leaving-engagement swipes (03-movement §9): one attack
       *  die per enemy this move ABANDONS (engaged at move start, no longer
       *  adjacent at the destination). The engine validates the set matches the
       *  abandoned enemies exactly. */
      leaveRolls?: { enemyFigureId: string; roll: CombatFace }[];
    }
  | {
      // STEP-BY-STEP movement (one hex per tap). Walk the figure's FRONT a single adjacent hex
      // to `to`; the figure keeps stepping (state.stepMove tracks the walk) until it stops.
      // SERVER-rolled per-step leaving swipes (one die per start-engaged enemy this step leaves —
      // each once across the walk) and fall dice if this step drops. A 2-hex figure SLITHERS:
      // the front lobe leads to `to`, the back follows into the vacated hex.
      kind: 'move_step';
      figureId: string;
      to: HexKey;
      fallRoll?: CombatFace[];
      extremeFallD20?: number;
      leaveRolls?: { enemyFigureId: string; roll: CombatFace }[];
    }
  | {
      // UNDO the last move this turn (repeatable). Pops `state.moveHistory` and
      // restores that pre-move snapshot — a full rewind. Only the active seat, only
      // during 'turns', only while moves remain on the stack (i.e. before any
      // attack/special this turn clears it). No dice; pure state restore.
      kind: 'undo_move';
    }
  | {
      // "End move" — a soft commit that locks in the move by clearing the undo stack
      // (state.moveHistory). No dice, no other state change; only the active seat during 'turns'.
      kind: 'end_move';
    }
  | {
      // Sgt. Drake GRAPPLE GUN 25 (cards.md): "Instead of Sgt. Drake's normal
      // move, he may move only ONE space. This space may be up to 25 levels
      // higher. … all engagement rules still apply." A sibling of move_figure
      // that steps Drake exactly ONE hex with the climb limit WAIVED up to his
      // grappleGun cap (so he can scale a cliff he normally couldn't); it
      // REPLACES his normal move. Engagement/leaving-engagement apply normally —
      // the SERVER rolls the abandoned-enemy swipe dice (same validation path as
      // move_figure). He is not a flyer, so a downward step can still fall.
      kind: 'grapple_move';
      figureId: string;
      to: HexKey;
      /** SERVER-rolled falling dice if the one-space step drops Drake far enough
       *  (03-movement §4) — same shape/validation as move_figure. */
      fallRoll?: CombatFace[];
      /** SERVER-rolled d20 for an Extreme fall (drop − Height ≥ 20). */
      extremeFallD20?: number;
      /** SERVER-rolled leaving-engagement swipes, one die per abandoned enemy. */
      leaveRolls?: { enemyFigureId: string; roll: CombatFace }[];
    }
  | {
      kind: 'attack';
      attackerId: string;
      targetId: string;
      attackRoll: CombatFace[];
      defenseRoll: CombatFace[];
    }
  | {
      // Mimring FIRE LINE SPECIAL ATTACK (slice 8, cards.md): a straight line of
      // 8 spaces from Mimring in hex direction `dir` (0-5). EVERY figure on those
      // spaces in line of sight is hit — friend OR foe (no "enemy" qualifier).
      // The SERVER rolls 4 attack dice ONCE and each affected figure's defense
      // SEPARATELY; the engine re-derives the affected set + dice need and
      // validates. Special attack → never modified by glyphs, powers, or height.
      kind: 'fire_line';
      attackerId: string;
      dir: number;
      attackRoll: CombatFace[];
      defenseRolls: { figureId: string; roll: CombatFace[] }[];
    }
  | {
      // Deathwalker 9000 EXPLOSION SPECIAL ATTACK (cards.md) — choose an enemy in
      // clear sight within Range 7; the target AND figures adjacent to it (friend or
      // foe, INCLUDING Deathwalker himself) are hit. The SERVER rolls 3 attack dice
      // ONCE + each affected figure's defense; the engine re-derives the set,
      // validates, and applies it. Special attack → never modified by height/auras.
      kind: 'explosion';
      attackerId: string;
      targetId: string;
      attackRoll: CombatFace[];
      defenseRolls: { figureId: string; roll: CombatFace[] }[];
    }
  | {
      // Tarn BERSERKER CHARGE (cards.md) — rolled AFTER moving, BEFORE attacking.
      // The SERVER rolls the d20; on 15+ the engine offers a berserker_charge
      // PendingChoice (the re-move is the player's "may"). On <15 the charge is
      // spent for the turn. The roll itself is this explicit action.
      kind: 'berserker_charge';
      d20: number;
    }
  | {
      // Marro WATER CLONE (cards.md) — INSTEAD of attacking, only AFTER moving.
      // The SERVER rolls one d20 per living Marro Warrior; the engine validates
      // the set and the per-Warrior threshold (15+, or 10+ on water), then
      // collects a water_clone_place PendingChoice for each viable success.
      kind: 'water_clone';
      rolls: { marroFigureId: string; d20: number }[];
    }
  | {
      // Ne-Gok-Sa MIND SHACKLE 20 (cards.md) — after moving, before attacking,
      // an OPTIONAL attempt on a chosen ADJACENT enemy unique figure. The SERVER
      // rolls the d20; success on a NATURAL 20 only transfers that figure's whole
      // Army Card (+ all figures on it) to the shackler and removes its order
      // markers. Does NOT consume Ne-Gok-Sa's attack.
      kind: 'mind_shackle';
      targetId: string;
      d20: number;
    }
  | {
      // Grimnak CHOMP (cards.md) — before attacking, choose an adjacent ENEMY
      // medium-or-small figure. A Squad figure is destroyed automatically; a Hero
      // is destroyed on a SERVER-rolled d20 of 16+. Does NOT consume the attack.
      kind: 'chomp';
      targetId: string;
      d20: number;
    }
  | {
      // Airborne Elite GRENADE SPECIAL ATTACK (cards.md) — INITIATE. Removes the
      // once-per-game grenade marker and opens the throw sequence (one grenade
      // per living Elite, resolved one at a time via `grenade_throw`). No dice.
      kind: 'grenade';
    }
  | {
      // GRENADE SPECIAL ATTACK — resolve the CURRENT Elite's throw at a chosen
      // figure within Range 5 (no line of sight). Figures adjacent to the target
      // are also hit. The SERVER rolls 2 attack dice ONCE for all affected and
      // each affected figure's defense SEPARATELY; the engine re-derives the
      // affected set + dice need and validates, then advances to the next Elite.
      kind: 'grenade_throw';
      targetId: string;
      attackRoll: CombatFace[];
      defenseRolls: { figureId: string; roll: CombatFace[] }[];
    }
  | {
      // Nilfheim ICE SHARD BREATH SPECIAL ATTACK (Big Heroes): Range 5, Attack 4,
      // up to THREE attacks per turn, each at a DIFFERENT figure. One shot per
      // action; the engine caps at 3 and forbids repeating a target. Like a normal
      // single-target attack the SERVER rolls 4 attack dice + the defender's
      // defense; special attack → no height / aura on the attack.
      kind: 'ice_shard';
      attackerId: string;
      targetId: string;
      attackRoll: CombatFace[];
      defenseRoll: CombatFace[];
    }
  | {
      // Major Q9 QUEGLIX GUN SPECIAL ATTACK (Big Heroes): Range 6, a 9-die pool
      // for the turn spent 1-3 per shot. One shot per action (`dice` of them);
      // repeat until all 9 are spent, same or different targets. SERVER rolls
      // `dice` attack dice + the defender's defense.
      kind: 'queglix';
      attackerId: string;
      targetId: string;
      dice: 1 | 2 | 3;
      attackRoll: CombatFace[];
      defenseRoll: CombatFace[];
    }
  | {
      // Jotun WILD SWING SPECIAL ATTACK (Big Heroes): Range 1, Attack 4. The
      // chosen target AND every figure adjacent to it (friend or foe) are hit —
      // except Jotun himself. The SERVER rolls 4 attack dice ONCE and each affected
      // figure's defense SEPARATELY; the engine re-derives the affected set.
      kind: 'wild_swing';
      attackerId: string;
      targetId: string;
      attackRoll: CombatFace[];
      defenseRolls: { figureId: string; roll: CombatFace[] }[];
    }
  | {
      // Braxas POISONOUS ACID BREATH (Big Heroes): INSTEAD of attacking, choose up
      // to 3 different small/medium figures within 4 clear-sight spaces. The SERVER
      // rolls one d20 per chosen figure; Squad ≥ 8 / Hero ≥ 17 → destroyed (no
      // defense roll). The engine re-derives the legal target set + thresholds.
      kind: 'acid_breath';
      attackerId: string;
      rolls: { targetId: string; d20: number }[];
    }
  | {
      // Jotun THROW 14 (Big Heroes): after moving, before attacking, choose a
      // small/medium non-flying figure adjacent to Jotun. SERVER rolls `throwD20`;
      // on 14+ the figure is placed at `to` (empty, within 4 + clear sight of
      // Jotun) and `damageD20` (11+ → 2 wounds) is applied unless it lands higher
      // than Jotun or on water. Does NOT consume Jotun's attack.
      kind: 'throw_figure';
      attackerId: string;
      targetId: string;
      to: HexKey;
      throwD20: number;
      damageD20: number;
    }
  | {
      // Airborne Elite THE DROP (cards.md): at the start of a round, BEFORE order
      // markers, roll a d20. The SERVER rolls `d20`; this action is the ROLL ONLY,
      // so every player sees the global dice overlay before any landing is chosen.
      // On 13+ the engine opens an `airborne_drop` pending choice (the owner then
      // places all reserve Airborne); on a miss (<13) they stay in reserve. One
      // roll per round.
      kind: 'the_drop';
      d20: number;
    }
  | {
      // Theracus CARRY (Big Heroes): before moving, choose an unengaged friendly
      // small/medium figure adjacent to Theracus; after Theracus flies to `to`,
      // the passenger is placed at `passengerTo` (empty, adjacent to Theracus's new
      // position). Theracus's own move validates exactly like move_figure (flyer →
      // SERVER rolls any takeoff leaving-engagement swipes; no fall).
      kind: 'carry_move';
      figureId: string;
      to: HexKey;
      passengerId: string;
      passengerTo: HexKey;
      fallRoll?: CombatFace[];
      extremeFallD20?: number;
      leaveRolls?: { enemyFigureId: string; roll: CombatFace }[];
    }
  | {
      // Resolve the open pendingChoice. Only the owning seat may send it and the
      // payload kind must match (engine-validated). NEVER auto-issued.
      kind: 'resolve_choice';
      choice: HSChoiceResolution;
    }
  | {
      // Player-chosen ORIENTATION (figure-presentation slice). `dir` is a hex
      // direction 0-5 (board DIRS). For a DOUBLE-SPACE figure it swings the
      // TRAILING hex onto the lead's neighbour in `dir` — which must be a real,
      // EMPTY, SAME-LEVEL hex; BLOCKED while the figure is engaged so it can't be
      // a free escape from a leaving-engagement swipe. For a 1-hex figure it sets
      // a purely cosmetic facing. Free — never consumes the move/attack.
      kind: 'orient_figure';
      figureId: string;
      dir: number;
    }
  | { kind: 'end_turn' };

export type HSResult = HSState | { error: string };
