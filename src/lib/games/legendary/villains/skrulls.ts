import type { VillainCardDef } from '../types';

// SKRULLS — villain group from the Secret Invasion scheme.
// Composition: 3× Skrull Shapeshifters, 3× Super-Skrull, 1× Skrull Queen
// Veranke, 1× Paibok the Power Skrull (8 total).
//
// Several cards have variable [strike] equal to an attached Hero's [cost].
// MVP implementation note: the "attach Hero from HQ to this Villain, strike
// scales with that Hero's cost, gain it on defeat" mechanic needs a new
// per-villain-instance attachment slot (mirror of cityBystanders). Until
// that's wired, the Shapeshifters / Veranke cards use placeholder fixed
// attack values matching their printed average, and the card text still
// describes the official rule so players know what should happen.

export const SKRULL_SHAPESHIFTERS: VillainCardDef = {
  kind: 'villain',
  cardId: 'skrull_shapeshifters',
  name: 'Skrull Shapeshifters',
  // Placeholder: official rule is [strike] equal to attached Hero's [cost].
  // Without the attach-hero mechanic, fall back to a fixed midrange value.
  attack: 3,
  vp: 2,
  team: 'skrulls',
  // ambush / fight: TODO — attach rightmost HQ Hero; gain it on defeat.
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
  // Placeholder: official rule is [strike] equal to highest-cost Hero's [cost].
  attack: 5,
  vp: 4,
  team: 'skrulls',
  // ambush / fight: TODO — attach highest-cost HQ Hero; gain it on defeat.
  text: 'Ambush: Put the highest-cost Hero from the HQ under this Villain. This Villain\'s [strike] is equal to that Hero\'s [cost].\nFight: Gain that Hero.',
};

export const PAIBOK_THE_POWER_SKRULL: VillainCardDef = {
  kind: 'villain',
  cardId: 'paibok_the_power_skrull',
  name: 'Paibok the Power Skrull',
  attack: 8,
  vp: 3,
  team: 'skrulls',
  // fight: TODO — active player chooses a Hero in the HQ for each player.
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
