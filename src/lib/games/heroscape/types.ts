// HeroScape — shared type definitions.
//
// SLICE 1 (docs/heroscape/ARCHITECTURE.md §11): the BASIC GAME only — 2
// players, fixed armies, the flat TEST-1 "Training Field" map, strictly
// alternating single turns (no order markers / d20 initiative / rounds), and
// binary destruction (no wounds — a single unblocked hit destroys). Special
// powers, elevation, water, engagement, and height advantage are later slices.

/** Axial hex coordinate (pointy-top). Stored in state as a "q,r" key. */
export type Axial = { q: number; r: number };
export type HexKey = string; // `${q},${r}`

export type Terrain = 'grass' | 'rock' | 'sand' | 'water';

export type HexCell = {
  q: number;
  r: number;
  /** Tile-stack height in levels. Slice-1 maps are all height 1 (flat). */
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
  /** Printed Life. Unused in the Basic Game (binary destroy) — card data for later slices. */
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

/** An army card in play, owned by a seat. */
export type ArmyCardInstance = {
  uid: string; // unique within the game, e.g. "s0-finn"
  cardId: string; // -> HS_CARDS in content.ts
  ownerSeat: number;
};

export type Figure = {
  id: string; // `${cardUid}-${index}`
  cardUid: string;
  ownerSeat: number;
  /** Hex the figure stands on; null once destroyed. */
  at: HexKey | null;
  /** 1-based index within its card (squad disc numbering). */
  index: number;
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

/** One round of the first-player roll-off: 6 combat dice per player, most
 *  skulls takes the first turn, ties re-roll (01-components §2). Arrays are in
 *  ROSTER order (players[0], players[1]). Kept in state so the board can show
 *  the opening roll. */
export type RollOffRound = {
  seat0: CombatFace[];
  seat1: CombatFace[];
};

export type RollOffResult = {
  rounds: RollOffRound[];
  winnerSeat: number;
};

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
  destroyed: boolean;
  /** Monotonic counter so the UI can detect a fresh roll. */
  seq: number;
};

export type HSPhase = 'lobby' | 'playing' | 'finished';

export type HSState = {
  version: number;
  phase: HSPhase;
  players: HSPlayer[];
  /** Battlefield id -> MAPS in maps.ts. Map geometry is static content, not
   *  stored in state (keeps the room JSONB lean). */
  mapId: string;
  cards: ArmyCardInstance[];
  figures: Figure[];
  /** Seat whose turn it is; null in lobby / finished. */
  turnSeat: number | null;
  /** The ONE army card activated this turn (Basic Game: choose any one card →
   *  move → attack). Locked in by the turn's first move or attack. */
  activeCardUid: string | null;
  /** Figures that completed their (single) move this turn. */
  movedFigureIds: string[];
  /** Figures that attacked this turn. Any attack ends the turn's movement. */
  attackedFigureIds: string[];
  rollOff: RollOffResult | null;
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
  | { kind: 'start_game'; rollOffs: RollOffRound[] }
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
