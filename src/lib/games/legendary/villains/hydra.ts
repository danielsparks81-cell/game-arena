import type { VillainCardDef } from '../types';

// HYDRA — Red Skull's "Always Leads" group. 8 cards total: 2 copies × 4 villains.

export const HYDRA_SOLDIER: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_soldier',
  name: 'Hydra Soldier',
  attack: 3,
  vp: 2,
  team: 'hydra',
};

export const HYDRA_VIPER: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_viper',
  name: 'Viper',
  attack: 4,
  vp: 3,
  team: 'hydra',
  text: 'Ambush: Each player gains a Wound.',
  ambush: [{ kind: 'gain_wound' }],
};

export const HYDRA_CROSSBONES: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_crossbones',
  name: 'Crossbones',
  attack: 5,
  vp: 4,
  team: 'hydra',
};

export const HYDRA_BARON_STRUCKER: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_baron_strucker',
  name: 'Baron Strucker',
  attack: 6,
  vp: 5,
  team: 'hydra',
  text: 'Escape: Each player gains a Wound.',
  escape: [{ kind: 'gain_wound' }],
};

export const HYDRA_GROUP = {
  groupId: 'hydra',
  team: 'hydra' as const,
  cards: [
    { def: HYDRA_SOLDIER,        copies: 2 },
    { def: HYDRA_VIPER,          copies: 2 },
    { def: HYDRA_CROSSBONES,     copies: 2 },
    { def: HYDRA_BARON_STRUCKER, copies: 2 },
  ],
};
