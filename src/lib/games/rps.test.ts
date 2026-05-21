import { describe, it, expect } from 'vitest';
import { initialState, applyMove, STATE_VERSION, ROUNDS_TO_WIN, type RPSState } from './rps';

function seatedState(): RPSState {
  return { ...initialState(), seats: { A: 'user-a', B: 'user-b' } };
}

describe('rps engine', () => {
  it('stamps state version on init', () => {
    expect(initialState().version).toBe(STATE_VERSION);
  });

  it('rejects when a non-seated user submits', () => {
    const r = applyMove(seatedState(), { choice: 'rock' }, 'random');
    expect('error' in r).toBe(true);
  });

  it('rejects invalid choices', () => {
    const r = applyMove(seatedState(), { choice: 'lizard' as 'rock' }, 'user-a');
    expect('error' in r).toBe(true);
  });

  it('first submission stores the choice and waits for opponent', () => {
    const s = applyMove(seatedState(), { choice: 'rock' }, 'user-a') as RPSState;
    expect(s.choices.A).toBe('rock');
    expect(s.choices.B).toBeUndefined();
    expect(s.history).toHaveLength(0);
    expect(s.round).toBe(1); // not yet advanced
  });

  it('rejects submitting twice in the same round', () => {
    let s = applyMove(seatedState(), { choice: 'rock' }, 'user-a') as RPSState;
    const r = applyMove(s, { choice: 'paper' }, 'user-a');
    expect('error' in r).toBe(true);
  });

  it('reveals + scores when both players submit', () => {
    let s = applyMove(seatedState(), { choice: 'rock' },     'user-a') as RPSState;
    s = applyMove(s,                  { choice: 'scissors' }, 'user-b') as RPSState;
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toEqual({ A: 'rock', B: 'scissors', winner: 'A' });
    expect(s.scores).toEqual({ A: 1, B: 0 });
    expect(s.round).toBe(2);
    expect(s.choices).toEqual({});
  });

  it('handles draws (same choice) without scoring', () => {
    let s = applyMove(seatedState(), { choice: 'paper' }, 'user-a') as RPSState;
    s = applyMove(s,                 { choice: 'paper' }, 'user-b') as RPSState;
    expect(s.history[0].winner).toBe('draw');
    expect(s.scores).toEqual({ A: 0, B: 0 });
  });

  it('ends the match when one side hits the win threshold', () => {
    let s: RPSState = seatedState();
    // A wins three in a row, 1-0, 2-0, 3-0.
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      s = applyMove(s, { choice: 'rock' },     'user-a') as RPSState;
      s = applyMove(s, { choice: 'scissors' }, 'user-b') as RPSState;
    }
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('A');
    expect(s.scores.A).toBe(ROUNDS_TO_WIN);
  });

  it('rejects moves after match is over', () => {
    let s: RPSState = seatedState();
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      s = applyMove(s, { choice: 'rock' },     'user-a') as RPSState;
      s = applyMove(s, { choice: 'scissors' }, 'user-b') as RPSState;
    }
    const r = applyMove(s, { choice: 'paper' }, 'user-a');
    expect('error' in r).toBe(true);
  });

  it('preserves state version through every move', () => {
    let s = applyMove(seatedState(), { choice: 'rock' }, 'user-a') as RPSState;
    expect(s.version).toBe(STATE_VERSION);
    s = applyMove(s, { choice: 'scissors' }, 'user-b') as RPSState;
    expect(s.version).toBe(STATE_VERSION);
  });
});
