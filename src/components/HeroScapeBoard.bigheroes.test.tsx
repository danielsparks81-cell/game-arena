// @vitest-environment jsdom
//
// UI-glue test for the Big-Hero special-power control panel (slice 8b). Closes
// the one gap the engine/fuzzer tests can't reach: that the board PANEL renders
// for the active Big Hero and that clicking each power's button dispatches the
// matching callback with the right args. Renders the real HeroScapeBoard with a
// crafted "playing" state (a Big Hero is the active card on my turn) and spies on
// the power callbacks — no browser, no Supabase, deterministic.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import HeroScapeBoard from './HeroScapeBoard';
import { initialState, addPlayer, applyAction, MAPS, neighborKeys, theDropHexes, legalDestinations } from '@/lib/games/heroscape';
import type { HSResult, HSState, OrderMarkerValue } from '@/lib/games/heroscape';

afterEach(cleanup);

const ATT = (r0: number, r1: number) => [[{ seat: 0, roll: r0 }, { seat: 1, roll: r1 }]];
const allOn = (uid: string) => (['1', '2', '3', 'X'] as const).map(marker => ({ marker, cardUid: uid }) as { marker: OrderMarkerValue; cardUid: string });
function unwrap(r: HSResult): HSState {
  if ('error' in r) throw new Error(`engine error: ${r.error}`);
  return r;
}

/** Build a 'playing' state with seat 0 (me) active, all markers on `s0-finn`,
 *  whose card id is swapped to `heroCardId`. The board is wiped; the hero goes on
 *  an interior cell (≥4 free neighbours). `twoHex` gives it a real 2-hex footprint
 *  (needed for Theracus's flight to have legal destinations). */
function stage(heroCardId: string, twoHex = false): { s: HSState; hero: string; interior: string; ring: string[] } {
  let s = initialState();
  s = addPlayer(s, 'p1', 'Alice', 0, '#10b981');
  s = addPlayer(s, 'p2', 'Bob', 1, '#ef4444');
  s = unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'quick' }));
  s = unwrap(applyAction(s, 'p1', { kind: 'place_markers', assignments: allOn('s0-finn') }));
  s = unwrap(applyAction(s, 'p2', { kind: 'place_markers', assignments: allOn('s1-thorgrim') }));
  s = unwrap(applyAction(s, 'p2', { kind: 'roll_initiative', attempts: ATT(15, 3) as never }));
  s = JSON.parse(JSON.stringify(s)) as HSState;
  s.cards.find(c => c.uid === 's0-finn')!.cardId = heroCardId;
  const cells = MAPS[s.mapId].cells;
  const interior = Object.keys(cells).find(k => neighborKeys(k).filter(n => cells[n]).length >= 4)!;
  const ring = neighborKeys(interior).filter(k => cells[k]);
  for (const f of s.figures) { f.at = null; f.at2 = null; }
  const hero = s.figures.find(f => f.id === 's0-finn-1')!;
  hero.at = interior;
  hero.at2 = twoHex ? ring[5] ?? ring[ring.length - 1] : null;
  return { s, hero: hero.id, interior, ring };
}

