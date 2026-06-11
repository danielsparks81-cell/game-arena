// HeroScape — public barrel for the engine (slice 2: Master Game rounds).

export {
  initialState,
  createInitialStateForHost,
  addPlayer,
  removePlayer,
  applyAction,
  getActivePlayerId,
  getOrderedPlayerIds,
  computeHistory,
  projectStateForViewer,
  getActiveCardUid,
  legalDestinations,
  legalTargets,
  attackDiceRequirements,
  heightAdvantage,
  moveConsequences,
  figureLabel,
  cardDef,
  STATE_VERSION,
  LOG_MAX,
} from './engine';

export { HS_CARDS, SLICE1_ARMIES, COMBAT_DIE_FACES } from './content';

export { MAPS, TRAINING_FIELD, THE_KNOLL, FORD_CROSSING, parseMap } from './maps';
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
  stepCost,
  canStepUp,
  areEngaged,
  computeFall,
  hexToPixel,
  hexCorners,
  segmentCrossesHex,
  hasLineOfSight,
  hasLineOfSight3D,
} from './board';
export type { Occupancy, Pixel, FallTier } from './board';

export type {
  Axial,
  HexKey,
  HexCell,
  Terrain,
  CombatFace,
  HSCardType,
  HSCardDef,
  OrderMarkerValue,
  OrderMarker,
  ArmyCardInstance,
  Figure,
  HSPlayer,
  HSLogEntry,
  InitiativeAttempt,
  LastAttack,
  HSPhase,
  HSSubPhase,
  HSState,
  HSAction,
  HSResult,
} from './types';
