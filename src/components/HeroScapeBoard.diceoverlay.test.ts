import { describe, it, expect } from 'vitest';
import { splitBreakdown } from './HeroScapeBoard';

/**
 * The dice-roll overlay shows players which dice are PRINTED (base) vs gained from height / auras /
 * glyphs (bonus). It derives that purely by parsing the combined attack→defense breakdown the engine
 * already produces (buildAttackBreakdown = [...attackBreakdown, ...defenseBreakdown]). These tests
 * pin that contract: if the engine ever changes the "Attack N printed" / "Defense N printed" wording,
 * or the attack-before-defense ordering, the parse breaks here instead of silently mislabelling dice.
 */
describe('splitBreakdown — base vs bonus dice in the roll overlay', () => {
  it('splits a normal attack with an attacker height bonus', () => {
    const r = splitBreakdown(['Attack 3 printed', '+1 height', 'Defense 4 printed']);
    expect(r).toEqual({ atkBase: 3, atkBonus: ['+1 height'], defBase: 4, defBonus: [] });
  });

  it('assigns bonuses to the defense section once the Defense line is seen', () => {
    const r = splitBreakdown(['Attack 2 printed', 'Defense 3 printed', '+1 height', '+1 Thorgrim aura']);
    expect(r).toEqual({
      atkBase: 2,
      atkBonus: [],
      defBase: 3,
      defBonus: ['+1 height', '+1 Thorgrim aura'],
    });
  });

  it('keeps attack-side bonuses with the attack even when defense also has bonuses', () => {
    const r = splitBreakdown([
      'Attack 3 printed',
      '+1 height',
      '+1 Finn aura',
      'Defense 4 printed',
      '+1 Raelin aura',
    ]);
    expect(r.atkBase).toBe(3);
    expect(r.atkBonus).toEqual(['+1 height', '+1 Finn aura']);
    expect(r.defBase).toBe(4);
    expect(r.defBonus).toEqual(['+1 Raelin aura']);
  });

  it('captures a negative modifier as a bonus term (sign preserved)', () => {
    const r = splitBreakdown(['Attack 3 printed', '-1 Attack Spirit', 'Defense 4 printed']);
    expect(r.atkBonus).toEqual(['-1 Attack Spirit']);
  });

  it('returns no base/bonus for special attacks (no "printed" line)', () => {
    const r = splitBreakdown(['Fire Line Special Attack', 'Attack 4 (special — no height / aura)']);
    expect(r).toEqual({ atkBase: 0, atkBonus: [], defBase: 0, defBonus: [] });
  });

  it('is safe on an undefined breakdown', () => {
    expect(splitBreakdown(undefined)).toEqual({ atkBase: 0, atkBonus: [], defBase: 0, defBonus: [] });
  });
});