/** A real cell exactly `dist` away from `from` (flat Training Field → clear LOS). */
function cellAtDist(s: HSState, from: string, dist: number): string {
  const cells = MAPS[s.mapId].cells;
  const occ = new Set(s.figures.filter(f => f.at != null).flatMap(f => [f.at, f.at2].filter(Boolean) as string[]));
  for (const k of Object.keys(cells)) {
    if (k === from || occ.has(k)) continue;
    // hex distance via cube — reuse the engine's range by walking neighbours is
    // overkill; the Training Field is flat so axial distance suffices here.
    const [q1, r1] = from.split(',').map(Number);
    const [q2, r2] = k.split(',').map(Number);
    const d = (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
    if (d === dist) return k;
  }
  throw new Error(`no cell at distance ${dist}`);
}

const put = (s: HSState, id: string, key: string): HSState => {
  const f = s.figures.find(x => x.id === id)!;
  f.at = key;
  f.at2 = null;
  return s;
};

/** All HeroScapeBoard callbacks as spies; override the ones a test cares about. */
function spies() {
  return {
    onStart: vi.fn(), onSetLobbyConfig: vi.fn(), onPlaceMarkers: vi.fn(), onMoveFigure: vi.fn(), onMoveStep: vi.fn(),
    onGrappleMove: vi.fn(), onFireLine: vi.fn(), onExplosion: vi.fn(), onOrient: vi.fn(), onAttack: vi.fn(),
    onBerserkerCharge: vi.fn(), onWaterClone: vi.fn(), onMindShackle: vi.fn(), onChomp: vi.fn(),
    onGrenade: vi.fn(), onGrenadeThrow: vi.fn(), onIceShard: vi.fn(), onQueglix: vi.fn(),
    onWildSwing: vi.fn(), onAcidBreath: vi.fn(), onThrow: vi.fn(), onCarry: vi.fn(), onOverextend: vi.fn(), onTheDrop: vi.fn(),
    onResolveChoice: vi.fn(), onUndoMove: vi.fn(), onEndMove: vi.fn(), onEndTurn: vi.fn(), onDraftCard: vi.fn(), onDraftPass: vi.fn(),
    onPlaceFigure: vi.fn(), onUnplaceFigure: vi.fn(), onPlacementReady: vi.fn(),
  };
}
const renderBoard = (s: HSState, cb: ReturnType<typeof spies>) =>
  render(<HeroScapeBoard state={s} currentUserId="p1" isHost {...cb} />);

describe('Big-Hero powers — board UI panel', () => {
  it('Nilfheim: the Ice Shard panel renders and Fire dispatches onIceShard(hero, target)', () => {
    const { s, hero, ring } = stage('nilfheim');
    put(s, 's1-thorgrim-1', ring[0]); // one enemy in range
    const cb = spies();
    const { container } = renderBoard(s, cb);
    // One-tap: arm Ice Shard from the CARD power, then tap the enemy's hex on the board.
    fireEvent.click(screen.getByRole('button', { name: /Ice Shard Breath Special Attack/ }));
    fireEvent.click(container.querySelector(`[data-hex="${ring[0]}"]`)!);
    expect(cb.onIceShard).toHaveBeenCalledWith(hero, 's1-thorgrim-1');
  });

  it('Major Q9: the Queglix panel renders and Fire dispatches onQueglix(hero, target, 3)', () => {
    const { s, hero, ring } = stage('major_q9');
    put(s, 's1-thorgrim-1', ring[0]);
    const cb = spies();
    const { container } = renderBoard(s, cb);
    // One-tap: arm Queglix from the CARD power (default dice = min(3,9) = 3), then tap the enemy.
    fireEvent.click(screen.getByRole('button', { name: /Queglix Gun Special Attack/ }));
    fireEvent.click(container.querySelector(`[data-hex="${ring[0]}"]`)!);
    expect(cb.onQueglix).toHaveBeenCalledWith(hero, 's1-thorgrim-1', 3);
  });

  it('Jotun: Wild Swing AND Throw rows render; Swing dispatches, Throw arms landing-aim', () => {
    const { s, hero, ring } = stage('jotun');
    put(s, 's1-thorgrim-1', ring[0]); // adjacent medium non-flying → both a swing target and a throw target
    const cb = spies();
    const { container } = renderBoard(s, cb);
    // Wild Swing is board-click with a splash preview: arm from the CARD power, tap the enemy (1st
    // tap previews the blast, does NOT fire), then confirm with a 2nd tap.
    fireEvent.click(screen.getByRole('button', { name: /Wild Swing Special Attack/ }));
    fireEvent.click(container.querySelector(`[data-hex="${ring[0]}"]`)!);
    expect(cb.onWildSwing).not.toHaveBeenCalled(); // 1st tap only arms + previews the blast
    fireEvent.click(container.querySelector(`[data-hex="${ring[0]}"]`)!); // 2nd tap on it confirms
    expect(cb.onWildSwing).toHaveBeenCalledWith(hero, 's1-thorgrim-1');
    // Throw is a CLICK-THE-HEX flow (rules-fidelity: the landing is the player's choice). Tapping
    // the Throw power on the CARD arms landing-aim — it must NOT auto-dispatch; the strip appears.
    fireEvent.click(screen.getByRole('button', { name: /Throw 14/ }));
    expect(cb.onThrow).not.toHaveBeenCalled();
    expect(screen.getByText(/Throw .* click a highlighted landing hex/i)).toBeTruthy();
  });

  it('Braxas: the Acid Breath panel renders; toggling a target then Breathe dispatches onAcidBreath(hero, [target])', () => {
    const { s, hero, ring } = stage('braxas');
    put(s, 's1-marro_warriors-1', ring[0]); // small/medium in range
    const cb = spies();
    const { container } = renderBoard(s, cb);
    // One-click flow: tap the Acid Breath ability ON THE CARD to start picking (no separate
    // "aim" step), tap the target's base on the board, then Breathe.
    fireEvent.click(screen.getByRole('button', { name: /Poisonous Acid Breath/ }));
    fireEvent.click(container.querySelector(`[data-hex="${ring[0]}"]`)!);
    fireEvent.click(screen.getByRole('button', { name: /Breathe/ }));
    expect(cb.onAcidBreath).toHaveBeenCalledWith(hero, ['s1-marro_warriors-1']);
  });

  it('Theracus: Carry is a board-click flow — arm, then click passenger → destination → landing dispatches onCarry', () => {
    const { s, hero, ring } = stage('theracus', true); // 2-hex so flight has destinations
    const passenger = 's0-tarn_vikings-1';
    put(s, passenger, ring[0]); // friendly small/medium adjacent, unengaged
    const cb = spies();
    const { container } = renderBoard(s, cb);
    const cells = MAPS[s.mapId].cells;
    const occupied = new Set(s.figures.filter(f => f.at != null).flatMap(f => [f.at, f.at2].filter(Boolean) as string[]));
    // A legal flight destination that still has a free neighbour to set the passenger down on.
    const dest = [...legalDestinations(s, hero)].find(d => neighborKeys(d).some(n => cells[n] && !occupied.has(n) && n !== d))!;
    const landing = neighborKeys(dest).find(n => cells[n] && !occupied.has(n) && n !== dest)!;
    // Tapping Carry ON THE CARD arms the 3-click flow directly (no separate panel step) and
    // must NOT dispatch yet.
    fireEvent.click(screen.getByRole('button', { name: /Carry Before moving/i }));
    expect(cb.onCarry).not.toHaveBeenCalled();
    // 1) pick the passenger, 2) pick Theracus's flight destination, 3) pick the landing hex.
    fireEvent.click(container.querySelector(`[data-hex="${ring[0]}"]`)!);
    fireEvent.click(container.querySelector(`[data-hex="${dest}"]`)!);
    fireEvent.click(container.querySelector(`[data-hex="${landing}"]`)!);
    expect(cb.onCarry).toHaveBeenCalledTimes(1);
    expect(cb.onCarry).toHaveBeenCalledWith(hero, dest, passenger, landing);
  });

  it('the panel does NOT show for a non-Big-Hero active card', () => {
    // Finn (a base hero) active — no Big-Hero panel.
    const { s, ring } = stage('finn');
    put(s, 's1-thorgrim-1', ring[0]);
    const cb = spies();
    renderBoard(s, cb);
    expect(screen.queryByText(/Special Power/i)).toBeNull();
  });
});

// A round-start (place_markers) state with seat 0 owning 4 reserve Airborne Elite.
function dropStage(): { s: HSState; legal: string[] } {
  let s = initialState();
  s = addPlayer(s, 'p1', 'Alice', 0, '#10b981');
  s = addPlayer(s, 'p2', 'Bob', 1, '#ef4444');
  s = unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'quick' }));
  s = JSON.parse(JSON.stringify(s)) as HSState; // phase=playing, subPhase=place_markers
  // Keep ONLY one enemy figure on the board. Nulling every figure (the old approach)
  // left seat 0's quick-army finn/tarn as at:null & !reserve — which seatIsAlive
  // correctly reads as CASUALTIES, so canTheDrop saw a "dead" seat and hid the button.
  // Removing them entirely means seat 0 owns only the 4 reserve Airborne (no casualties).
  s.figures = s.figures.filter(f => f.id === 's1-thorgrim-1');
  s.figures[0].at = Object.keys(MAPS[s.mapId].cells)[0]; // that lone enemy on board
  s.cards.push({ uid: 's0-airborne_elite', cardId: 'airborne_elite', ownerSeat: 0, orderMarkers: [], attackMod: 0, defenseMod: 0 });
  for (let n = 1; n <= 4; n++) s.figures.push({ id: `s0-airborne_elite-${n}`, cardUid: 's0-airborne_elite', ownerSeat: 0, at: null, index: n, wounds: 0, reserve: true });
  return { s, legal: theDropHexes(s, 0) };
}

