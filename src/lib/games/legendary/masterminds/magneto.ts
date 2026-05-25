import type { MastermindCardDef, TacticCardDef } from '../types';

export const MAGNETO_TACTIC_1: TacticCardDef = {
  kind: 'tactic', cardId: 'mm_magneto_tactic_1', name: "Xavier's Nemesis",
  mastermindId: 'mm_magneto', vp: 5,
  text: 'Fight: For each of your [x-men] Heroes, rescue a Bystander.',
  fightSelf: [{ kind: 'rescue_bystander_per_xmen_played' }],
};
export const MAGNETO_TACTIC_2: TacticCardDef = {
  kind: 'tactic', cardId: 'mm_magneto_tactic_2', name: 'Bitter Captor',
  mastermindId: 'mm_magneto', vp: 5,
  text: 'Fight: Recruit an [x-men] Hero from the HQ for free.',
  fightSelf: [{ kind: 'free_recruit_xmen_from_hq_effect' }],
};
export const MAGNETO_TACTIC_3: TacticCardDef = {
  kind: 'tactic', cardId: 'mm_magneto_tactic_3', name: 'Electromagnetic Bubble',
  mastermindId: 'mm_magneto', vp: 5,
  text: 'Fight: Choose one of your [x-men] Heroes. When you draw a new hand at end of this turn, add that Hero as a 7th card.',
  fightSelf: [{ kind: 'em_bubble' }],
};
export const MAGNETO_TACTIC_4: TacticCardDef = {
  kind: 'tactic', cardId: 'mm_magneto_tactic_4', name: 'Crushing Shockwave',
  mastermindId: 'mm_magneto', vp: 5,
  text: 'Fight: Each other player reveals an [x-men] Hero or gains 2 Wounds.',
  fightOthers: [{ kind: 'reveal_xmen_or_gain_wounds', amount: 2 }],
};
export const MAGNETO_TACTICS = [MAGNETO_TACTIC_1, MAGNETO_TACTIC_2, MAGNETO_TACTIC_3, MAGNETO_TACTIC_4] as const;
export const MAGNETO: MastermindCardDef = {
  kind: 'mastermind', cardId: 'mm_magneto', name: 'Magneto', attack: 8, vp: 5,
  alwaysLeads: 'brotherhood', hits: 4,
  tacticIds: MAGNETO_TACTICS.map(t => t.cardId),
  text: 'Master Strike: Each player reveals an [x-men] Hero or discards down to four cards.',
  strike: [{ kind: 'magneto_master_strike' }],
};
