import type { VillainCardDef } from '../types';

// HYDRA — Red Skull's "Always Leads" group. 7 cards total.
// Composition mirrors the physical base-set villain deck:
//   3× Hydra Kidnappers   (cheap ambush fodder)
//   3× Endless Armies of Hydra (mid-tier bruisers)
//   1× Viper              (rare elite — ambush wound)

export const HYDRA_KIDNAPPERS: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_kidnappers',
  name: 'Hydra Kidnappers',
  attack: 3,
  vp: 1,
  team: 'hydra',
};

export const HYDRA_ENDLESS_ARMIES: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_endless_armies',
  name: 'Endless Armies of Hydra',
  attack: 4,
  vp: 3,
  team: 'hydra',
};

export const HYDRA_VIPER: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_viper',
  name: 'Viper',
  attack: 5,
  vp: 3,
  team: 'hydra',
  text: 'Ambush: Each player gains a Wound.',
  ambush: [{ kind: 'gain_wound' }],
};

export const HYDRA_SUPREME: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_supreme',
  name: 'Supreme Hydra',
  attack: 6,
  vp: 3,
  team: 'hydra',
};

export const HYDRA_GROUP = {
  groupId: 'hydra',
  team: 'hydra' as const,
  cards: [
    { def: HYDRA_KIDNAPPERS,      copies: 3 },
    { def: HYDRA_ENDLESS_ARMIES,  copies: 3 },
    { def: HYDRA_VIPER,           copies: 1 },
    { def: HYDRA_SUPREME,         copies: 1 },
  ],
};
