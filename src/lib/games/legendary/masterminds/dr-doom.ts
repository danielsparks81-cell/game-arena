import type { MastermindCardDef, TacticCardDef } from '../types';

// DR. DOOM — ruler of Latveria. Always Leads: Doombot Legion.
// Attack 9. VP 5. Hits 4.
// Master Strike: Each player with exactly 6 cards in hand must put 2 cards
//   from their hand on top of their deck.

export const DR_DOOM_TACTIC_1: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_dr_doom_tactic_1',
  name: "Monarch's Decree",
  mastermindId: 'mm_dr_doom',
  vp: 5,
  text: 'Fight: Choose one — each other player draws a card, or each other player discards a card.',
  fightSelf: [{ kind: 'choose_others_draw_or_discard' }],
};

export const DR_DOOM_TACTIC_2: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_dr_doom_tactic_2',
  name: 'Dark Technology',
  mastermindId: 'mm_dr_doom',
  vp: 5,
  text: 'Fight: You may recruit a [tech] or [ranged] Hero from the HQ for free.',
  fightSelf: [{ kind: 'free_recruit_tech_or_ranged_from_hq' }],
};

export const DR_DOOM_TACTIC_3: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_dr_doom_tactic_3',
  name: 'Treasures of Latveria',
  mastermindId: 'mm_dr_doom',
  vp: 5,
  text: 'Fight: When you draw a new hand of cards at the end of this turn, draw three extra cards.',
  fightSelf: [{ kind: 'extra_hand_cards', amount: 3 }],
};

export const DR_DOOM_TACTIC_4: TacticCardDef = {
  kind: 'tactic',
  cardId: 'mm_dr_doom_tactic_4',
  name: 'Secrets of Time Travel',
  mastermindId: 'mm_dr_doom',
  vp: 5,
  text: 'Fight: Take another turn after this one.',
  fightSelf: [{ kind: 'extra_turn' }],
};

export const DR_DOOM_TACTICS = [
  DR_DOOM_TACTIC_1,
  DR_DOOM_TACTIC_2,
  DR_DOOM_TACTIC_3,
  DR_DOOM_TACTIC_4,
] as const;

export const DR_DOOM: MastermindCardDef = {
  kind: 'mastermind',
  cardId: 'mm_dr_doom',
  name: 'Dr. Doom',
  attack: 9,
  vp: 5,
  alwaysLeads: 'doombot-legion',
  hits: 4,
  tacticIds: DR_DOOM_TACTICS.map(t => t.cardId),
  text: 'Master Strike: Each player with exactly 6 cards in hand reveals a Hero or puts 2 cards from their hand on top of their deck.',
  strike: [{ kind: 'doom_master_strike' }],
};
