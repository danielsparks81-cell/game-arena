import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const db = new DatabaseSync(process.argv[2]);
const outPath = process.argv[3];

const sets = new Map();
for (const s of db.prepare('SELECT * FROM set_metadata').all()) sets.set(s.set_name, s);

const era = (set_name, allegiance, sort) => {
  if (allegiance === 'Marvel' || /Conflict Begins/.test(set_name)) return 'marvel';
  if (allegiance === 'Cobra' || allegiance === 'G.I Joe' || set_name === 'GI Joe') return 'gijoe';
  if (sort >= 10.5 && sort < 20) return 'dnd';
  if (sort >= 20) return 'modern';
  return 'classic';
};

const cards = db.prepare('SELECT * FROM cards ORDER BY id').all();
const abil = db.prepare('SELECT card_id, order_num, name, description FROM abilities ORDER BY card_id, order_num').all();
const byCard = new Map();
for (const a of abil) { (byCard.get(a.card_id) || byCard.set(a.card_id, []).get(a.card_id)).push({ name: a.name, text: a.description }); }

const out = cards.map(c => {
  const sm = sets.get(c.set_name) || {};
  return {
    name: c.name,
    faction: c.allegiance,
    cost: c.cost,                 // DB cost = ORIGINAL/classic printing value
    set: c.set_name,
    wave: sm.label || '',
    sortOrder: sm.sort_order ?? null,
    era: era(c.set_name, c.allegiance, sm.sort_order ?? 99),
    type: c.type,
    class: c.class,
    species: c.species,
    personality: c.personality,
    size: c.size,
    life: c.life, move: c.move, range: c.range, attack: c.attack, defense: c.defence,
    figuresPerCard: c.figures_per_card,
    powers: byCard.get(c.id) || [],
  };
});

fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
const tally = {};
for (const c of out) tally[c.era] = (tally[c.era] || 0) + 1;
console.log('wrote', out.length, 'cards ->', outPath);
console.log('by era:', JSON.stringify(tally));
console.log('powers total:', abil.length, '| cards with >=1 power:', out.filter(c => c.powers.length).length);
