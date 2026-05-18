export type GameDef = {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
};

export const GAMES: Record<string, GameDef> = {
  tictactoe: {
    id: 'tictactoe',
    name: 'Tic-Tac-Toe',
    description: 'The classic. First to three in a row wins.',
    minPlayers: 2,
    maxPlayers: 2,
  },
  connect4: {
    id: 'connect4',
    name: 'Connect Four',
    description: 'Drop pieces, get four in a row. 7 columns, 6 rows.',
    minPlayers: 2,
    maxPlayers: 2,
  },
  checkers: {
    id: 'checkers',
    name: 'Checkers',
    description: 'Classic 8×8 checkers. Forced captures, kings, multi-jumps.',
    minPlayers: 2,
    maxPlayers: 2,
  },
  battleship: {
    id: 'battleship',
    name: 'Battleship',
    description: 'Place your fleet, then take turns firing shots. Sink them all.',
    minPlayers: 2,
    maxPlayers: 2,
  },
  boggle: {
    id: 'boggle',
    name: 'Boggle',
    description: '4×4 letter grid, 3-minute race to find the most words. 2–6 players.',
    minPlayers: 2,
    maxPlayers: 6,
  },
  longshot: {
    id: 'longshot',
    name: 'Long Shot',
    description: 'Horse-racing dice game. Buy, bet, and influence the race. (Beta)',
    minPlayers: 2,
    maxPlayers: 8,
  },
};

export function getGame(id: string): GameDef | undefined {
  return GAMES[id];
}
