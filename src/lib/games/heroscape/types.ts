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
   *     "⚡ powers WIP". The remaining 6 complex active powers land in slice 7.
   * The engine's power dispatch keys off card id, so a `wip` card simply has no
   * handler — this flag drives the UI label, not engine branching.
   */
  power: 'live' | 'wip';
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
};

export type Figure = {
  id: string; // `${cardUid}-${index}`
  cardUid: string;
  ownerSeat: number;
  /** Hex the figure stands on; null once destroyed. */
  at: HexKey | null;
  /** 1-based index within its card (squad disc numbering). */
  index: number;
  /** Wound markers taken. Destroyed when wounds reach the card's Life. */
  wounds: number;
};

export type HSPlayer = {
  /** Room seat — stable for the whole match (turn-order invariant). */
  seat: number;
  playerId: string;
  username: string;
  accent_color?: string;
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
  skulls: number;
  shields: number;
  /** Unblocked skulls = wounds inflicted (skulls − shields, min 0). */
  wounds: number;
  destroyed: boolean;
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
  | 'astrid' // Attack +1 for all your figures (permanent, while occupied)
  | 'gerda' // Defense +1 for all your figures (permanent)
  | 'ivor' // Range +4 for your figures with printed Range ≥ 4 (permanent)
  | 'valda' // Move +2 for all your figures (permanent)
  | 'dagmar' // Initiative +8 (permanent)
  | 'kelda' // Heal all wounds, then removed (temporary; only the wounded may stop)
  | 'erland' // slice 5: summon (temporary)
  | 'mitonsoul' // slice 5: mass curse (temporary)
  | 'brandar'; // scenario: artifact (no fixed power)

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
    };

/** Payload that resolves a `pendingChoice` — `kind` must match the open one. */
export type HSChoiceResolution =
  | { kind: 'berserker_charge'; remove: boolean } // true = re-move (re-grant), false = decline
  | { kind: 'water_clone_place'; hex: HexKey } // landing for the NEXT pending placement
  | { kind: 'spirit_placement'; cardUid: string }; // unique card to receive the Spirit

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
 * starting back with the high roller (A, B, B, A, B, A, …). Each of the 16
 * cards is UNIQUE — drafting it removes it from `pool`. A player may not pick a
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
  /** [highRoller, other] seats — the pick order from the roll-off. */
  order: number[];
  /** Every d20 roll-off attempt (ties re-rolled), for the board's display. */
  rollOff: InitiativeAttempt[];
  /** Whose pick it is now; null once BOTH seats have passed (draft over). */
  turnSeat: number | null;
  /** Picks left in the current seat's turn (2 for the second player's opener,
   *  else 1). Decrements per pick; at 0 the turn passes to the other seat. */
  remainingPicks: number;
  /** Seats that have completed their army (passed). They leave the rotation. */
  passed: number[];
  /** seat → drafted card ids, in pick order (public). */
  armies: Record<number, string[]>;
  /** seat → points spent so far (Σ Points of drafted cards). */
  spent: Record<number, number>;
};

export type HSMode = 'draft' | 'quick';

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
  /** Point budget for the draft (200/300/400/500). The cap a drafted army may
   *  not exceed. Unused by quick mode. */
  pointBudget: number;
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
  turnAttacks: { attackerId: string; targetId: string }[];
  lastAttack: LastAttack | null;
  winnerSeat: number | null;
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
      kind: 'attack';
      attackerId: string;
      targetId: string;
      attackRoll: CombatFace[];
      defenseRoll: CombatFace[];
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
      // Resolve the open pendingChoice. Only the owning seat may send it and the
      // payload kind must match (engine-validated). NEVER auto-issued.
      kind: 'resolve_choice';
      choice: HSChoiceResolution;
    }
  | { kind: 'end_turn' };

export type HSResult = HSState | { error: string };
