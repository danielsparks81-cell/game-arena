import type { VillainCardDef } from '../types';

// MASTERS OF EVIL — villain group. 8 cards total.
// Composition:
//   2× Baron Zemo        (fight: rescue a bystander per Avengers hero you have)
//   2× Whirlwind         (fight: if fought on Rooftops or Bridge, KO two Heroes)
//   2× Ultron            (vp 2* per-[black]-hero among all cards; escape: reveal [black] or wound)
//   2× Melter            (fight: reveal each player's top deck card — active player KOs or returns each)

export const MASTERS_BARON_ZEMO: VillainCardDef = {
  kind: 'villain',
  cardId: 'masters_baron_zemo',
  name: 'Baron Zemo',
  attack: 6,
  vp: 4,
  team: 'masters-of-evil',
  fight: [{ kind: 'rescue_bystander_per_avengers_hero' }],
  text: 'Fight: For each of your [avengers] Heroes, rescue a Bystander.',
};

export const MASTERS_WHIRLWIND: VillainCardDef = {
  kind: 'villain',
  cardId: 'masters_whirlwind',
  name: 'Whirlwind',
  attack: 4,
  vp: 2,
  team: 'masters-of-evil',
  fight: [{ kind: 'ko_heroes_from_hand_if_at_location', locations: ['rooftops', 'bridge'], amount: 2 }],
  text: 'Fight: If you fight Whirlwind on the Rooftops or Bridge, KO two of your Heroes.',
};

export const MASTERS_ULTRON: VillainCardDef = {
  kind: 'villain',
  cardId: 'masters_ultron',
  name: 'Ultron',
  attack: 6,
  vp: 2,
  team: 'masters-of-evil',
  vpScaleClass: { cls: 'tech', among: 'all_cards', amount: 1 },
  escape: [{ kind: 'each_player_reveal_tech_hero_or_wound' }],
  text: 'Ultron is worth +1[vp] for each [tech] Hero you have among all your cards at the end of the game.\nEscape: Each player reveals a [tech] Hero or gains a Wound.',
};

export const MASTERS_MELTER: VillainCardDef = {
  kind: 'villain',
  cardId: 'masters_melter',
  name: 'Melter',
  attack: 5,
  vp: 3,
  team: 'masters-of-evil',
  fight: [{ kind: 'melter_reveal_top_each_player' }],
  text: 'Fight: Each player reveals the top card of their deck. For each card, you choose to KO it or put it back.',
};

export const MASTERS_OF_EVIL_GROUP = {
  groupId: 'masters-of-evil',
  team: 'masters-of-evil' as const,
  cards: [
    { def: MASTERS_BARON_ZEMO, copies: 2 },
    { def: MASTERS_WHIRLWIND,  copies: 2 },
    { def: MASTERS_ULTRON,     copies: 2 },
    { def: MASTERS_MELTER,     copies: 2 },
  ],
};
