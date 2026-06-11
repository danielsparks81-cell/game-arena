// HeroScape — shared type definitions.
//
// SLICE 2 (docs/heroscape/slice-2-spec.md): the MASTER GAME round engine — 2
// players, fixed armies, the flat TEST-1 "Training Field" map. Each round:
// secret order markers (1/2/3/X) → d20 initiative (ties re-roll) → 3 turns per
// player driven by the revealed marker — plus Master combat (wounds vs Life).
// Special powers, elevation, water, engagement, and height advantage are later
// slices (3-5).

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
  tag: 'info' | 'roll' | 'move' | 'attack' | 'win';
};

/** One d20 initiative attempt: every seat's roll. Ties for highest re-roll;
 *  every attempt (including the tied ones) is kept for the board's display. */
export type InitiativeAttempt = { seat: number; roll: number }[];

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
  /** Monotonic counter so the UI can detect a fresh roll. */
  seq: number;
};

export type HSPhase = 'lobby' | 'playing' | 'finished';

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
  /** Figures that attacked this turn. Any attack ends the turn's movement. */
  attackedFigureIds: string[];
  lastAttack: LastAttack | null;
  winnerSeat: number | null;
  log: HSLogEntry[];
  logSeq: number;
};

/**
 * Engine action union. All dice values are SERVER-ROLLED (makeMoveHS in
 * src/app/rooms/[id]/actions.ts) and passed in — the engine never calls
 * Math.random, so it stays pure, deterministic, and unit-testable.
 */
export type HSAction =
  | { kind: 'start_game' }
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
  | { kind: 'move_figure'; figureId: string; to: HexKey }
  | {
      kind: 'attack';
      attackerId: string;
      targetId: string;
      attackRoll: CombatFace[];
      defenseRoll: CombatFace[];
    }
  | { kind: 'end_turn' };

export type HSResult = HSState | { error: string };
