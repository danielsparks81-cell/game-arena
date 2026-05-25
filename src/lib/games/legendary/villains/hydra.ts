import type { VillainCardDef } from '../types';

// HYDRA — villain group. 8 cards total.
// Composition:
//   3× Hydra Kidnappers     (fight: gain a S.H.I.E.L.D. Officer)
//   3× Endless Armies       (fight: reveal top 2 villain deck cards)
//   1× Viper                (ambush/fight/escape: players without HYDRA VP gain Wound)
//   1× Supreme HYDRA        (vp 3* + 3 per other HYDRA villain in VP)

export const HYDRA_KIDNAPPERS: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_kidnappers',
  name: 'Hydra Kidnappers',
  attack: 3,
  vp: 1,
  team: 'hydra',
  fight: [{ kind: 'gain_card_to_hand', cardId: 'shield_officer', may: true }],
  text: 'Fight: You may gain a SHIELD officer.',
};

export const HYDRA_ENDLESS_ARMIES: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_endless_armies',
  name: 'Endless Armies of Hydra',
  attack: 4,
  vp: 3,
  team: 'hydra',
  fight: [{ kind: 'villain_deck_reveal_top', amount: 2 }],
  text: 'Fight: Play the top two cards of the Villain deck.',
};

export const HYDRA_VIPER: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_viper',
  name: 'Viper',
  attack: 5,
  vp: 3,
  team: 'hydra',
  fight:  [{ kind: 'each_player_without_hydra_vp_gains_wound' }],
  escape: [{ kind: 'each_player_without_hydra_vp_gains_wound' }],
  text: 'Fight: Each player without another HYDRA Villain in their Victory Pile gains a Wound.\nEscape: Same effect.',
};

export const HYDRA_SUPREME: VillainCardDef = {
  kind: 'villain',
  cardId: 'hydra_supreme',
  name: 'Supreme HYDRA',
  attack: 6,
  vp: 3,
  team: 'hydra',
  vpScale: { team: 'hydra', amount: 3 },
  text: 'Supreme HYDRA is worth +3[vp] for each other HYDRA Villain in your Victory Pile.',
};

export const HYDRA_GROUP = {
  groupId: 'hydra',
  team: 'hydra' as const,
  cards: [
    { def: HYDRA_KIDNAPPERS,     copies: 3 },
    { def: HYDRA_ENDLESS_ARMIES, copies: 3 },
    { def: HYDRA_VIPER,          copies: 1 },
    { def: HYDRA_SUPREME,        copies: 1 },
  ],
};
