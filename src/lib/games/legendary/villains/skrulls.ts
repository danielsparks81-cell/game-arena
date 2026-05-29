import type { VillainCardDef } from '../types';

// SKRULLS — villain group from the Secret Invasion scheme.
// Composition: 3× Skrull Shapeshifters, 3× Super-Skrull, 1× Skrull Queen
// Veranke, 1× Paibok the Power Skrull (8 total).
//
// Several cards have variable [strike] equal to an attached Hero's [cost].
// This is fully wired: the attach-hero mechanic uses a per-villain-instance
// attachment slot (state.cityAttachedHeroes, mirror of cityBystanders).
// On Ambush the Shapeshifters / Veranke pull a Hero from the HQ under
// themselves; doFightCity then uses that Hero's [cost] as the strike, and the
// Fight effect (skrull_gain_attached_hero) gives the Hero to the defeating
// player. The printed `attack: 0` is only a fallback for when the HQ was
// empty at Ambush time (no Hero to attach → the "*" with no value).

export const SKRULL_SHAPESHIFTERS: VillainCardDef = {
  kind: 'villain',
  cardId: 'skrull_shapeshifters',
  name: 'Skrull Shapeshifters',
  // Printed strike is variable. When a Hero is attached during Ambush,
  // doFightCity uses that Hero's [cost] instead of this fallback value.
  // The fallback (0) only applies when the HQ was empty at Ambush time,
  // matching the "* with no Hero attached" interpretation.
  attack: 0,
  variableStrike: true,
  vp: 2,
  team: 'skrulls',
  ambush: [{ kind: 'skrull_attach_hero_from_hq', mode: 'rightmost' }],
  fight:  [{ kind: 'skrull_gain_attached_hero' }],
  text: 'Ambush: Put the rightmost Hero from the HQ under this Villain. The Villain\'s [strike] is equal to that Hero\'s [cost].\nFight: Gain that Hero.',
};

export const SUPER_SKRULL: VillainCardDef = {
  kind: 'villain',
  cardId: 'super_skrull',
  name: 'Super-Skrull',
  attack: 4,
  vp: 2,
  team: 'skrulls',
  fight: [{ kind: 'each_player_pending_ko_hero' }],
  text: 'Fight: Each player KOs one of their Heroes.',
};

export const SKRULL_QUEEN_VERANKE: VillainCardDef = {
  kind: 'villain',
  cardId: 'skrull_queen_veranke',
  name: 'Skrull Queen Veranke',
  // Variable strike — see Shapeshifters above. Fallback 0 when HQ is empty.
  attack: 0,
  variableStrike: true,
  vp: 4,
  team: 'skrulls',
  ambush: [{ kind: 'skrull_attach_hero_from_hq', mode: 'highest_cost' }],
  fight:  [{ kind: 'skrull_gain_attached_hero' }],
  text: 'Ambush: Put the highest-cost Hero from the HQ under this Villain. This Villain\'s [strike] is equal to that Hero\'s [cost].\nFight: Gain that Hero.',
};

export const PAIBOK_THE_POWER_SKRULL: VillainCardDef = {
  kind: 'villain',
  cardId: 'paibok_the_power_skrull',
  name: 'Paibok the Power Skrull',
  attack: 8,
  vp: 3,
  team: 'skrulls',
  fight: [{ kind: 'each_player_gains_hq_hero' }],
  text: 'Fight: Choose a Hero in the HQ for each player. Each player gains that Hero.',
};

export const SKRULLS_GROUP = {
  groupId: 'skrulls',
  team: 'skrulls' as const,
  cards: [
    { def: SKRULL_SHAPESHIFTERS,    copies: 3 },
    { def: SUPER_SKRULL,            copies: 3 },
    { def: SKRULL_QUEEN_VERANKE,    copies: 1 },
    { def: PAIBOK_THE_POWER_SKRULL, copies: 1 },
  ],
};
