import { describe, it, expect } from 'vitest';
import { FIXED_CATEGORY_POINTS, scoreFor, type Category } from './yahtzee';

describe('Yahtzee — fixed-payout categories', () => {
  // Full House / the straights / Yahtzee pay a SET value no matter which faces qualify. The scorecard
  // now lists that value next to the category name (FIXED_CATEGORY_POINTS), so it MUST equal what
  // scoreFor actually awards — otherwise the label would promise points the engine doesn't grant.
  const qualifying: Record<string, number[]> = {
    fullHouse: [2, 2, 2, 5, 5],     // three + a pair → always 25
    smallStraight: [1, 2, 3, 4, 6], // any four-in-a-row → 30
    largeStraight: [2, 3, 4, 5, 6], // five-in-a-row → 40
    yahtzee: [3, 3, 3, 3, 3],       // five of a kind → 50
  };
  for (const [cat, fixed] of Object.entries(FIXED_CATEGORY_POINTS)) {
    it(`${cat} pays a fixed ${fixed}, matching scoreFor`, () => {
      expect(scoreFor(qualifying[cat], cat as Category)).toBe(fixed);
    });
  }
});
