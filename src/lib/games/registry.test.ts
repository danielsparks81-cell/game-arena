import { describe, it, expect } from 'vitest';
import { GAMES } from './registry';

// Cross-engine invariants checked against every registered game. When a new
// game is added, these run automatically — catches "you forgot computeHistory"
// or "addPlayer drops accent_color" the moment you write the registry entry.

describe('every registered game', () => {
  const gameIds = Object.keys(GAMES);

  it('has at least one game registered', () => {
    expect(gameIds.length).toBeGreaterThan(0);
  });

  for (const id of gameIds) {
    const def = GAMES[id];

    describe(`${id}`, () => {
      it('declares matching id, name, player counts, categories', () => {
        expect(def.id).toBe(id);
        expect(def.name).toBeTruthy();
        expect(def.minPlayers).toBeGreaterThan(0);
        expect(def.maxPlayers).toBeGreaterThanOrEqual(def.minPlayers);
        expect(Array.isArray(def.categories) || def.categories === undefined).toBe(true);
      });

      it('initialState returns a versioned, JSON-serializable object', () => {
        const s = def.initialState() as { version?: number };
        // Should round-trip cleanly — these states ride in a JSONB column.
        expect(() => JSON.parse(JSON.stringify(s))).not.toThrow();
        // Engines stamp a positive integer version; the exact number bumps
        // independently per game as their state shapes evolve.
        expect(typeof s.version).toBe('number');
        expect(s.version).toBeGreaterThanOrEqual(1);
      });

      it('getOrderedPlayerIds returns an empty array on the fresh state', () => {
        const s = def.initialState();
        const ids = def.getOrderedPlayerIds(s);
        expect(Array.isArray(ids)).toBe(true);
        expect(ids).toHaveLength(0);
      });

      it('getActivePlayerId returns null on the fresh state', () => {
        const s = def.initialState();
        expect(def.getActivePlayerId(s)).toBeNull();
      });

      it('computeHistory returns null on the fresh state (game not finished)', () => {
        if (!def.computeHistory) return;
        expect(def.computeHistory(def.initialState())).toBeNull();
      });

      // Multi-player games register addPlayer; verify it stores accent_color
      // alongside username + seat. Catches "engine dropped accent on join"
      // regressions like the one we hit earlier.
      //
      // We don't insist on a specific field name — most engines use
      // `state.players[]`, but some (HeroQuest) use a domain-specific name
      // like `heroes[]`. We probe both well-known field names.
      it('addPlayer (if registered) preserves accent_color into the player roster', () => {
        if (!def.addPlayer) return;
        const s = def.addPlayer(
          def.initialState(),
          'user-1', 'alice', 0, '#ff00ff',
        ) as { players?: { playerId: string; accent_color?: string }[]; heroes?: { playerId: string; accent_color?: string }[] };
        const roster = s.players ?? s.heroes ?? [];
        expect(Array.isArray(roster)).toBe(true);
        const me = roster.find(p => p.playerId === 'user-1');
        expect(me).toBeDefined();
        expect(me?.accent_color).toBe('#ff00ff');
      });

      it('addPlayer + removePlayer round-trips back to no-player state', () => {
        if (!def.addPlayer || !def.removePlayer) return;
        const start = def.initialState();
        const added = def.addPlayer(start, 'user-1', 'alice', 0, '#ff00ff');
        const removed = def.removePlayer(added, 'user-1') as { players?: { playerId: string }[]; heroes?: { playerId: string }[] };
        const roster = removed.players ?? removed.heroes ?? [];
        expect(roster).toHaveLength(0);
      });

      it('initialState is referentially fresh each call (not a shared singleton)', () => {
        const a = def.initialState();
        const b = def.initialState();
        // Same value shape, different references — mutating one shouldn't affect the other.
        expect(a).not.toBe(b);
      });

      // createInitialStateForHost is the path the lobby's createRoom + inviteToGame
      // both go through. If a new game forgets to register it, the lobby
      // would silently insert an empty {} state and the room would crash on
      // entry. This test prevents that regression class.
      it('createInitialStateForHost seats the host (ordered ids contain them)', () => {
        const state = def.createInitialStateForHost({
          userId: 'host-1',
          username: 'alice',
          accentColor: '#10b981',
        });
        const ordered = def.getOrderedPlayerIds(state);
        expect(ordered).toContain('host-1');
        // The seated state should also be a fresh, JSON-safe object.
        expect(() => JSON.parse(JSON.stringify(state))).not.toThrow();
      });
    });
  }
});
