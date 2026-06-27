// AUTO-GENERATOR for docs/heroscape/traits-matrix.md (+ .csv) — the full army traits + stats matrix.
// It reads the REAL card data (no parsing), so the matrix can never drift from the engine. It runs as
// a vitest module so it can import the TS defs directly (the repo has no standalone TS runner).
//
//   • Regenerate the doc + csv:  GEN_MATRIX=1 npx vitest run traits-matrix
//   • Normal runs just GUARD completeness (every card appears in the committed doc) so adding a card
//     without regenerating fails the suite.
//
// Why this exists: as armies grow, card-to-card interactions key off traits (species/class auras like
// Grimnak's Orc Warrior Enhancement, Bonding's Champion/Beast partner, size/height limits like Chomp).
// One scannable table makes those interactions obvious.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { HS_CARDS, CARD_IDENTITY, CARD_ABILITIES, ABILITIES } from './content';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A card has a "d20 ability" if any of its powers' glossary text uses the 20-sided die (rolls it OR
 *  modifies it — e.g. Su-Bak-Na's Hive Supremacy). Data-driven so new d20 cards are picked up free. */
const hasD20 = (id: string): boolean =>
  (CARD_ABILITIES[id] ?? []).some(name => (ABILITIES[name]?.text ?? '').includes('20-sided die'));

const HEADERS = [
  'Character Name', 'Unit Cost', 'Common/Unique', 'Hero/Squad', 'Faction', 'World', 'Species', 'Class',
  'Personality', 'Base Size', 'Size', 'Height', 'Life', 'M', 'R', 'A', 'D', 'd20 Ability',
];

function row(id: string): string[] {
  const c = HS_CARDS[id];
  const i = CARD_IDENTITY[id] ?? { general: '—', personality: '—', world: '—' };
  return [
    c.name,
    String(c.points),
    c.common ? 'Common' : 'Unique',
    c.type === 'hero' ? 'Hero' : 'Squad',
    i.general,
    i.world,
    c.species,
    c.unitClass,
    i.personality,
    (c.baseSize ?? 1) === 2 ? 'Double' : 'Single',
    cap(c.size ?? 'medium'),
    String(c.height),
    String(c.life),
    String(c.move),
    String(c.range),
    String(c.attack),
    String(c.defense),
    hasD20(id) ? 'Yes' : 'No',
  ];
}

/** Sort grouped by Faction (General), then points, then name — the same grouping the cards.md roster uses. */
function sortedIds(): string[] {
  return Object.keys(HS_CARDS).sort((a, b) => {
    const ga = CARD_IDENTITY[a]?.general ?? '~', gb = CARD_IDENTITY[b]?.general ?? '~';
    if (ga !== gb) return ga.localeCompare(gb);
    if (HS_CARDS[a].points !== HS_CARDS[b].points) return HS_CARDS[a].points - HS_CARDS[b].points;
    return HS_CARDS[a].name.localeCompare(HS_CARDS[b].name);
  });
}

function buildMarkdown(): string {
  const ids = sortedIds();
  const L: string[] = [];
  L.push('# HeroScape — army traits matrix');
  L.push('');
  L.push('> AUTO-GENERATED from `content.ts` (`HS_CARDS` + `CARD_IDENTITY` + `CARD_ABILITIES`). **Do not');
  L.push('> edit by hand** — regenerate with `GEN_MATRIX=1 npx vitest run traits-matrix`. Every card\'s');
  L.push('> traits + stats in one place so card-to-card interactions (species/class auras, Bonding');
  L.push('> partners, size/height limits) are easy to scan. **`d20 Ability`** = the card has a power that');
  L.push('> rolls or modifies the 20-sided die. **Base Size** = Single (1 hex) / Double (2-hex peanut).');
  L.push('');
  L.push(`**${ids.length} cards**, grouped by Faction (General) then points. Also emitted as`);
  L.push('[`traits-matrix.csv`](traits-matrix.csv) for spreadsheet import.');
  L.push('');
  L.push('| ' + HEADERS.join(' | ') + ' |');
  L.push('|' + HEADERS.map(() => '---').join('|') + '|');
  for (const id of ids) L.push('| ' + row(id).join(' | ') + ' |');
  L.push('');
  return L.join('\n');
}

function buildCsv(): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [HEADERS.map(esc).join(',')];
  for (const id of sortedIds()) lines.push(row(id).map(esc).join(','));
  return lines.join('\n') + '\n';
}

describe('army traits matrix', () => {
  it('covers every card (regenerate the doc with GEN_MATRIX=1)', () => {
    const md = buildMarkdown();
    const docsDir = path.resolve(process.cwd(), 'docs/heroscape');
    if (process.env.GEN_MATRIX) {
      fs.writeFileSync(path.join(docsDir, 'traits-matrix.md'), md, 'utf8');
      fs.writeFileSync(path.join(docsDir, 'traits-matrix.csv'), buildCsv(), 'utf8');
    }
    // Completeness guard: every card must appear in the committed doc (fails if a card was added but
    // the matrix wasn't regenerated). Run with GEN_MATRIX=1 to fix.
    const existing = fs.existsSync(path.join(docsDir, 'traits-matrix.md'))
      ? fs.readFileSync(path.join(docsDir, 'traits-matrix.md'), 'utf8')
      : '';
    for (const id of Object.keys(HS_CARDS)) {
      expect(existing, `traits-matrix.md is missing "${HS_CARDS[id].name}" — run GEN_MATRIX=1 npx vitest run traits-matrix`).toContain(HS_CARDS[id].name);
    }
  });
});
