import type { MastermindCardDef, TacticCardDef } from '../types';

// RED SKULL — boss of HYDRA. Defeated when all 4 Tactics are taken.
// Attack 7. Master Strike: Each player KOs a Hero from their hand.
// Always Leads HYDRA → HYDRA villain group is seeded at setup.
//
// All four Tactic "fightSelf" effects benefit the player who defeats them.

export const RED_SKULL_TACTIC_1: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_red_skull_tactic_1',
  name: 'Cosmic Cube Experiment',
  mastermindId: 'mm_red_skull',
  vp: 4,
  text: 'Fight: Look at the top three cards of your deck. KO one, discard one, and put one back on top.',
  fightSelf: [{ kind: 'look_top_three_ko_discard_return' }],
};

export const RED_SKULL_TACTIC_2: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_red_skull_tactic_2',
  name: 'HYDRA Rising',
  mastermindId: 'mm_red_skull',
  vp: 4,
  text: 'Fight: You get +4[star].',
  fightSelf: [{ kind: 'gain_recruit', amount: 4 }],
};

export const RED_SKULL_TACTIC_3: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_red_skull_tactic_3',
  name: 'Army of HYDRA',
  mastermindId: 'mm_red_skull',
  vp: 4,
  text: 'Fight: Draw two cards. Then draw another card for each Hydra Villain in your Victory Pile.',
  fightSelf: [
    { kind: 'draw', amount: 2 },
    { kind: 'draw_per_hydra_in_victory_pile' },
  ],
};

export const RED_SKULL_TACTIC_4: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_red_skull_tactic_4',
  name: 'Red Terror',
  mastermindId: 'mm_red_skull',
  vp: 4,
  text: 'Fight: You get +3[strike].',
  fightSelf: [{ kind: 'gain_attack', amount: 3 }],
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
  attack: 7,
  vp: 0, // VP comes from the Tactic cards, not the Mastermind card itself.
  alwaysLeads: 'hydra',
  hits: 4,
  tacticIds: RED_SKULL_TACTICS.map(t => t.cardId),
  text: 'Always Leads: HYDRA. Master Strike: Each player KOs a Hero from their hand.',
  strike: [{ kind: 'each_player_ko_hero_from_hand' }],
};
