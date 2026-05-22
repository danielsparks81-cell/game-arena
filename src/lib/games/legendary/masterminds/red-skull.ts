import type { MastermindCardDef, TacticCardDef } from '../types';

// RED SKULL — boss of HYDRA. Defeated when all 4 Tactics are taken.
// Master Strike gives every player a Wound.
// Always Leads HYDRA → HYDRA villain group is seeded at setup.
//
// Tactic Fight effects target EACH OTHER PLAYER (punishments, not bonuses).
// In solo play all fightOthers effects are no-ops.

export const RED_SKULL_TACTIC_1: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_red_skull_tactic_1',
  name: 'Head of HYDRA',
  mastermindId: 'mm_red_skull',
  vp: 4,
  text: 'Fight: Each other player gains a Wound.',
  fightOthers: [{ kind: 'gain_wound' }],
};

export const RED_SKULL_TACTIC_2: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_red_skull_tactic_2',
  name: 'Master of Organized Crime',
  mastermindId: 'mm_red_skull',
  vp: 4,
  text: 'Fight: Each other player discards a card.',
  fightOthers: [{ kind: 'discard_from_hand', up_to: 1 }],
};

export const RED_SKULL_TACTIC_3: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_red_skull_tactic_3',
  name: 'Cosmic Cube Wielder',
  mastermindId: 'mm_red_skull',
  vp: 4,
  text: "Fight: Each other player reveals the top card of their deck. If it's a Hero, KO it.",
  // TODO: implement 'ko_top_of_deck_if_hero' effect for each other player.
  fightOthers: [],
};

export const RED_SKULL_TACTIC_4: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_red_skull_tactic_4',
  name: 'Weapons Smuggler',
  mastermindId: 'mm_red_skull',
  vp: 4,
  text: "Fight: KO the Hero with the highest cost from each other player's hand.",
  // TODO: implement 'ko_highest_from_hand' effect for each other player.
  fightOthers: [],
};

export const RED_SKULL_TACTICS = [
  RED_SKULL_TACTIC_1,
  RED_SKULL_TACTIC_2,
  RED_SKULL_TACTIC_3,
  RED_SKULL_TACTIC_4,
] as const;

export const RED_SKULL: MastermindCardDef = {
  kind: 'mastermind',
  cardId: 'mm_red_skull',
  name: 'Red Skull',
  attack: 9,
  vp: 0, // VP comes from the Tactic cards, not the Mastermind card itself.
  alwaysLeads: 'hydra',
  hits: 4,
  tacticIds: RED_SKULL_TACTICS.map(t => t.cardId),
  text: 'Always Leads: HYDRA. Master Strike: Each player gains a Wound.',
  strike: [{ kind: 'gain_wound' }],
};
