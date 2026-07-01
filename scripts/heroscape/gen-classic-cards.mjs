// AUTO-GENERATOR for src/lib/games/heroscape/classic-cards.generated.ts
//
// Reads roster.json (DB-sourced source of truth), takes every CLASSIC-era card that is NOT already
// hand-authored in content.ts, and emits base-stat HSCardDef entries + CARD_IDENTITY entries.
// These are STAGED DATA: power:'wip' (no special implemented), NO behaviour flags, and NOT added to
// HS_DRAFT_POOL — so they exist for reference but are undraftable until their art lands.
//
//   node scripts/heroscape/gen-classic-cards.mjs
//
// baseSize (2-hex) is a per-figure visual fact absent from the DB → defaults to 1 here; correct it
// when the figure image lands. `world` is absent from the DB → '' placeholder (fill later).

import fs from 'node:fs';
import path from 'node:path';

const HS = path.resolve('src/lib/games/heroscape');
const roster = JSON.parse(fs.readFileSync(path.join(HS, 'roster.json'), 'utf8'));
const content = fs.readFileSync(path.join(HS, 'content.ts'), 'utf8');

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\([^)]*\)/g, '').replace(/-(rotv|sotm|aoa)\b/g, '').replace(/\bthe\b/g, '').replace(/[^a-z0-9]/g, '');

// existing hand-authored cards: id + name (to SKIP, so hand-authored wins)
const existingIds = new Set();
const existingByName = new Map();
for (const m of content.matchAll(/\bid:\s*'([^']+)',\s*\n\s*name:\s*'([^']+)'/g)) {
  existingIds.add(m[1]); existingByName.set(norm(m[2]), m[1]);
}

const slug = name => {
  let s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  let id = s, i = 2;
  while (existingIds.has(id)) id = s + '_' + i++;  // avoid clashing with a hand-authored id
  return id;
};
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const sizeWord = s => { const w = (s || '').trim().split(/\s+/)[0].toLowerCase(); return ['small', 'medium', 'large', 'huge'].includes(w) ? w : 'medium'; };
const heightOf = s => { const m = (s || '').match(/(\d+)/); return m ? +m[1] : 5; };
const shortOf = name => { const i = name.indexOf(' the '); return i > 0 ? name.slice(0, i) : name; };
const letterOf = name => { const m = name.match(/[A-Za-z0-9]/); return (m ? m[0] : '?').toUpperCase(); };

const TWO_HEX = new Set(['brunak']); // double-space (2-hex peanut) figures — confirmed from the figure image; add ids as cut
const cards = {}, ident = {}, seen = new Set();
let generated = 0, skipped = 0;
const skippedNames = [];
for (const c of roster) {
  if (c.era !== 'classic') continue;
  const key = norm(c.name);
  if (existingByName.has(key)) { skipped++; skippedNames.push(c.name); continue; }  // already hand-authored
  if (seen.has(key)) continue;                                                        // dedupe reprints
  seen.add(key);
  const id = slug(c.name);
  existingIds.add(id);
  const sz = sizeWord(c.size);
  const isSquad = /squad/i.test(c.type);
  const def = {
    id, name: c.name, shortName: shortOf(c.name),
    type: isSquad ? 'squad' : 'hero',
    figures: Math.max(1, Math.round(c.figuresPerCard || 1)),
    life: Math.round(c.life), move: Math.round(c.move), range: Math.round(c.range),
    attack: Math.round(c.attack), defense: Math.round(c.defense),
    height: heightOf(c.size),
    size: sz, points: Math.round(c.cost), letter: letterOf(c.name),
    species: c.species || '', unitClass: c.class || '',
    common: /\bCommon\b/.test(c.type),
    power: (c.powers && c.powers.length) ? 'wip' : 'live',
    baseSize: TWO_HEX.has(id) ? 2 : 1,
  };
  cards[id] = def;
  ident[id] = { general: c.faction || '', personality: c.personality || '', world: '' };
  generated++;
}

// emit TS
const cardLine = d => {
  const parts = [
    `id: '${esc(d.id)}'`, `name: '${esc(d.name)}'`, `shortName: '${esc(d.shortName)}'`,
    `type: '${d.type}'`, `figures: ${d.figures}`,
    `life: ${d.life}`, `move: ${d.move}`, `range: ${d.range}`, `attack: ${d.attack}`, `defense: ${d.defense}`,
    `height: ${d.height}`,
  ];
  if (d.size !== 'medium') parts.push(`size: '${d.size}'`);
  if (d.baseSize === 2) parts.push('baseSize: 2');
  parts.push(`points: ${d.points}`, `letter: '${esc(d.letter)}'`, `species: '${esc(d.species)}'`, `unitClass: '${esc(d.unitClass)}'`);
  if (d.common) parts.push(`common: true`);
  parts.push(`power: '${d.power}'`);
  return `  '${esc(d.id)}': { ${parts.join(', ')} },`;
};
const identLine = (id, v) => `  '${esc(id)}': { general: '${esc(v.general)}', personality: '${esc(v.personality)}', world: '${esc(v.world)}' },`;

const ids = Object.keys(cards).sort();
const out = `// AUTO-GENERATED — do not edit by hand. Regenerate: node scripts/heroscape/gen-classic-cards.mjs
// Staged classic cards (base stats only): power:'wip' (no special implemented), no behaviour flags,
// NOT in HS_DRAFT_POOL (undraftable until art lands). baseSize defaults to 1 (fix from the figure image);
// world is '' (DB lacks it). Source: roster.json (HeroScape Card Manager DB, v01/2026).
import type { HSCardDef } from './types';

export const GENERATED_CLASSIC_CARDS: Record<string, HSCardDef> = {
${ids.map(id => cardLine(cards[id])).join('\n')}
};

export const GENERATED_CLASSIC_IDENTITY: Record<string, { general: string; personality: string; world: string }> = {
${ids.map(id => identLine(id, ident[id])).join('\n')}
};
`;
fs.writeFileSync(path.join(HS, 'classic-cards.generated.ts'), out);
console.log(`generated ${generated} classic cards | skipped ${skipped} already-authored | -> classic-cards.generated.ts`);
console.log('skipped (hand-authored):', skippedNames.sort().join(', '));
console.log('sample generated ids:', ids.slice(0, 12).join(', '));
