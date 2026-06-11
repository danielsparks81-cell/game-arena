// HeroScape — public barrel for the engine (slice 1: Basic Game).

export {
  initialState,
  createInitialStateForHost,
  addPlayer,
  removePlayer,
  applyAction,
  getActivePlayerId,
  getOrderedPlayerIds,
  computeHistory,
  legalDestinations,
  legalTargets,
  attackDiceRequirements,
  figureLabel,
  cardDef,
  STATE_VERSION,
  LOG_MAX,
} from './engine';

export { HS_CARDS, SLICE1_ARMIES, COMBAT_DIE_FACES, ROLL_OFF_DICE } from './content';

export { MAPS, TRAINING_FIELD, parseMap } from './maps';
export type { HSMap } from './maps';

export {
  hexKey,
  parseHexKey,
  offsetToAxial,
  axialToOffset,
  neighborKeys,
  hexDistance,
  rangeDistance,
  reachableDestinations,
  hexToPixel,
  hexCorners,
  segmentCrossesHex,
  hasLineOfSight,
} from './board';
export type { Occupancy, Pixel } from './board';

export type {
  Axial,
  HexKey,
  HexCell,
  Terrain,
  CombatFace,
  HSCardType,
  HSCardDef,
  ArmyCardInstance,
  Figure,
  HSPlayer,
  HSLogEntry,
  RollOffRound,
  RollOffResult,
  LastAttack,
  HSPhase,
  HSState,
  HSAction,
  HSResult,
} from './types';
