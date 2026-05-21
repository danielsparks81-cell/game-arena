import type { MastermindCardDef } from '../types';

// RED SKULL — boss of HYDRA. 4 hits to defeat. Master Strike gives every
// player a Wound. Always Leads HYDRA → the HYDRA villain group is added
// to the Villain Deck at setup whenever Red Skull is picked.

export const RED_SKULL: MastermindCardDef = {
  kind: 'mastermind',
  cardId: 'mm_red_skull',
  name: 'Red Skull',
  attack: 9,
  vp: 6,
  alwaysLeads: 'hydra',
  hits: 4,
  text: 'Always Leads: HYDRA. Master Strike: Each player gains a Wound.',
  strike: [{ kind: 'gain_wound' }],
};
