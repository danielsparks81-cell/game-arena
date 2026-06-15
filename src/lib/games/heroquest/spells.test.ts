import { describe, it, expect, afterEach, vi } from 'vitest';
import { initialState, addPlayer, applyAction } from './engine';
import { SPELLS } from './content';
import type { HQState, Monster, Spell } from './types';

// ============================================================================
// HeroQuest spell-effect tests. Covers the seven spells that gained real
// effects (Genie, Tempest, Swift Wind, Veil of Mist, Courage, Pass Through
// Rock, Rock Skin) plus their combat/movement integration. Dice rolls are made
// deterministic by stubbing Math.random where a spell rolls dice.
// ============================================================================

function unwrap(r: ReturnType<typeof applyAction>): HQState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** A started 1-player quest: 'p1' owns all four heroes, phase === 'heroes'.
 *  start_game opens a pre-quest spell draft (Wizard picks a school, then the Elf);
 *  p1 owns every hero, so we resolve it here to reach the heroes' turn. The chosen
 *  schools are irrelevant — these tests arm heroes with explicit spells. */
function startedGame(): HQState {
  let s = initialState();
  s = addPlayer(s, 'p1', 'Player One', 0);
  s = unwrap(applyAction(s, 'p1', { kind: 'start_game' }));
  if (s.phase === 'spell_draft') s = unwrap(applyAction(s, 'p1', { kind: 'pick_spell_school', school: 'air' }));
  if (s.phase === 'spell_draft') s = unwrap(applyAction(s, 'p1', { kind: 'pick_spell_school', school: 'water' }));
  return s;
}

function spell(id: string): Spell {
  const sp = SPELLS.find(x => x.id === id);
  if (!sp) throw new Error(`no spell ${id}`);
  return { ...sp };
}

/** Give the active hero exactly one spell so casts are unambiguous. */
function armActiveHeroWith(s: HQState, spellId: string): HQState {
  const next: HQState = JSON.parse(JSON.stringify(s));
  const h = next.heroes[next.turnIndex];
  h.spells = [spell(spellId)];
  h.spellsCast = [];
  h.hasActed = false;
  return next;
}

/** Paint a small revealed floor patch so LOS/movement have clean ground. */
function paintFloor(s: HQState, cells: { x: number; y: number }[]): void {
  for (const c of cells) {
    s.tiles[c.y][c.x] = { kind: 'floor', region: 'room_test', revealed: true };
  }
}

function makeMonster(id: string, at: { x: number; y: number }, over: Partial<Monster> = {}): Monster {
  return {
    id, kind: 'goblin', at, body: 1, bodyMax: 1,
    attack: 2, defense: 1, move: 6, roomId: 'room_test', ...over,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('heroquest spells: Tempest', () => {
  it('makes the CHOSEN monster miss its next turn (needs line of sight)', () => {
    const s = armActiveHeroWith(startedGame(), 'tempest');
    const h = s.heroes[s.turnIndex];
    h.at = { x: 5, y: 5 };
    paintFloor(s, [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }]); // clear sight east
    s.monsters = [
      makeMonster('m1', { x: 6, y: 5 }), // in sight — the target
      makeMonster('m3', { x: 9, y: 9 }), // not targeted — unaffected
    ];
    const out = unwrap(applyAction(s, 'p1', { kind: 'cast_spell', spellId: 'tempest', targetMonsterId: 'm1' }));
    expect(out.monsters.find(m => m.id === 'm1')!.stunned).toBe(true);
    expect(out.monsters.find(m => m.id === 'm3')!.stunned).toBeFalsy();
  });
});

describe('heroquest spells: Genie', () => {
  it('strikes a visible monster for up to 4 BP and can destroy it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // every die → skull
    const s = armActiveHeroWith(startedGame(), 'genie');
    const h = s.heroes[s.turnIndex];
    h.at = { x: 2, y: 2 };
    paintFloor(s, [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }]);
    s.monsters = [makeMonster('g1', { x: 4, y: 2 }, { kind: 'orc', body: 1, bodyMax: 1, defense: 2 })];
    const out = unwrap(applyAction(s, 'p1', { kind: 'cast_spell', spellId: 'genie', targetMonsterId: 'g1' }));
    expect(out.monsters.find(m => m.id === 'g1')).toBeUndefined(); // destroyed
  });
});

describe('heroquest spells: Swift Wind', () => {
  it('doubles a hero who has already rolled movement', () => {
    const s = armActiveHeroWith(startedGame(), 'swift_wind');
    const h = s.heroes[s.turnIndex];
    h.hasRolled = true;
    h.moveRolled = 5;
    h.moveLeft = 5;
    const out = unwrap(applyAction(s, 'p1', { kind: 'cast_spell', spellId: 'swift_wind', targetHeroIdx: s.turnIndex }));
    expect(out.heroes[out.turnIndex].moveLeft).toBe(10);
  });
});

