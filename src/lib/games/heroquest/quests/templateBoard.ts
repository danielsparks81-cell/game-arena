// THE locked HeroQuest board — 30×23, 22 rooms. Authored in the Map Authoring
// sandbox and frozen as the single board every quest is built on. The editor's
// default + Reset target; quests differ only by what's painted on top (stairs,
// doors, walls to block passages, rock for unused areas, monsters, furniture,
// traps), never by the board's shape or size.
//
// Glyphs: '.' hall · 'a'..'p' room (each connected same-letter block is its own
// room; colours are reused for visual variety) · later per quest: '#' rock,
// 'W' wall, 'S' stairs, '+' door, '*' secret door.

export const TEMPLATE_W = 30;
export const TEMPLATE_H = 23;

export const TEMPLATE_BOARD: string[] = [
  '..............................',
  '..............................',
  '..aaaabbbbcccc..aaaaeeeeffff..',
  '..aaaabbbbcccc..aaaaeeeeffff..',
  '..aaaabbbbcccc..aaaaeeeeffff..',
  '..aaaabbbbcccc..aaaaeeeeffff..',
  '..eeeeffffcccc..aaaabbbbcccc..',
  '..eeeeffff..........bbbbcccc..',
  '..eeeeffff..........bbbbcccc..',
  '..eeeeffff..eeeeee..bbbbcccc..',
  '..eeeeffff..eeeeee..bbbbcccc..',
  '............eeeeee............',
  '............eeeeee............',
  '..ffffggii..eeeeee..eeeegggg..',
  '..ffffggii..........eeeegggg..',
  '..ffffggii..........eeeegggg..',
  '..ffffhhhhaaaa..aaaaaeeegggg..',
  '..eeeehhhhaaaa..aaaaafffhhhh..',
  '..eeeehhhhaaaa..aaaaafffhhhh..',
  '..eeeehhhhaaaa..aaaaafffhhhh..',
  '..eeeehhhhaaaa..aaaaafffhhhh..',
  '..............................',
  '..............................',
];
