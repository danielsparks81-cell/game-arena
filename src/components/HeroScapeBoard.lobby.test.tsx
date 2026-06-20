// @vitest-environment jsdom
//
// UI-glue test for the TEAM lobby (multiplayer Phase 2). The engine's team merge
// is covered in teams.test.ts; this closes the gap the engine can't reach — that
// the lobby renders the team pickers for 3+ players and that clicking a colour
// dispatches onSetLobbyConfig with the FULL rebuilt seat→team map (the subtle bit:
// the engine clears any omitted seat, so the UI must resend every assignment).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import HeroScapeBoard from './HeroScapeBoard';
import { initialState, addPlayer } from '@/lib/games/heroscape';
import type { HSState } from '@/lib/games/heroscape';

afterEach(cleanup);

/** All HeroScapeBoard callbacks as spies; override the ones a test cares about. */
function spies() {
  return {
    onStart: vi.fn(), onSetLobbyConfig: vi.fn(), onPlaceMarkers: vi.fn(), onMoveFigure: vi.fn(),
    onGrappleMove: vi.fn(), onFireLine: vi.fn(), onOrient: vi.fn(), onAttack: vi.fn(),
    onBerserkerCharge: vi.fn(), onWaterClone: vi.fn(), onMindShackle: vi.fn(), onChomp: vi.fn(),
    onGrenade: vi.fn(), onGrenadeThrow: vi.fn(), onIceShard: vi.fn(), onQueglix: vi.fn(),
    onWildSwing: vi.fn(), onAcidBreath: vi.fn(), onThrow: vi.fn(), onCarry: vi.fn(), onTheDrop: vi.fn(),
    onResolveChoice: vi.fn(), onUndoMove: vi.fn(), onEndMove: vi.fn(), onEndTurn: vi.fn(), onDraftCard: vi.fn(), onDraftPass: vi.fn(),
    onPlaceFigure: vi.fn(), onUnplaceFigure: vi.fn(), onPlacementReady: vi.fn(),
  };
}

/** A draft-mode lobby with `n` players (no start_game → phase stays 'lobby'). */
function lobbyN(n: number): HSState {
  let s = initialState();
  const names = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];
  const colors = ['#10b981', '#ef4444', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
  for (let i = 0; i < n; i++) s = addPlayer(s, `p${i + 1}`, names[i], i, colors[i]);
  s.mode = 'draft'; // the Teams panel is draft-only
  return s;
}

describe('HeroScape lobby — teams', () => {
  it('renders the team pickers for 3+ players and assigns a player to a side', () => {
    const cb = spies();
    render(<HeroScapeBoard state={lobbyN(3)} currentUserId="p1" isHost {...cb} />);
    expect(screen.getByText('Teams')).toBeTruthy();
    // One A/B/C chip trio per player → 3 "Team A" chips. Put Alice (seat 0) on A.
    fireEvent.click(screen.getAllByTitle('Team A')[0]);
    expect(cb.onSetLobbyConfig).toHaveBeenCalledWith({ teams: { 0: 1 } });
  });

  it('resends the FULL seat→team map so existing assignments survive', () => {
    const s = lobbyN(3);
    s.players.find(p => p.seat === 0)!.team = 1; // Alice already on Team A
    const cb = spies();
    render(<HeroScapeBoard state={s} currentUserId="p1" isHost {...cb} />);
    // Put Bob (seat 1) on Team B — the dispatched map must KEEP Alice on team 1.
    fireEvent.click(screen.getAllByTitle('Team B')[1]);
    expect(cb.onSetLobbyConfig).toHaveBeenCalledWith({ teams: { 0: 1, 1: 2 } });
  });

  it('clicking a seat’s current side again clears it (back to solo)', () => {
    const s = lobbyN(3);
    s.players.find(p => p.seat === 0)!.team = 1;
    const cb = spies();
    render(<HeroScapeBoard state={s} currentUserId="p1" isHost {...cb} />);
    fireEvent.click(screen.getAllByTitle('Team A')[0]); // toggle Alice off
    expect(cb.onSetLobbyConfig).toHaveBeenCalledWith({ teams: {} });
  });

  it('hides the team pickers for a 2-player lobby (1-v-1, no teams)', () => {
    const cb = spies();
    render(<HeroScapeBoard state={lobbyN(2)} currentUserId="p1" isHost {...cb} />);
    expect(screen.queryByText('Teams')).toBeNull();
  });

  it('a non-host cannot edit teams', () => {
    const cb = spies();
    render(<HeroScapeBoard state={lobbyN(3)} currentUserId="p2" isHost={false} {...cb} />);
    fireEvent.click(screen.getAllByTitle('Team A')[0]);
    expect(cb.onSetLobbyConfig).not.toHaveBeenCalled();
  });
});