describe('heroquest spells: Veil of Mist', () => {
  it('lets the hero move THROUGH monster-occupied squares (no bonus movement)', () => {
    const s = armActiveHeroWith(startedGame(), 'veil_of_mist');
    const h = s.heroes[s.turnIndex];
    h.hasRolled = true;
    h.moveRolled = 4;
    h.moveLeft = 4;
    const out = unwrap(applyAction(s, 'p1', { kind: 'cast_spell', spellId: 'veil_of_mist', targetHeroIdx: s.turnIndex }));
    const t = out.heroes[out.turnIndex];
    expect(t.phaseMonsters).toBe(true);
    expect(t.moveLeft).toBe(4); // unchanged — the spell phases past monsters, it doesn't add movement
  });
});

describe('heroquest spells: Courage', () => {
  it('grants +2 attack dice on the next attack and spends the caster’s action', () => {
    // Cast on a TEAM-MATE so we can watch the buff apply to THEIR attack (the
    // caster's own action is spent by the cast). Courage = +2 dice only; the
    // reworked spell no longer grants a bonus attack.
    vi.spyOn(Math, 'random').mockReturnValue(0); // all skulls
    const s = armActiveHeroWith(startedGame(), 'courage');
    const ally = (s.turnIndex + 1) % s.heroes.length;
    const out = unwrap(applyAction(s, 'p1', { kind: 'cast_spell', spellId: 'courage', targetHeroIdx: ally }));
    expect(out.heroes[out.turnIndex].hasActed).toBe(true); // the cast itself was the action
    expect(out.heroes[ally].attackBonus).toBe(2);          // +2 dice buff sits on the target
    expect(out.heroes[ally].extraAttack).toBeFalsy();      // no bonus attack any more
  });
});

describe('heroquest spells: Rock Skin', () => {
  it('grants +1 defense that survives the turn end (breaks only when the hero takes damage)', () => {
    let s = armActiveHeroWith(startedGame(), 'rock_skin');
    s.monsters = []; // no monsters → Zargon turns are no-ops
    const caster = s.turnIndex; // hero 0
    s = unwrap(applyAction(s, 'p1', { kind: 'cast_spell', spellId: 'rock_skin', targetHeroIdx: caster }));
    expect(s.heroes[caster].defenseBonus).toBe(1);

    // Ending the caster's turn must NOT strip the buff — it persists until the hero
    // actually suffers a Body Point of damage (the reworked rule, per the card text).
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect(s.heroes[caster].defenseBonus).toBe(1);
  });
});

describe('heroquest spells: Pass Through Rock', () => {
  it('lets the hero move through a wall that would otherwise block', () => {
    const base = armActiveHeroWith(startedGame(), 'pass_rock');
    const h0 = base.heroes[base.turnIndex];
    h0.at = { x: 2, y: 2 };
    paintFloor(base, [{ x: 2, y: 2 }]);
    base.tiles[2][3] = { kind: 'wall', region: 'room_test', revealed: true };

    // Without the spell: stepping into the wall is rejected.
    const blocked = (() => {
      const s: HQState = JSON.parse(JSON.stringify(base));
      const h = s.heroes[s.turnIndex];
      h.hasRolled = true; h.moveLeft = 5;
      return applyAction(s, 'p1', { kind: 'move_to', at: { x: 3, y: 2 } });
    })();
    expect(blocked.ok).toBe(false);

    // With Pass Through Rock: the hero phases into the wall square.
    let s = unwrap(applyAction(base, 'p1', { kind: 'cast_spell', spellId: 'pass_rock', targetHeroIdx: base.turnIndex }));
    const h = s.heroes[s.turnIndex];
    h.hasRolled = true; h.moveLeft = 5;
    s = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 3, y: 2 } }));
    expect(s.heroes[s.turnIndex].at).toEqual({ x: 3, y: 2 });
  });
});

describe('heroquest spells: casting rules', () => {
  it('rejects casting the same spell twice and casting after acting', () => {
    const s = armActiveHeroWith(startedGame(), 'rock_skin');
    const once = unwrap(applyAction(s, 'p1', { kind: 'cast_spell', spellId: 'rock_skin', targetHeroIdx: s.turnIndex }));
    // Already acted this turn → second cast rejected.
    const twice = applyAction(once, 'p1', { kind: 'cast_spell', spellId: 'rock_skin', targetHeroIdx: once.turnIndex });
    expect(twice.ok).toBe(false);
  });
});
