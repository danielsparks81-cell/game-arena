// Long Shot — per-horse abilities (Phase 4).
// Each horse number (1-8) has a pool of 4 candidate abilities. When `startRace`
// runs, one ability is selected at random for each horse and stored in
// `state.assignedAbilities`. Abilities are dormant unless the horse is owned;
// the player who owns the horse is the one whose actions trigger the ability.
//
// This file is currently DATA ONLY — the runtime effects are wired up in
// follow-up commits to longshot.ts (one trigger family at a time).
//
// NOTE: This module is intentionally self-contained — it does NOT import from
// `./longshot` to avoid a circular dependency (longshot.ts imports `assignAbilities`
// from here). The horse count is hard-coded; it has been 8 since Phase 0.

const NUM_HORSES = 8;

/**
 * Tag describing WHEN an ability fires. The engine groups abilities by trigger so
 * we only run the relevant hooks at each integration point.
 */
export type AbilityTrigger =
  | 'scoring'        // end-of-race score adjustment
  | 'die-roll'       // when the physical horse die shows a specific number
  | 'on-bought'      // when this specific horse is purchased
  | 'on-bet'         // when the owner places a Bet (including free bets unless noted)
  | 'on-jersey'      // when the owner takes the Jersey action
  | 'on-concession'  // modifies validity of the owner's Concession action
  | 'on-row-or-col'  // when the owner completes any row OR column
  | 'on-row'         // when the owner completes a horizontal row
  | 'on-col'         // when the owner completes a vertical column
  | 'on-bonus-move'  // when the owner claims a "move a horse" concession bonus
  | 'on-bonus-back'  // when the owner claims a "move back" concession bonus
  | 'on-bonus-cash'  // when the owner claims a $7 cash concession bonus
  | 'on-bonus-bet'   // when the owner claims a $3 free-bet concession bonus
  | 'on-free-horse'  // when the owner claims horse via the Free Horse bonus
  | 'on-jockey-set'; // when the owner completes a jockey set for the first time

export type LSAbility = {
  id: string;
  horseNum: number;       // 1..8
  name: string;
  description: string;    // shown in tooltip / "Horse abilities" panel
  trigger: AbilityTrigger;
};

/**
 * The full ability pool. Exactly 4 entries per horse number (1-8) = 32 total.
 * `startRace` picks one uniformly at random for each horse.
 */