describe('Airborne Elite — The Drop board UI', () => {
  it('shows a "Roll The Drop" button for the Airborne owner; clicking it rolls (no placement yet)', () => {
    const { s } = dropStage();
    const cb = spies();
    renderBoard(s, cb);
    // The roll button renders for the Airborne owner (distinct from the card's
    // "The Drop" power-name label that also appears in the roster).
    expect(theDropHexes(s, 0)).toEqual([]); // no landings highlighted until the roll hits
    fireEvent.click(screen.getByRole('button', { name: /Roll The Drop/i }));
    expect(cb.onTheDrop).toHaveBeenCalledTimes(1);
    expect(cb.onTheDrop.mock.calls[0]).toHaveLength(0); // ROLL only — no placements committed
  });

  it('after a 13+ roll opens the placement choice, picking 4 hexes then Deploy dispatches onResolveChoice', () => {
    const { s } = dropStage();
    // The engine's post-13+ state: the placement choice is open (the roll is done).
    s.airborneDropRound = s.round;
    s.pendingChoice = { kind: 'airborne_drop', seat: 0, cardUid: 's0-airborne_elite', count: 4 };
    const legal = theDropHexes(s, 0);
    const spots: string[] = [];
    for (const h of legal) {
      if (spots.length >= 4) break;
      if (spots.every(c => !neighborKeys(c).includes(h))) spots.push(h);
    }
    expect(spots).toHaveLength(4);
    const cb = spies();
    const { container } = renderBoard(s, cb);
    // Now in placement mode — click the 4 chosen landing hexes (data-hex on the top face).
    for (const k of spots) {
      const poly = container.querySelector(`[data-hex="${k}"]`);
      expect(poly).toBeTruthy();
      fireEvent.click(poly!);
    }
    fireEvent.click(screen.getByRole('button', { name: /Deploy!/ }));
    expect(cb.onResolveChoice).toHaveBeenCalledTimes(1);
    expect(cb.onResolveChoice.mock.calls[0][0].kind).toBe('airborne_drop');
    expect(cb.onResolveChoice.mock.calls[0][0].placements.sort()).toEqual([...spots].sort());
  });

  it('does NOT show the Drop panel for a player with no reserve Airborne', () => {
    const { s } = dropStage();
    const cb = spies();
    // Render as seat 1 (Bob) — they own no reserve Airborne.
    render(<HeroScapeBoard state={s} currentUserId="p2" isHost={false} {...cb} />);
    expect(screen.queryByRole('button', { name: /The Drop \(roll/i })).toBeNull();
  });
});
