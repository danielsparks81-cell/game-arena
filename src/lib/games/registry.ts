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
  longshot: {
    id: 'longshot',
    name: 'Long Shot',
    description: 'Horse-racing dice game. Buy, bet, and influence the race. (Beta)',
    minPlayers: 1,
    maxPlayers: 8,
  },
};

export function getGame(id: string): GameDef | undefined {
  return GAMES[id];
}