export const ABILITY_POOL: LSAbility[] = [
  // ============================== HORSE 1 ==============================
  { id: 'h1_golden_corral',     horseNum: 1, name: 'Golden Corral',
    description: 'At scoring: if you own 3 or more horses, gain $10.',
    trigger: 'scoring' },
  { id: 'h1_out_of_alignment',  horseNum: 1, name: 'Out of Alignment',
    description: 'When you complete a row or column, gain $1.',
    trigger: 'on-row-or-col' },
  { id: 'h1_chain_reaction',    horseNum: 1, name: 'Chain Reaction',
    description: 'When you complete a vertical column, mark any concession.',
    trigger: 'on-col' },
  { id: 'h1_strung_along',      horseNum: 1, name: 'Strung Along',
    description: 'Alternate bet option: place a $1 bet and advance that horse +1.',
    trigger: 'on-bet' },

  // ============================== HORSE 2 ==============================
  { id: 'h2_pie_in_the_sky',    horseNum: 2, name: 'Pie In The Sky',
    description: 'At scoring: if this does not podium, lose $10.',
    trigger: 'scoring' },
  { id: 'h2_too_lucky',         horseNum: 2, name: 'Too Lucky',
    description: 'When the physical die shows 2, you gain $2.',
    trigger: 'die-roll' },
  { id: 'h2_silver_spoon',      horseNum: 2, name: 'Silver Spoon',
    description: 'Your $7 cash concession bonuses pay $9 instead.',
    trigger: 'on-bonus-cash' },
  { id: 'h2_half_off_sale',     horseNum: 2, name: 'Half Off Sale',
    description: 'When horse 2 is bought, the buyer may immediately buy another market horse at half price.',
    trigger: 'on-bought' },

  // ============================== HORSE 3 ==============================
  { id: 'h3_receding_mare',     horseNum: 3, name: 'Receding Mare Line',
    description: 'Your move-back concession bonuses send each chosen horse 1 extra space back.',
    trigger: 'on-bonus-back' },
  { id: 'h3_scatter_shot',      horseNum: 3, name: 'Scatter Shot',
    description: 'Concession: may mark a rolled±1 cell instead (no wrap; can’t combine with Wild).',
    trigger: 'on-concession' },
  { id: 'h3_pay_it_forward',    horseNum: 3, name: 'Pay it Forward',
    description: 'A $3 bet shoves every horse stacked on the target +1 (no cross-finish).',
    trigger: 'on-bet' },
  { id: 'h3_loosey_goosey',     horseNum: 3, name: 'Loosey Goosey',
    description: 'Horse 3 bought: refund up to 2 used Wilds.',
    trigger: 'on-bought' },

  // ============================== HORSE 4 ==============================
  { id: 'h4_early_bird',        horseNum: 4, name: 'Early Bird Special',
    description: 'Bet: free if you have $0 already on the target horse (still pays out).',
    trigger: 'on-bet' },
  { id: 'h4_three_four_five',   horseNum: 4, name: 'Three Four Five',
    description: 'Your $3 free-bet bonuses become $5 free bets.',
    trigger: 'on-bonus-bet' },
  { id: 'h4_dance_card',        horseNum: 4, name: 'Dance Card',
    description: 'Scoring: every owner gains $4 per owned horse marked on horse 4’s bar (pre-printed + jersey).',
    trigger: 'scoring' },
  { id: 'h4_double_crosser',    horseNum: 4, name: 'Double Crosser',
    description: 'Jersey: mark TWO different unmarked horses on the bar instead of one (still 1 jersey).',
    trigger: 'on-jersey' },

  // ============================== HORSE 5 ==============================
  { id: 'h5_five_leaf',         horseNum: 5, name: 'Five Leaf Clover',
    description: 'When you complete a horizontal row, refund 1 used Wild.',
    trigger: 'on-row' },
  { id: 'h5_charley_horse',     horseNum: 5, name: 'Charley Horse',
    description: 'When you complete a horizontal row, move any horse back 1 (cap at 0).',
    trigger: 'on-row' },
  { id: 'h5_laundry_day',       horseNum: 5, name: 'Laundry Day',
    description: 'At scoring, if you have 0 jockey sets, gain $10.',
    trigger: 'scoring' },
  { id: 'h5_fancy_hat',         horseNum: 5, name: 'Fancy Hat',
    description: 'Any bet (paid or free) on a horse you’ve helmeted → +$1.',
    trigger: 'on-bet' },

  // ============================== HORSE 6 ==============================
  { id: 'h6_partner_in_crime',  horseNum: 6, name: 'Partner in Crime',
    description: 'Horse 6 bought: horse 6 +2 and another unfinished horse +2 (capped before finish).',
    trigger: 'on-bought' },
  { id: 'h6_miracle_worker',    horseNum: 6, name: 'Miracle Worker',
    description: 'Horse 6 bought: pick ONE — mark any concession cell, helmet, or jersey.',
    trigger: 'on-bought' },
  { id: 'h6_lone_ranger',       horseNum: 6, name: 'Lone Ranger',
    description: 'Scoring: +$2 per horse with exactly one of {helmet, jersey} (not both).',
    trigger: 'scoring' },
  { id: 'h6_equestrian_inception', horseNum: 6, name: 'Equestrian Inception',
    description: 'Take horse 6 via the Free Horse bonus → buyer gains $6.',
    trigger: 'on-free-horse' },

  // ============================== HORSE 7 ==============================
  { id: 'h7_fair_play',         horseNum: 7, name: 'Fair Play',
    description: 'Die rolls 7: pick any non-lead (not tied) horse, +2 (capped before finish).',
    trigger: 'die-roll' },
  { id: 'h7_bread_line',        horseNum: 7, name: 'Bread Line',
    description: 'Scoring: +$3 per filled horizontal row in your concessions.',
    trigger: 'scoring' },
  { id: 'h7_sticky_fingers',    horseNum: 7, name: 'Sticky Fingers',
    description: 'Jersey: steal up to $2 from the card’s owner (skip self/unowned; no negatives).',
    trigger: 'on-jersey' },
  { id: 'h7_inventory_check',   horseNum: 7, name: 'Inventory Check',
    description: 'Horse 7 bought: mark a jersey on 2 different unmarked cards (no bar pick).',
    trigger: 'on-bought' },

  // ============================== HORSE 8 ==============================
  { id: 'h8_donut_dollie',      horseNum: 8, name: 'Donut Dollie',
    description: 'Your move-horse bonuses move each affected horse +1 in the same direction.',
    trigger: 'on-bonus-move' },
  { id: 'h8_magic_hate_ball',   horseNum: 8, name: 'Magic Hate Ball',
    description: 'Die rolls 8: every other player loses $2 (cap $0; money vanishes).',
    trigger: 'die-roll' },
  { id: 'h8_product_placement', horseNum: 8, name: 'Product Placement',
    description: 'First time you complete a jockey set on a horse, place a free $2 bet on it.',
    trigger: 'on-jockey-set' },
  { id: 'h8_great_appreciation', horseNum: 8, name: 'Great Appreciation',
    description: 'Horse 8 podiums: all three podium purses pay +$10 each.',
    trigger: 'scoring' },
];

/** Map horseNum (1..8) → array of ability ids in its pool. */
export const ABILITY_POOLS_BY_HORSE: Record<number, string[]> = (() => {
  const out: Record<number, string[]> = {};
  for (let h = 1; h <= NUM_HORSES; h++) out[h] = [];
  for (const a of ABILITY_POOL) out[a.horseNum].push(a.id);
  return out;
})();

/** Lookup by ability id. */
export const ABILITY_BY_ID: Record<string, LSAbility> = (() => {
  const out: Record<string, LSAbility> = {};
  for (const a of ABILITY_POOL) out[a.id] = a;
  return out;
})();

/** Pick one ability per horse uniformly at random. Returns horseNum → abilityId. */
export function assignAbilities(): Record<number, string> {
  const out: Record<number, string> = {};
  for (let h = 1; h <= NUM_HORSES; h++) {
    const pool = ABILITY_POOLS_BY_HORSE[h];
    out[h] = pool[Math.floor(Math.random() * pool.length)];
  }
  return out;
}
