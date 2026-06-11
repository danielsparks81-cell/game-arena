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
  grappleDestinations,
  legalTargets,
  placeableHexes,
  POINT_BUDGETS,
  DEFAULT_POINT_BUDGET,
  attackDiceRequirements,
  heightAdvantage,
  effectiveAttackDice,
  effectiveDefenseDice,
  effectiveMove,
  effectiveRange,
  moveConsequences,
  figureLabel,
  cardDef,
  STATE_VERSION,
  LOG_MAX,
} from './engine';
export type { EffectiveStat } from './engine';

export { HS_CARDS, HS_DRAFT_POOL, SLICE1_ARMIES, COMBAT_DIE_FACES, HS_GLYPHS, POWER_DESCRIPTIONS } from './content';
export type { HSGlyphDef, HSGlyphKind } from './content';

export { MAPS, TRAINING_FIELD, THE_KNOLL, FORD_CROSSING, parseMap } from './maps';
export type { HSMap, HSGlyphPlacement } from './maps';

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
export type { Occupancy, Pixel, FallTier, ReachOptions } from './board';

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
  HSGlyph,
  HSGlyphId,
  HSPendingChoice,
  HSChoiceResolution,
  HSMode,
  HSDraftState,
} from './types';
