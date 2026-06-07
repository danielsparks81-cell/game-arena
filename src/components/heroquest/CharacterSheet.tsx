'use client';

// HeroQuest character sheet — replaces the bland status card with a proper
// parchment-styled hero sheet: portrait, banner, BP hearts, MP brains,
// attack/defense badges, gold purse, inventory grid, spell cards.

import { useMemo } from 'react';
import {
  type HQState,
  type Hero,
  type Spell,
  type HeldPotion,
  HERO_DEFAULTS,
} from '@/lib/games/heroquest';
import {
  HeroToken,
  HeartIcon,
  MindIcon,
  CoinIcon,
  SwordIcon,
  ShieldIcon,
  FleurDivider,
  HQ_COLORS,
} from './Art';
import { safeAccent } from '@/lib/accentColors';

const PARCHMENT_BG = `
  radial-gradient(ellipse at top, #f3e5c2 0%, #d8b884 80%),
  linear-gradient(135deg, #d8b884 0%, #b8945a 100%)
`;

export default function CharacterSheet({
  hero, isActive, isMyTurn, isMine, onCastSpell, onUsePotion, compact = false,
}: {
  hero: Hero;
  isActive: boolean;
  isMyTurn: boolean;
  isMine: boolean;
  onCastSpell: (spellId: string) => void;
  onUsePotion?: (potionId: string) => void;
  /** Compact: header + stat band only (no equipment / spell grids) so several
   *  heroes can stack as a party of panels. */
  compact?: boolean;
}) {
  const d = HERO_DEFAULTS[hero.klass];
  const accent = safeAccent(hero.accent_color);

  // Compact party panel: a dense 2-row card (header + one stat line) so all four
  // heroes fit the sidebar without being cut off. Stats carry hover tooltips.
  if (compact) {
    const dead = hero.body <= 0;
    return (
      <div
        className={`rounded-lg border-2 overflow-hidden text-amber-950 ${dead ? 'opacity-50 grayscale' : ''}`}
        style={{
          background: PARCHMENT_BG,
          borderColor: isActive ? accent : '#7a5a08',
          boxShadow: isActive ? `0 0 12px ${accent}` : undefined,
        }}
      >
        <div
          className="flex items-center gap-2 border-b border-amber-900/40 px-2 py-0.5"
          style={{ background: `linear-gradient(180deg, ${accent}aa 0%, ${accent}44 100%)` }}
        >
          <HeroToken klass={hero.klass} size={24} color={accent} ring={isActive ? '#fff' : undefined} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[11px] font-bold uppercase tracking-wide">{hero.username}</div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-amber-900/80">{d.name}</div>
          </div>
          <span title="Attack dice — how many combat dice you roll to attack" className="flex items-center gap-0.5 rounded bg-amber-950/20 px-1.5 py-0.5 text-xs font-bold tabular-nums">
            <SwordIcon size={13} />{hero.attack}
          </span>
          <span title="Defend dice — how many combat dice you roll to defend" className="flex items-center gap-0.5 rounded bg-amber-950/20 px-1.5 py-0.5 text-xs font-bold tabular-nums">
            <ShieldIcon size={13} />{hero.defense}
          </span>
        </div>
        <div className="flex items-center gap-3 px-2 py-1 text-[11px] font-bold tabular-nums">
          <span title="Body Points — your health; you die at 0" className="flex items-center gap-1">
            <HeartIcon size={12} filled /> {hero.body}/{hero.bodyMax}
          </span>
          <span title="Mind Points — wisdom & resistance to magic" className="flex items-center gap-1">
            <MindIcon size={12} filled /> {hero.mind}/{hero.mindMax}
          </span>
          <span title="Gold collected" className="ml-auto flex items-center gap-1">
            <CoinIcon size={12} /> {hero.gold}
          </span>
        </div>
        {hero.items.length > 0 && <div className="px-2 pb-1"><CompactItems hero={hero} /></div>}
        {(hero.foundPotions?.length ?? 0) > 0 && (
          <div className="px-2 pb-1">
            {/* canUse is gated on isActive (this hero's own turn), NOT isMyTurn.
                isMyTurn is true for ALL heroes owned by the current player when
                any of them is up — using isActive keeps buttons live only for
                the hero whose turn it actually is. */}
            <PotionRow
              potions={hero.foundPotions}
              hero={hero}
              canUse={isMine && isActive}
              onUse={onUsePotion}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border-2 shadow-lg overflow-hidden text-amber-950"
      style={{
        background: PARCHMENT_BG,
        borderColor: isActive ? accent : '#7a5a08',
        boxShadow: isActive
          ? `0 0 16px ${accent}, inset 0 0 30px rgba(120,80,20,0.25)`
          : 'inset 0 0 30px rgba(120,80,20,0.25)',
      }}
    >
      {/* Header band */}
      <div
        className={`flex items-center gap-3 border-b border-amber-900/40 px-3 ${compact ? 'py-1' : 'py-2'}`}
        style={{
          background: `linear-gradient(180deg, ${accent}aa 0%, ${accent}55 100%)`,
        }}
      >
        <div className="shrink-0">
          <HeroToken klass={hero.klass} size={compact ? 30 : 42} color={accent} ring={isActive ? '#fff' : undefined} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold uppercase tracking-wider text-amber-950">
            {hero.username}
          </div>
          <div className="text-xs font-bold uppercase tracking-wider text-amber-900/90">
            {d.name}
          </div>
        </div>
        {isMine && (
          <div className="rounded-md bg-amber-950/30 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-100">
            You
          </div>
        )}
      </div>

      {/* Stat band: BP / MP / Atk / Def / Gold (+ items when compact) */}
      <div className={`px-3 ${compact ? 'space-y-1 py-1.5' : 'space-y-2 py-2'}`}>
        <BodyMindRow hero={hero} max={d.bodyMax} />
        <CombatRow hero={hero} />
        <GoldRow hero={hero} />
        {compact && <CompactItems hero={hero} />}
      </div>

      {!compact && (
        <>
          <FleurDivider width={220} />

          {/* Inventory grid (6 slots) */}
          <div className="px-3 py-2">
            <div className="mb-1 text-[9px] uppercase tracking-widest text-amber-900/80" style={{ fontFamily: 'serif' }}>
              Equipment
            </div>
            <InventoryGrid hero={hero} />
          </div>

          {/* Potions (if any found) */}
          {(hero.foundPotions?.length ?? 0) > 0 && (
            <>
              <FleurDivider width={220} />
              <div className="px-3 py-2">
                <div className="mb-1.5 text-[9px] uppercase tracking-widest text-amber-900/80" style={{ fontFamily: 'serif' }}>
                  Potions
                </div>
                <PotionRow
                  potions={hero.foundPotions}
                  hero={hero}
                  canUse={isMine && isMyTurn}
                  onUse={onUsePotion}
                />
              </div>
            </>
          )}

          {/* Spells (casters only) */}
          {hero.spells.length > 0 && (
            <>
              <FleurDivider width={220} />
              <div className="px-3 py-2">
                <div className="mb-1.5 text-[9px] uppercase tracking-widest text-amber-900/80" style={{ fontFamily: 'serif' }}>
                  Spells
                </div>
                <SpellGrid
                  hero={hero}
                  canCast={isMine && isMyTurn && !hero.hasActed}
                  onCast={onCastSpell}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function BodyMindRow({ hero, max }: { hero: Hero; max: number }) {
  // Render BP as up to N hearts (filled vs hollow).
  const bodyHearts = Array.from({ length: hero.bodyMax }, (_, i) => i < hero.body);
  const mindMarks  = Array.from({ length: hero.mindMax }, (_, i) => i < hero.mind);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="w-6 text-[10px] font-bold uppercase tracking-wide text-amber-950">BP</span>
        <div className="flex flex-wrap gap-0.5">
          {bodyHearts.map((on, i) => (
            <HeartIcon key={i} size={13} filled={on} />
          ))}
        </div>
        <span className="ml-auto text-xs font-bold tabular-nums text-amber-950">
          {hero.body}/{hero.bodyMax}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-6 text-[10px] font-bold uppercase tracking-wide text-amber-950">MP</span>
        <div className="flex flex-wrap gap-0.5">
          {mindMarks.map((on, i) => (
            <MindIcon key={i} size={13} filled={on} />
          ))}
        </div>
        <span className="ml-auto text-xs font-bold tabular-nums text-amber-950">
          {hero.mind}/{hero.mindMax}
        </span>
      </div>
    </div>
  );
}

function CombatRow({ hero }: { hero: Hero }) {
  return (
    <div className="grid grid-cols-2 gap-1">
      <div className="flex items-center gap-1.5 rounded-md bg-amber-950/15 px-2 py-1">
        <SwordIcon size={18} />
        <div className="leading-tight">
          <div className="text-[9px] uppercase tracking-wider text-amber-900/80">Attack</div>
          <div className="text-base font-bold text-amber-950 tabular-nums">{hero.attack}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 rounded-md bg-amber-950/15 px-2 py-1">
        <ShieldIcon size={18} />
        <div className="leading-tight">
          <div className="text-[9px] uppercase tracking-wider text-amber-900/80">Defend</div>
          <div className="text-base font-bold text-amber-950 tabular-nums">{hero.defense}</div>
        </div>
      </div>
    </div>
  );
}

function GoldRow({ hero }: { hero: Hero }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-amber-950/15 px-2 py-1">
      <CoinIcon size={16} />
      <span className="text-[9px] uppercase tracking-wider text-amber-900/80">Gold</span>
      <span className="ml-auto text-sm font-bold text-amber-950 tabular-nums">{hero.gold}</span>
    </div>
  );
}

/** Compact inventory line for the party panels — weapons, armor, potions and
 *  items as small chips so each hero's gear/consumables are visible at a glance. */
function CompactItems({ hero }: { hero: Hero }) {
  const icon = (k: string) =>
    k === 'weapon' ? '🗡️' : k === 'armor' ? '🛡️' : k === 'potion' ? '🧪' : k === 'tool' ? '🔧' : '✦';
  if (hero.items.length === 0) {
    return <div className="rounded-md bg-amber-950/10 px-2 py-1 text-[10px] italic text-amber-900/50">No items</div>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {hero.items.map((it, i) => (
        <span
          key={`${it.id}-${i}`}
          title={it.description ?? it.name}
          className="rounded bg-amber-950/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950"
        >
          {icon(it.kind)} {it.name}
        </span>
      ))}
    </div>
  );
}

function InventoryGrid({ hero }: { hero: Hero }) {
  const slots: (typeof hero.items[number] | null)[] = [...hero.items];
  while (slots.length < 6) slots.push(null);
  return (
    <div className="grid grid-cols-3 gap-1">
      {slots.slice(0, 6).map((it, i) => (
        <div
          key={i}
          className="aspect-square rounded border border-amber-900/40 bg-amber-950/10 flex flex-col items-center justify-center px-1"
          title={it ? `${it.name}${it.description ? ` — ${it.description}` : ''}` : 'Empty slot'}
        >
          {it ? (
            <>
              <span className="text-base">{itemIcon(it.kind)}</span>
              <span className="text-[8px] text-center text-amber-950 leading-tight line-clamp-1">{it.name}</span>
              {it.attack ? (
                <span className="text-[8px] text-rose-900 font-bold">{it.attack}A</span>
              ) : it.defense ? (
                <span className="text-[8px] text-blue-900 font-bold">+{it.defense}D</span>
              ) : null}
            </>
          ) : (
            <span className="text-amber-900/30 text-xl">·</span>
          )}
        </div>
      ))}
    </div>
  );
}

function itemIcon(kind: 'weapon' | 'armor' | 'tool' | 'potion' | 'artifact') {
  switch (kind) {
    case 'weapon':   return '⚔️';
    case 'armor':    return '🛡️';
    case 'tool':     return '🔧';
    case 'potion':   return '🧪';
    case 'artifact': return '✨';
  }
}

const POTION_ICON: Record<HeldPotion['effect'], string> = {
  brew:     '🍺',
  defense:  '🛡️',
  strength: '💪',
  heal_d6:  '🧪',
};

const POTION_COLOR: Record<HeldPotion['effect'], { bg: string; border: string; text: string }> = {
  brew:     { bg: 'bg-amber-900/30',   border: 'border-amber-600/60',   text: 'text-amber-200' },
  defense:  { bg: 'bg-blue-900/30',    border: 'border-blue-500/60',    text: 'text-blue-200'  },
  strength: { bg: 'bg-rose-900/30',    border: 'border-rose-500/60',    text: 'text-rose-200'  },
  heal_d6:  { bg: 'bg-emerald-900/30', border: 'border-emerald-600/60', text: 'text-emerald-200' },
};

/** Small row of held potion pills — each shows an icon + short name and can be
 *  clicked to use the potion during the hero's turn. */
function PotionRow({ potions, hero, canUse, onUse }: {
  potions: HeldPotion[] | undefined;
  hero: Hero;
  canUse: boolean;
  onUse?: (potionId: string) => void;
}) {
  if (!potions || potions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {potions.map(p => {
        const col = POTION_COLOR[p.effect];
        // Heroic Brew: disable if hero has already acted (must drink before attacking)
        const disabled = !canUse || (p.effect === 'brew' && hero.hasActed);
        const tip = disabled
          ? p.effect === 'brew' && hero.hasActed
            ? 'Heroic Brew must be drunk before attacking'
            : p.description
          : p.description;
        return (
          <button
            key={p.id}
            onClick={() => !disabled && onUse?.(p.id)}
            disabled={disabled}
            title={tip}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition
              ${col.bg} ${col.border} ${col.text}
              ${disabled ? 'cursor-default opacity-50' : 'cursor-pointer hover:brightness-125'}`}
          >
            <span>{POTION_ICON[p.effect]}</span>
            <span>{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function SpellGrid({ hero, canCast, onCast }: {
  hero: Hero;
  canCast: boolean;
  onCast: (spellId: string) => void;
}) {
  const byElement = useMemo(() => {
    const map: Record<Spell['element'], Spell[]> = { air: [], water: [], fire: [], earth: [] };
    for (const s of hero.spells) map[s.element].push(s);
    return map;
  }, [hero.spells]);

  const elementOrder: Spell['element'][] = ['air', 'water', 'fire', 'earth'];
  const elementMeta: Record<Spell['element'], { color: string; label: string; icon: string }> = {
    air:   { color: '#a8d8ff', label: 'Air',   icon: '🌀' },
    water: { color: '#74b5ff', label: 'Water', icon: '💧' },
    fire:  { color: '#ff7a3a', label: 'Fire',  icon: '🔥' },
    earth: { color: '#9a7a40', label: 'Earth', icon: '🪨' },
  };

  return (
    <div className="space-y-2">
      {elementOrder.map(el => {
        const spells = byElement[el];
        if (spells.length === 0) return null;
        const meta = elementMeta[el];
        return (
          <div key={el}>
            <div className="mb-0.5 flex items-center gap-1 text-[9px] uppercase tracking-widest" style={{ color: meta.color, fontFamily: 'serif' }}>
              <span>{meta.icon}</span>{meta.label}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {spells.map(sp => {
                const used = hero.spellsCast.includes(sp.id);
                return (
                  <button
                    key={sp.id}
                    onClick={() => canCast && !used && onCast(sp.id)}
                    disabled={!canCast || used}
                    className="rounded border px-1 py-1 text-left text-[9px] leading-tight transition disabled:opacity-50"
                    style={{
                      borderColor: meta.color,
                      background: used
                        ? 'rgba(60,40,20,0.3)'
                        : `linear-gradient(135deg, ${meta.color}33, transparent)`,
                      color: '#3a2a08',
                      cursor: canCast && !used ? 'pointer' : 'default',
                    }}
                    title={sp.text}
                  >
                    <div className="font-bold leading-none">{sp.name}</div>
                    <div className="mt-0.5 text-[8px] opacity-80 line-clamp-2">{sp.text}</div>
                    {used && <div className="text-[8px] text-amber-700">— Cast —</div>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Compact party roster (other heroes)
// ============================================================================

export function PartyRoster({
  state, currentUserId,
}: {
  state: HQState;
  currentUserId: string;
}) {
  return (
    <div className="rounded-lg border border-amber-900/50 bg-gradient-to-b from-amber-900/15 to-neutral-900 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-amber-200/70" style={{ fontFamily: 'serif' }}>
        Party
      </div>
      <div className="space-y-1">
        {state.heroes.map(h => {
          const dead = h.body <= 0;
          const me = h.playerId === currentUserId;
          const active = state.heroes[state.turnIndex]?.playerId === h.playerId;
          return (
            <div
              key={h.playerId}
              className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${
                dead ? 'opacity-40 line-through' : ''
              } ${active ? 'bg-amber-900/30' : ''}`}
            >
              <HeroToken klass={h.klass} size={22} color={safeAccent(h.accent_color)} />
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ color: safeAccent(h.accent_color), fontWeight: me ? 700 : 500 }}>
                  {h.username}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-amber-100/70">
                  <span className="flex items-center gap-0.5"><HeartIcon size={9} /> {h.body}/{h.bodyMax}</span>
                  <span className="flex items-center gap-0.5"><CoinIcon size={9} /> {h.gold}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
