import type { MastermindCardDef, TacticCardDef } from '../types';

export const LOKI_TACTIC_1: TacticCardDef = {
  kind: 'tactic', cardId: 'mm_loki_tactic_1', name: 'Vanishing Illusions',
  mastermindId: 'mm_loki', vp: 5,
  text: 'Fight: Each other player KOs a Villain from their Victory Pile.',
  fightOthers: [{ kind: 'ko_villain_from_vp' }],
};
export const LOKI_TACTIC_2: TacticCardDef = {
  kind: 'tactic', cardId: 'mm_loki_tactic_2', name: 'Whispers and Lies',
  mastermindId: 'mm_loki', vp: 5,
  text: 'Fight: Each other player KOs two Bystanders from their Victory Pile.',
  fightOthers: [{ kind: 'ko_bystanders_from_vp', count: 2 }],
};
export const LOKI_TACTIC_3: TacticCardDef = {
  kind: 'tactic', cardId: 'mm_loki_tactic_3', name: 'Cruel Ruler',
  mastermindId: 'mm_loki', vp: 5,
  text: 'Fight: Defeat a Villain in the City for free.',
  fightSelf: [{ kind: 'grant_fight_city_free' }],
};
export const LOKI_TACTIC_4: TacticCardDef = {
  kind: 'tactic', cardId: 'mm_loki_tactic_4', name: 'Maniacal Tyrant',
  mastermindId: 'mm_loki', vp: 5,
  text: 'Fight: KO up to four cards from your discard pile.',
  fightSelf: [{ kind: 'ko_up_to_from_discard', amount: 4 }],
};
export const LOKI_TACTICS = [LOKI_TACTIC_1, LOKI_TACTIC_2, LOKI_TACTIC_3, LOKI_TACTIC_4] as const;
export const LOKI: MastermindCardDef = {
  kind: 'mastermind', cardId: 'mm_loki', name: 'Loki', attack: 10, vp: 5,
  alwaysLeads: 'enemies-of-asgard', hits: 4,
  tacticIds: LOKI_TACTICS.map(t => t.cardId),
  text: 'Master Strike: Each player reveals a [strength] Hero or gains a Wound.',
  strike: [{ kind: 'loki_master_strike' }],
};
