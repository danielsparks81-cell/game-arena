'use client';

// Card sandbox UI. Three-column layout:
//   • Left:    pack metadata (className) + card list (click to edit)
//   • Center:  editor form for the current card (name / cost / classes /
//              teams / text / stats / effects[])
//   • Right:   live preview (renders HeroCardArt — identical to in-game)
//              + pack summary + Export TS button
//
// Persistence: the whole pack is auto-saved to localStorage on every change,
// so refreshing the page never loses work. There's no DB roundtrip — exporting
// produces a TypeScript file you paste into src/lib/games/legendary/heroes/.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { HeroCardArt, CLASS_COLORS, CLASS_LABELS } from '@/components/legendary/HeroCardArt';
import type { Effect, HeroCardDef, HeroClass, Team, VillainCardDef, HenchmanCardDef, MastermindCardDef, SchemeCardDef } from '@/lib/games/legendary';
import { ALL_HERO_CLASSES } from '@/lib/games/legendary/heroes/all-heroes';
import { HYDRA_GROUP } from '@/lib/games/legendary/villains/hydra';
import { HAND_NINJA_GROUP } from '@/lib/games/legendary/villains/hand-ninjas';
import { RED_SKULL } from '@/lib/games/legendary/masterminds/red-skull';
import { NEGATIVE_ZONE_PRISON_BREAKOUT } from '@/lib/games/legendary/schemes/prison-breakout';
import { TROOPER, AGENT, OFFICER, SIDEKICK } from '@/lib/games/legendary/heroes/shield';
import { WOUND, BYSTANDER, MASTER_STRIKE, SCHEME_TWIST, MASTER_STRIKES_IN_DECK } from '@/lib/games/legendary';
import type { WoundCardDef, BystanderCardDef, MasterStrikeCardDef, SchemeTwistCardDef } from '@/lib/games/legendary';

// ---------------------------------------------------------------------------
// Types + storage
// ---------------------------------------------------------------------------

type CardInPack = { def: HeroCardDef; copies: number };
type Pack = {
  className: string;       // hero class name, e.g. "Captain America"
  description?: string;    // optional notes; appears as a comment in exported TS
  cards: CardInPack[];
};

const STORAGE_KEY = 'legendary-sandbox-pack-v1';

type SandboxMode = 'browse' | 'author-hero' | 'author-villain' | 'author-henchman' | 'author-mastermind' | 'author-scheme';

function emptyPack(): Pack {
  return { className: '', cards: [] };
}

function emptyDraft(): HeroCardDef {
  return {
    kind: 'hero',
    cardId: '',
    className: '',
    cardName: '',
    cost: 1,
    classes: [],
    teams: [],
  };
}

// ---------------------------------------------------------------------------
// Effect kinds — kept in sync with src/lib/games/legendary/types.ts
// (the EffectKind union). When you add a new effect type to the engine,
// add it here too so the sandbox can author it.
// ---------------------------------------------------------------------------

type EffectKind = Effect['kind'];

const EFFECT_KINDS: { kind: EffectKind; label: string; description: string }[] = [
  { kind: 'gain_attack',                label: '+Strike',             description: 'Add to this turn\'s Strike pool.' },
  { kind: 'gain_recruit',               label: '+Recruit',            description: 'Add to this turn\'s Recruit pool.' },
  { kind: 'draw',                       label: 'Draw cards',          description: 'Draw N cards from your deck.' },
  { kind: 'gain_wound',                 label: 'Take a Wound',        description: 'Give the player a Wound (clutter card).' },
  { kind: 'rescue_bystander',           label: 'Rescue Bystanders',   description: 'Take N bystanders from the rescue stack.' },
  { kind: 'ko_from_hand',               label: 'KO from hand',        description: 'May KO up to N cards from your hand. (Player choice — currently a no-op in MVP.)' },
  { kind: 'discard_from_hand',          label: 'Discard from hand',   description: 'Discard up to N cards from your hand. (Player choice — currently a no-op in MVP.)' },
  { kind: 'if_played_class_this_turn',  label: 'If played class ≥ N', description: 'Conditional: fires nested effects when you\'ve played ≥ N OTHER cards of this class this turn.' },
  { kind: 'if_played_team_this_turn',   label: 'If played team ≥ N',  description: 'Conditional: fires nested effects when you\'ve played ≥ N OTHER cards of this team this turn.' },
];

// All teams known to the engine.
const ALL_TEAMS: Team[] = [
  'avengers', 'x-men', 'spider-friends', 'fantastic-four',
  'shield-officer', 'shield-agent', 'shield-trooper',
  'hydra', 'brotherhood', 'masters-of-evil', 'enemies-of-asgard',
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function LegendarySandbox() {
  const [mode, setMode]           = useState<SandboxMode>('browse');
  const [pack, setPack]           = useState<Pack>(emptyPack);
  const [draft, setDraft]         = useState<HeroCardDef>(emptyDraft);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [copies, setCopies]       = useState(5);
  const [hydrated, setHydrated]   = useState(false);

  // Load from localStorage on mount (browser-only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Pack;
        if (parsed && Array.isArray(parsed.cards)) setPack(parsed);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  // Auto-save on every pack change (after hydration so we don't immediately
  // overwrite saved state with the empty initial pack).
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pack)); } catch {}
  }, [pack, hydrated]);

  // Auto-fill className on the draft from the pack's className when creating
  // new cards (so you don't have to retype it every card).
  useEffect(() => {
    if (editingIdx !== null) return; // editing — leave className alone
    if (!pack.className) return;
    if (draft.className === pack.className) return;
    setDraft(d => ({ ...d, className: pack.className }));
  }, [pack.className, editingIdx, draft.className]);

  // Auto-derive cardId from className + cardName when creating new cards.
  useEffect(() => {
    if (editingIdx !== null) return;
    const id = slugCardId(draft.className, draft.cardName);
    if (id !== draft.cardId) setDraft(d => ({ ...d, cardId: id }));
  }, [draft.className, draft.cardName, editingIdx, draft.cardId]);

  const validationError = validateDraft(draft, pack.cards, editingIdx);

  function startNewCard() {
    setEditingIdx(null);
    setDraft({ ...emptyDraft(), className: pack.className });
    setCopies(5);
  }
  function editCard(idx: number) {
    const c = pack.cards[idx];
    if (!c) return;
    setEditingIdx(idx);
    setDraft(structuredClone(c.def));
    setCopies(c.copies);
  }
  function removeCard(idx: number) {
    setPack(p => ({ ...p, cards: p.cards.filter((_, i) => i !== idx) }));
    if (editingIdx === idx) startNewCard();
  }
  function saveCard() {
    if (validationError) return;
    setPack(p => {
      const cards = [...p.cards];
      const card: CardInPack = { def: structuredClone(draft), copies };
      if (editingIdx !== null) cards[editingIdx] = card;
      else cards.push(card);
      return { ...p, cards };
    });
    if (editingIdx === null) startNewCard();
  }

  function clearPack() {
    if (!confirm('Clear the entire pack? This cannot be undone.')) return;
    setPack(emptyPack());
    startNewCard();
  }

  if (mode === 'browse') {
    return <CardBrowser onAuthor={(type) => setMode(type)} />;
  }

  if (mode === 'author-villain') {
    return <VillainAuthor onBack={() => setMode('browse')} />;
  }

  if (mode === 'author-henchman') {
    return <HenchmanAuthor onBack={() => setMode('browse')} />;
  }

  if (mode === 'author-mastermind') {
    return <MastermindAuthor onBack={() => setMode('browse')} />;
  }

  if (mode === 'author-scheme') {
    return <SchemeAuthor onBack={() => setMode('browse')} />;
  }

  // mode === 'author-hero'
  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Legendary Card Sandbox</h1>
          <p className="text-xs text-neutral-500">
            Author hero card packs. Auto-saved locally. Export as TypeScript when ready and paste into{' '}
            <code className="rounded bg-neutral-800 px-1">src/lib/games/legendary/heroes/</code>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMode('browse')}
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            ← Browse hero packs
          </button>
          <Link href="/lobby" className="text-xs text-neutral-400 hover:text-neutral-200">← lobby</Link>
        </div>
      </header>

      {/* Pack header */}
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Class name (hero group)</span>
          <input
            value={pack.className}
            onChange={e => setPack(p => ({ ...p, className: e.target.value }))}
            placeholder="e.g. Captain America"
            className="w-64 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
        <div className="ml-auto flex gap-2">
          <button
            onClick={clearPack}
            className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:border-rose-500 hover:text-rose-300"
          >
            Clear pack
          </button>
          <ExportButton pack={pack} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr_280px]">
        {/* ===== LEFT: card list ===== */}
        <aside className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Cards in pack</span>
            <span className="text-xs font-mono text-neutral-400">{pack.cards.length}</span>
          </div>
          {pack.cards.length === 0 && (
            <div className="rounded border border-dashed border-neutral-800 p-3 text-center text-[11px] text-neutral-600">
              No cards yet. Fill out the editor →
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {pack.cards.map((c, i) => (
              <li key={c.def.cardId + i}>
                <div
                  className={`flex items-center gap-1 rounded border px-2 py-1.5 text-xs ${
                    editingIdx === i ? 'border-emerald-500 bg-emerald-500/5' : 'border-neutral-800 hover:border-neutral-600'
                  }`}
                >
                  <button
                    onClick={() => editCard(i)}
                    className="flex flex-1 items-baseline gap-1 truncate text-left text-neutral-200"
                  >
                    <span className="font-mono text-[10px] text-neutral-500">{c.copies}×</span>
                    <span className="truncate">{c.def.cardName || '(unnamed)'}</span>
                    <span className="ml-auto font-mono text-[10px] text-neutral-500">{c.def.cost}🪙</span>
                  </button>
                  <button
                    onClick={() => removeCard(i)}
                    className="text-[10px] text-neutral-600 hover:text-rose-400"
                    aria-label="Remove"
                    title="Remove from pack"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            onClick={startNewCard}
            className="mt-2 rounded border border-emerald-700 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:border-emerald-400 hover:bg-emerald-500/20"
          >
            + New card
          </button>
        </aside>

        {/* ===== CENTER: editor form ===== */}
        <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">
              {editingIdx !== null ? `Editing: ${pack.cards[editingIdx]?.def.cardName || '(unnamed)'}` : 'New card'}
            </h2>
            {editingIdx !== null && (
              <button
                onClick={startNewCard}
                className="text-[10px] text-neutral-500 hover:text-neutral-300"
              >
                cancel — back to new card
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Card name">
              <input
                value={draft.cardName}
                onChange={e => setDraft(d => ({ ...d, cardName: e.target.value }))}
                placeholder="e.g. Astonishing Strength"
                className={input()}
              />
            </Field>
            <Field label="Cost (🪙)">
              <input
                type="number" min={0} max={20}
                value={draft.cost}
                onChange={e => setDraft(d => ({ ...d, cost: clampInt(e.target.value, 0, 20) }))}
                className={input()}
              />
            </Field>
            <Field label="Base Strike (⚔)">
              <input
                type="number" min={0} max={20}
                value={draft.baseAttack ?? 0}
                onChange={e => setDraft(d => ({ ...d, baseAttack: clampInt(e.target.value, 0, 20) || undefined }))}
                className={input()}
              />
            </Field>
            <Field label="Base Recruit (★)">
              <input
                type="number" min={0} max={20}
                value={draft.baseRecruit ?? 0}
                onChange={e => setDraft(d => ({ ...d, baseRecruit: clampInt(e.target.value, 0, 20) || undefined }))}
                className={input()}
              />
            </Field>
            <Field label="Copies in deck">
              <input
                type="number" min={1} max={14}
                value={copies}
                onChange={e => setCopies(clampInt(e.target.value, 1, 14))}
                className={input()}
              />
              <span className="mt-0.5 text-[10px] text-neutral-600">Typical: 5 / 5 / 4 (common / uncommon / rare) summing to 14.</span>
            </Field>
            <Field label="Card id (auto)">
              <input
                value={draft.cardId}
                onChange={e => setDraft(d => ({ ...d, cardId: e.target.value }))}
                className={`${input()} font-mono`}
              />
              <span className="mt-0.5 text-[10px] text-neutral-600">Auto-derived from name. Edit if you need to override.</span>
            </Field>
          </div>

          <Field label="Classes (multi)">
            <ChipPicker
              all={Object.keys(CLASS_COLORS) as HeroClass[]}
              selected={draft.classes}
              labelOf={k => CLASS_LABELS[k]}
              colorOf={k => CLASS_COLORS[k]}
              onChange={cls => setDraft(d => ({ ...d, classes: cls }))}
            />
          </Field>

          <Field label="Teams (multi)">
            <ChipPicker
              all={ALL_TEAMS}
              selected={draft.teams}
              labelOf={t => t}
              colorOf={() => '#525252'}
              onChange={teams => setDraft(d => ({ ...d, teams }))}
            />
          </Field>

          <Field label="Card text (for hover / rules display)">
            <textarea
              value={draft.text ?? ''}
              onChange={e => setDraft(d => ({ ...d, text: e.target.value || undefined }))}
              placeholder="e.g. Strike +2. If you played another Hulk this turn, draw a card."
              rows={2}
              className={`${input()} resize-none`}
            />
          </Field>

          <Field label="On-play effects">
            <EffectsEditor
              effects={draft.onPlay ?? []}
              onChange={effects => setDraft(d => ({ ...d, onPlay: effects.length > 0 ? effects : undefined }))}
            />
          </Field>

          {/* Save row */}
          <div className="mt-4 flex items-center justify-between gap-2">
            {validationError ? (
              <span className="text-xs text-rose-400">{validationError}</span>
            ) : (
              <span className="text-xs text-neutral-500">
                {editingIdx !== null ? 'Saves over the existing card.' : 'Adds a new card to the pack.'}
              </span>
            )}
            <button
              onClick={saveCard}
              disabled={!!validationError}
              className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              {editingIdx !== null ? 'Save changes' : 'Add to pack'}
            </button>
          </div>
        </section>

        {/* ===== RIGHT: live preview ===== */}
        <aside className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">Live preview</div>
            <div className="flex items-center justify-center rounded-md bg-neutral-900/60 p-3">
              <HeroCardArt def={draft} copies={copies} />
            </div>
          </div>

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">Pack summary</div>
            <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 text-xs text-neutral-300">
              <div className="font-semibold text-neutral-100">{pack.className || '(unnamed class)'}</div>
              <div className="mt-1 flex justify-between text-neutral-500">
                <span>{pack.cards.length} unique cards</span>
                <span>{pack.cards.reduce((s, c) => s + c.copies, 0)} copies</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Effects editor (recursive — supports nested effects for conditionals)
// ---------------------------------------------------------------------------

function EffectsEditor({
  effects, onChange, nested = false,
}: {
  effects: Effect[];
  onChange: (next: Effect[]) => void;
  nested?: boolean;
}) {
  function update(i: number, eff: Effect) {
    const next = [...effects]; next[i] = eff;
    onChange(next);
  }
  function remove(i: number) {
    onChange(effects.filter((_, j) => j !== i));
  }
  function add(kind: EffectKind) {
    onChange([...effects, defaultEffectForKind(kind)]);
  }

  return (
    <div className={`flex flex-col gap-2 ${nested ? 'rounded border border-neutral-800/60 bg-neutral-900/30 p-2' : ''}`}>
      {effects.length === 0 && (
        <div className="rounded border border-dashed border-neutral-800 p-2 text-center text-[10px] text-neutral-600">
          No effects. Card is a pure stat-stick.
        </div>
      )}
      {effects.map((eff, i) => (
        <EffectRow
          key={i}
          effect={eff}
          onChange={e => update(i, e)}
          onRemove={() => remove(i)}
        />
      ))}
      <details className="text-xs">
        <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">+ add effect</summary>
        <div className="mt-1 flex flex-wrap gap-1">
          {EFFECT_KINDS.map(({ kind, label, description }) => (
            <button
              key={kind}
              onClick={() => add(kind)}
              title={description}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-300 hover:border-emerald-500 hover:text-emerald-300"
            >
              {label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

function EffectRow({
  effect, onChange, onRemove,
}: {
  effect: Effect;
  onChange: (next: Effect) => void;
  onRemove: () => void;
}) {
  const meta = EFFECT_KINDS.find(k => k.kind === effect.kind);
  return (
    <div className="flex items-start gap-2 rounded border border-neutral-800 bg-neutral-900/60 p-2">
      <div className="flex-1">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-xs font-medium text-neutral-200">{meta?.label ?? effect.kind}</span>
          <span className="text-[9px] text-neutral-600">{effect.kind}</span>
        </div>
        <EffectParams effect={effect} onChange={onChange} />
      </div>
      <button
        onClick={onRemove}
        className="text-[11px] text-neutral-600 hover:text-rose-400"
        aria-label="Remove effect"
        title="Remove effect"
      >
        ✕
      </button>
    </div>
  );
}

function EffectParams({ effect, onChange }: { effect: Effect; onChange: (next: Effect) => void }) {
  switch (effect.kind) {
    case 'gain_attack':
    case 'gain_recruit':
    case 'draw':
    case 'rescue_bystander':
      return (
        <Field label="Amount" inline>
          <input
            type="number" min={1} max={20}
            value={effect.amount}
            onChange={e => onChange({ ...effect, amount: clampInt(e.target.value, 0, 20) })}
            className={inputSm()}
          />
        </Field>
      );
    case 'gain_wound':
      return <div className="text-[10px] text-neutral-500">No parameters.</div>;
    case 'ko_from_hand':
    case 'discard_from_hand':
      return (
        <>
          <Field label="Up to" inline>
            <input
              type="number" min={1} max={10}
              value={effect.up_to}
              onChange={e => onChange({ ...effect, up_to: clampInt(e.target.value, 1, 10) })}
              className={inputSm()}
            />
          </Field>
          <Field label="Bonus effects (if player does)">
            <EffectsEditor
              nested
              effects={effect.bonus ?? []}
              onChange={bonus => onChange({ ...effect, bonus })}
            />
          </Field>
          <div className="mt-1 text-[10px] text-amber-500">
            ⚠ Player-choice mechanic — currently a no-op in the engine. Sandboxes for future use.
          </div>
        </>
      );
    case 'if_played_class_this_turn':
      return (
        <>
          <Field label="Class" inline>
            <select
              value={effect.cls}
              onChange={e => onChange({ ...effect, cls: e.target.value as HeroClass })}
              className={inputSm()}
            >
              {(Object.keys(CLASS_LABELS) as HeroClass[]).map(c => (
                <option key={c} value={c}>{CLASS_LABELS[c]}</option>
              ))}
            </select>
          </Field>
          <Field label="Min others" inline>
            <input
              type="number" min={1} max={5}
              value={effect.minOthers}
              onChange={e => onChange({ ...effect, minOthers: clampInt(e.target.value, 1, 5) })}
              className={inputSm()}
            />
          </Field>
          <Field label="Then resolve">
            <EffectsEditor
              nested
              effects={effect.effects}
              onChange={effects => onChange({ ...effect, effects })}
            />
          </Field>
        </>
      );
    case 'if_played_team_this_turn':
      return (
        <>
          <Field label="Team" inline>
            <select
              value={effect.team}
              onChange={e => onChange({ ...effect, team: e.target.value as Team })}
              className={inputSm()}
            >
              {ALL_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Min others" inline>
            <input
              type="number" min={1} max={5}
              value={effect.minOthers}
              onChange={e => onChange({ ...effect, minOthers: clampInt(e.target.value, 1, 5) })}
              className={inputSm()}
            />
          </Field>
          <Field label="Then resolve">
            <EffectsEditor
              nested
              effects={effect.effects}
              onChange={effects => onChange({ ...effect, effects })}
            />
          </Field>
        </>
      );
  }
}

function defaultEffectForKind(kind: EffectKind): Effect {
  switch (kind) {
    case 'gain_attack':                return { kind, amount: 1 };
    case 'gain_recruit':               return { kind, amount: 1 };
    case 'draw':                       return { kind, amount: 1 };
    case 'rescue_bystander':           return { kind, amount: 1 };
    case 'gain_wound':                 return { kind };
    case 'ko_from_hand':               return { kind, up_to: 1 };
    case 'discard_from_hand':          return { kind, up_to: 1 };
    case 'if_played_class_this_turn':  return { kind, cls: 'strength', minOthers: 1, effects: [] };
    case 'if_played_team_this_turn':   return { kind, team: 'avengers', minOthers: 1, effects: [] };
  }
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

function Field({ label, children, inline = false }: { label: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <label className={`flex ${inline ? 'flex-row items-center gap-2' : 'mt-2 flex-col gap-1'}`}>
      <span className={`text-[10px] uppercase tracking-wider text-neutral-500 ${inline ? '' : ''}`}>{label}</span>
      {children}
    </label>
  );
}

function input() {
  return 'rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-emerald-500';
}
function inputSm() {
  return 'rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-100 outline-none focus:border-emerald-500';
}

function ChipPicker<T extends string>({
  all, selected, labelOf, colorOf, onChange,
}: {
  all: readonly T[];
  selected: T[];
  labelOf: (k: T) => string;
  colorOf: (k: T) => string;
  onChange: (next: T[]) => void;
}) {
  const sel = new Set(selected);
  function toggle(k: T) {
    if (sel.has(k)) onChange(selected.filter(x => x !== k));
    else            onChange([...selected, k]);
  }
  return (
    <div className="flex flex-wrap gap-1">
      {all.map(k => {
        const on = sel.has(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
              on ? 'border-emerald-500 bg-emerald-500/10 text-neutral-100' : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500'
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full border border-black/30"
              style={{ backgroundColor: colorOf(k) }}
            />
            {labelOf(k)}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation + utilities
// ---------------------------------------------------------------------------

function clampInt(v: string, lo: number, hi: number): number {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function slugCardId(className: string, cardName: string): string {
  if (!cardName) return '';
  const classSlug = className.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const nameSlug  = cardName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return classSlug ? `${classSlug}_${nameSlug}` : nameSlug;
}

function validateDraft(draft: HeroCardDef, existing: CardInPack[], editingIdx: number | null): string | null {
  if (!draft.cardName.trim()) return 'Card name is required';
  if (!draft.className.trim()) return 'Set the pack\'s class name above first';
  if (!draft.cardId.trim()) return 'Card id missing';
  if (draft.cost < 0) return 'Cost cannot be negative';
  // Duplicate cardId check (skip the slot being edited)
  for (let i = 0; i < existing.length; i++) {
    if (i === editingIdx) continue;
    if (existing[i].def.cardId === draft.cardId) return `cardId "${draft.cardId}" already exists in the pack`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Export button — generates TypeScript and downloads or copies it.
// ---------------------------------------------------------------------------

function ExportButton({ pack }: { pack: Pack }) {
  const [copied, setCopied] = useState(false);
  const ts = useMemo(() => generateTypeScript(pack), [pack]);
  const canExport = pack.cards.length > 0 && pack.className.trim() !== '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(ts);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  const dl = useRef<HTMLAnchorElement | null>(null);
  function download() {
    const blob = new Blob([ts], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);
    const a = dl.current ?? document.createElement('a');
    a.href = url;
    a.download = `${pack.className.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ts`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex gap-1">
      <button
        onClick={copy}
        disabled={!canExport}
        className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-black hover:bg-emerald-400 disabled:bg-neutral-700 disabled:text-neutral-500"
      >
        {copied ? '✓ Copied' : 'Copy TS'}
      </button>
      <button
        onClick={download}
        disabled={!canExport}
        className="rounded border border-emerald-700 px-3 py-1 text-xs text-emerald-300 hover:border-emerald-400 disabled:border-neutral-700 disabled:text-neutral-500"
      >
        Download .ts
      </button>
      <a ref={dl} className="hidden" />
    </div>
  );
}

/**
 * Emit a TypeScript file for the pack matching the in-repo style:
 *   - one `export const NAME: HeroCardDef = {...}` per card
 *   - one trailing `export const CLASSNAME_CLASS = { className, cards: [...] }`
 *
 * Output is paste-ready into `src/lib/games/legendary/heroes/<classname>.ts`.
 * Includes the import header and the registry-wiring reminder as a comment.
 */
function generateTypeScript(pack: Pack): string {
  const constName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const className = pack.className || 'UnnamedClass';
  const classConst = `${constName(className)}_CLASS`;

  const cardConsts = pack.cards.map(({ def, copies }) => {
    const cName = constName(`${className}_${def.cardName}`);
    return { cName, copies, body: tsForCard(def) };
  });

  const lines: string[] = [];
  lines.push(`// Generated by /legendary-sandbox. Paste into`);
  lines.push(`// src/lib/games/legendary/heroes/${className.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ts`);
  lines.push(`// Then add the class to HERO_CLASSES in src/lib/games/legendary/cards.ts.`);
  lines.push('');
  lines.push(`import type { HeroCardDef } from '../types';`);
  lines.push('');
  for (const { cName, body } of cardConsts) {
    lines.push(`export const ${cName}: HeroCardDef = ${body};`);
    lines.push('');
  }
  lines.push(`export const ${classConst} = {`);
  lines.push(`  className: ${JSON.stringify(className)},`);
  lines.push(`  cards: [`);
  for (const { cName, copies } of cardConsts) {
    lines.push(`    { def: ${cName}, copies: ${copies} },`);
  }
  lines.push(`  ],`);
  lines.push(`};`);
  lines.push('');
  return lines.join('\n');
}

/** Stringify a card def as TypeScript, dropping undefined fields. */
function tsForCard(def: HeroCardDef): string {
  // We build the object literal manually to keep the field order stable and
  // skip undefineds (which JSON.stringify would just drop, but we also want
  // to maintain readable indentation).
  const lines: string[] = ['{'];
  const push = (k: string, v: unknown) => {
    if (v === undefined) return;
    lines.push(`  ${k}: ${tsValue(v)},`);
  };
  push('kind', 'hero');
  push('cardId', def.cardId);
  push('className', def.className);
  push('cardName', def.cardName);
  push('cost', def.cost);
  push('baseAttack', def.baseAttack);
  push('baseRecruit', def.baseRecruit);
  push('classes', def.classes);
  push('teams', def.teams);
  push('text', def.text);
  push('onPlay', def.onPlay);
  lines.push('}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Card browser — read-only view of ALL base-set cards with type filter
// ---------------------------------------------------------------------------

type CardFilter = 'heroes' | 'starters' | 'villains' | 'henchmen' | 'mastermind' | 'scheme';

const FILTER_TABS: { id: CardFilter; label: string; badge: string }[] = [
  { id: 'heroes',      label: 'Heroes',      badge: '15 classes' },
  { id: 'starters',   label: 'Generic Cards', badge: 'S.H.I.E.L.D. + System' },
  { id: 'villains',   label: 'Villains',    badge: 'HYDRA' },
  { id: 'henchmen',   label: 'Henchmen',    badge: 'Hand Ninjas' },
  { id: 'mastermind', label: 'Mastermind',  badge: 'Red Skull' },
  { id: 'scheme',     label: 'Scheme',      badge: 'Negative Zone' },
];

function CardBrowser({ onAuthor }: { onAuthor: (type: SandboxMode) => void }) {
  const [filter, setFilter] = useState<CardFilter>('heroes');
  const [showTypePicker, setShowTypePicker] = useState(false);

  if (showTypePicker) {
    return <AuthorTypePicker onSelect={onAuthor} onBack={() => setShowTypePicker(false)} />;
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Legendary Card Sandbox</h1>
          <p className="text-xs text-neutral-500">
            Browse all base-set cards. Verify against your physical collection.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTypePicker(true)}
            className="rounded border border-emerald-700 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 hover:border-emerald-400"
          >
            ✍ Author new pack
          </button>
          <Link href="/lobby" className="text-xs text-neutral-400 hover:text-neutral-200">← lobby</Link>
        </div>
      </header>

      {/* Type filter tab bar */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-neutral-800 bg-neutral-950/60 p-1">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              filter === tab.id
                ? 'bg-neutral-700 text-neutral-100'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
            }`}
          >
            {tab.label}
            <span className={`text-[10px] ${filter === tab.id ? 'text-neutral-400' : 'text-neutral-600'}`}>
              {tab.badge}
            </span>
          </button>
        ))}
      </div>

      {/* Section content */}
      {filter === 'heroes'      && <HeroSection />}
      {filter === 'starters'   && <StartersSection />}
      {filter === 'villains'   && <VillainsSection />}
      {filter === 'henchmen'   && <HenchmenSection />}
      {filter === 'mastermind' && <MastermindSection />}
      {filter === 'scheme'     && <SchemeSection />}
    </div>
  );
}

// ─── Hero class section ───────────────────────────────────────────────────────

function HeroSection() {
  const sorted = [...ALL_HERO_CLASSES].sort((a, b) => a.className.localeCompare(b.className));
  const [selectedIdx, setSelectedIdx] = useState(0);
  const heroClass = sorted[selectedIdx];

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Left: class list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
          Hero classes ({ALL_HERO_CLASSES.length})
        </div>
        {sorted.map((hc, i) => (
          <button
            key={hc.className}
            onClick={() => setSelectedIdx(i)}
            className={`rounded px-2 py-1.5 text-left text-sm transition ${
              i === selectedIdx
                ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/40'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {hc.className}
            <span className="ml-1 text-[10px] text-neutral-500">
              ({hc.cards.reduce((s, c) => s + c.copies, 0)})
            </span>
          </button>
        ))}
      </aside>

      {/* Right: cards grid */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-neutral-100">{heroClass.className}</h2>
          <span className="text-xs text-neutral-500">
            {heroClass.cards.length} unique · {heroClass.cards.reduce((s, c) => s + c.copies, 0)} copies
          </span>
        </div>
        <div className="flex flex-wrap gap-6">
          {heroClass.cards.map(({ def, copies }) => (
            <div key={def.cardId} className="flex flex-col items-center gap-2">
              <HeroCardArt def={def} copies={copies} />
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span className="font-mono">{copies}×</span>
                <span>{copies === 1 ? 'rare' : copies === 3 ? 'uncommon' : 'common'}</span>
              </div>
              {def.text && (
                <div className="w-[220px] rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[10px] leading-snug text-neutral-400">
                  {def.text}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Generic / system cards section ─────────────────────────────────────────

type GenericCategory =
  | 'trooper'
  | 'agent'
  | 'officer'
  | 'sidekick'
  | 'wound'
  | 'bystander'
  | 'master_strike'
  | 'scheme_twist';

const GENERIC_CATEGORIES: { id: GenericCategory; label: string; sub: string }[] = [
  { id: 'trooper',       label: 'S.H.I.E.L.D. Trooper',   sub: 'Starter · 4× per player' },
  { id: 'agent',         label: 'S.H.I.E.L.D. Agent',     sub: 'Starter · 8× per player' },
  { id: 'officer',       label: 'Maria Hill',              sub: 'S.H.I.E.L.D. Officer · Pool card' },
  { id: 'sidekick',      label: 'Sidekick',                sub: 'Pool card' },
  { id: 'wound',         label: 'Wound',                   sub: 'System card' },
  { id: 'bystander',     label: 'Bystander',               sub: 'System card' },
  { id: 'master_strike', label: 'Master Strike',           sub: 'Villain deck' },
  { id: 'scheme_twist',  label: 'Scheme Twist',            sub: 'Villain deck' },
];

function StartersSection() {
  const [selected, setSelected] = useState<GenericCategory>('trooper');

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      {/* Left: category list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">Card type</div>
        {GENERIC_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelected(cat.id)}
            className={`rounded px-2 py-1.5 text-left transition ${
              selected === cat.id
                ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/40'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            <div className="text-sm">{cat.label}</div>
            <div className="text-[10px] text-neutral-500">{cat.sub}</div>
          </button>
        ))}
      </aside>

      {/* Right: cards for selected category */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
        {selected === 'trooper'        && <GenericSingleCardPanel def={TROOPER} copies={4} countLabel="4× per player · starter (12-card deck)" description="Colorless Hero class, S.H.I.E.L.D. team. Gives 1 ⚔ when played. Cost 0 — not buyable, only in starting deck." cardStyle={{ background: 'linear-gradient(135deg, #7a7a7a, #686868)' }} lightBg />}
        {selected === 'agent'          && <GenericSingleCardPanel def={AGENT}   copies={8} countLabel="8× per player · starter (12-card deck)" description="Colorless Hero class, S.H.I.E.L.D. team. Gives 1 ★ when played. Cost 0 — not buyable, only in starting deck." cardStyle={{ background: 'linear-gradient(135deg, #7a7a7a, #686868)' }} lightBg />}
        {selected === 'officer'       && <GenericOfficerPanel />}
        {selected === 'sidekick'      && <GenericSidekickPanel />}
        {selected === 'wound'         && <GenericWoundPanel />}
        {selected === 'bystander'     && <GenericBystanderPanel />}
        {selected === 'master_strike' && <GenericMasterStrikePanel />}
        {selected === 'scheme_twist'  && <GenericSchemeTwistPanel />}
      </section>
    </div>
  );
}

// ── panels ───────────────────────────────────────────────────────────────────

function GenericSingleCardPanel({
  def, copies, countLabel, description, cardStyle, lightBg,
}: {
  def: HeroCardDef;
  copies: number;
  countLabel: string;
  description: string;
  cardStyle?: React.CSSProperties;
  lightBg?: boolean;
}) {
  return (
    <>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-neutral-100">{def.cardName}</h2>
        <p className="mt-1 text-xs text-neutral-500">{description}</p>
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col items-start gap-2">
          <HeroCardArt def={def} copies={copies} style={cardStyle} lightBg={lightBg} />
          <div className="text-xs text-neutral-500">{countLabel}</div>
        </div>
      </div>
    </>
  );
}

function GenericOfficerPanel() {
  return (
    <>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-neutral-100">Maria Hill <span className="text-sm font-normal text-neutral-500">— S.H.I.E.L.D. Officer</span></h2>
        <p className="mt-1 text-xs text-neutral-500">
          Always available to recruit — sits in a pool beside the board, not the HQ.
          Any player can spend {OFFICER.cost} Recruit to add one to their discard.
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col items-start gap-2">
          <HeroCardArt def={OFFICER} copies={30} style={{ background: 'linear-gradient(135deg, #7a7a7a, #686868)' }} lightBg />
          <div className="text-xs text-neutral-500">Pool of 30</div>
        </div>
      </div>
    </>
  );
}

function GenericSidekickPanel() {
  return (
    <>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-neutral-100">Sidekick</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Always available to recruit — sits in a pool beside the board, not the HQ.
          No team, no class color. Cost {SIDEKICK.cost} to recruit.
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col items-start gap-2">
          <HeroCardArt def={SIDEKICK} copies={30} style={{ background: 'linear-gradient(135deg, #7a7a7a, #686868)' }} lightBg />
          <div className="text-xs text-neutral-500">Pool of 30</div>
        </div>
      </div>
    </>
  );
}

/** Unified system card — name perfectly centered, optional VP centered-right. */
function SystemCardArt({ name, borderColor, vp, bg }: { name: string; borderColor: string; vp?: number; bg?: string }) {
  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid', background: bg }}
      className="relative flex h-36 w-[220px] items-center justify-center rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950"
    >
      <span className="text-[14px] font-bold text-neutral-100">{name}</span>
      {vp !== undefined && (
        <div
          aria-label={`${vp} VP`}
          className="absolute right-1 top-1/2 -translate-y-1/2 flex h-[26px] w-[26px] items-center justify-center rounded-full font-sans text-[11px] font-bold shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
          style={{ backgroundColor: '#b91c1c', border: '1px solid #ef4444', color: '#fff' }}
        >
          {vp}
        </div>
      )}
    </div>
  );
}

function GenericWoundPanel() {
  return (
    <>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-neutral-100">Wound</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Clutter. Taken when a Master Strike fires or a villain's fight/escape effect deals damage.
          Counts against your VP total. 30 total in the wound stack.
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col items-start gap-2">
          <SystemCardArt name="Wound" borderColor="#7a3030" bg="linear-gradient(135deg, #6b2525, #5a1e1e)" />
          <div className="text-xs text-neutral-500">30 in wound stack</div>
        </div>
      </div>
    </>
  );
}

function GenericBystanderPanel() {
  return (
    <>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-neutral-100">Bystander</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Civilians caught up in the fight. Attached to villain cards when they are revealed.
          Rescue a bystander by defeating the villain carrying it — worth 1 VP per bystander.
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col items-start gap-2">
          <SystemCardArt name="Bystander" borderColor="#c4a800" vp={1} bg="linear-gradient(135deg, #c4a800, #a08600)" />
          <div className="text-xs text-neutral-500">30 in bystander stack</div>
        </div>
      </div>
    </>
  );
}

function GenericMasterStrikePanel() {
  return (
    <>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-neutral-100">Master Strike</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Shuffled into the Villain Deck. When revealed, the Mastermind's strike effect fires
          against every player simultaneously. The card is KO'd (does not enter the City).
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col items-start gap-2">
          <SystemCardArt name="Master Strike" borderColor="#8a5800" bg="linear-gradient(135deg, #7a4800, #5c3600)" />
          <div className="text-xs text-neutral-500">{MASTER_STRIKES_IN_DECK} copies in Villain Deck</div>
        </div>
      </div>
    </>
  );
}

function GenericSchemeTwistPanel() {
  const scheme = NEGATIVE_ZONE_PRISON_BREAKOUT;
  return (
    <>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-neutral-100">Scheme Twist</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Shuffled into the Villain Deck. When revealed, the scheme's twist effect fires and the
          twist counter ticks up. Evil Wins when the counter hits the threshold.
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col items-start gap-2">
          <SystemCardArt name="Scheme Twist" borderColor="#4a2880" bg="linear-gradient(135deg, #3a2068, #2d1855)" />
          <div className="text-xs text-neutral-500">{scheme.twists} copies · evil wins after {scheme.evilWinsAfterTwists} twists</div>
        </div>
      </div>
    </>
  );
}


// ─── Villain section ──────────────────────────────────────────────────────────

const VILLAIN_GROUPS = [HYDRA_GROUP];

function VillainsSection() {
  const [selectedGroup, setSelectedGroup] = useState(0);
  const group = VILLAIN_GROUPS[selectedGroup];

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Left: group list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">Villain groups</div>
        {VILLAIN_GROUPS.map((g, i) => (
          <button
            key={g.groupId}
            onClick={() => setSelectedGroup(i)}
            className={`rounded px-2 py-1.5 text-left text-sm transition ${
              i === selectedGroup
                ? 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/40'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {g.groupId}
            <span className="ml-1 text-[10px] text-neutral-500">
              ({g.cards.reduce((s, c) => s + c.copies, 0)})
            </span>
          </button>
        ))}
      </aside>

      {/* Right: cards grid */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="flex flex-wrap gap-6">
          {group.cards.map(({ def, copies }) => (
            <div key={def.cardId} className="flex flex-col items-center gap-2">
              <VillainCardArt def={def} />
              <div className="text-xs text-neutral-500">
                <span className="font-mono">{copies}×</span> in deck
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Henchmen section ────────────────────────────────────────────────────────

const HENCHMAN_GROUPS = [HAND_NINJA_GROUP];

function HenchmenSection() {
  const [selectedGroup, setSelectedGroup] = useState(0);
  const group = HENCHMAN_GROUPS[selectedGroup];

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Left: group list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">Henchman groups</div>
        {HENCHMAN_GROUPS.map((g, i) => (
          <button
            key={g.groupId}
            onClick={() => setSelectedGroup(i)}
            className={`rounded px-2 py-1.5 text-left text-sm transition ${
              i === selectedGroup
                ? 'bg-slate-500/10 text-slate-300 ring-1 ring-slate-500/40'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {g.groupId}
            <span className="ml-1 text-[10px] text-neutral-500">
              ({g.cards.reduce((s, c) => s + c.copies, 0)})
            </span>
          </button>
        ))}
      </aside>

      {/* Right: cards grid */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="flex flex-wrap gap-6">
          {group.cards.map(({ def, copies }) => (
            <div key={def.cardId} className="flex flex-col items-center gap-2">
              <HenchmanCardArt def={def} />
              <div className="text-xs text-neutral-500">
                <span className="font-mono">{copies}×</span> in deck
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Mastermind section ───────────────────────────────────────────────────────

const MASTERMINDS = [RED_SKULL];

function MastermindSection() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const mm = MASTERMINDS[selectedIdx];

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Left: mastermind list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">Masterminds</div>
        {MASTERMINDS.map((m, i) => (
          <button
            key={m.cardId}
            onClick={() => setSelectedIdx(i)}
            className={`rounded px-2 py-1.5 text-left text-sm transition ${
              i === selectedIdx
                ? 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/40'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {m.name}
            <span className="ml-1 text-[10px] text-neutral-500">({m.kind})</span>
          </button>
        ))}
      </aside>

      {/* Right: mastermind card */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
        <MastermindCardArt def={mm} />
      </section>
    </div>
  );
}

// ─── Scheme section ───────────────────────────────────────────────────────────

const SCHEMES = [NEGATIVE_ZONE_PRISON_BREAKOUT];

function SchemeSection() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const scheme = SCHEMES[selectedIdx];

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Left: scheme list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">Schemes</div>
        {SCHEMES.map((s, i) => (
          <button
            key={s.cardId}
            onClick={() => setSelectedIdx(i)}
            className={`rounded px-2 py-1.5 text-left text-sm transition ${
              i === selectedIdx
                ? 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/40'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {s.name}
            <span className="ml-1 text-[10px] text-neutral-500">({s.twists})</span>
          </button>
        ))}
      </aside>

      {/* Right: scheme card */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
        <SchemeCardArt def={scheme} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Non-hero card art components
// ---------------------------------------------------------------------------

/** Shared small claw-mark icon — mirrors HeroCardArt's private StrikeIcon */
function SbStrikeIcon() {
  return (
    <svg
      width="14" height="12" viewBox="0 0 16 14"
      style={{ display: 'inline-block', verticalAlign: 'middle', filter: 'drop-shadow(0 0 2px #991b1b)' }}
      aria-label="strike"
    >
      <g stroke="#ef4444" strokeLinecap="round" fill="none" strokeWidth="1.8">
        <path d="M1 1 C2 5 4 9 7 13" />
        <path d="M5.5 1 C6.5 5 8.5 9 11 13" />
        <path d="M10 1 C11 5 13 9 15 13" />
      </g>
    </svg>
  );
}

/** VP badge — red circle, absolute-positioned at vertical center of right edge */
function VpBadge({ vp }: { vp: number }) {
  return (
    <div
      aria-label={`${vp} VP`}
      className="absolute right-1 top-1/2 -translate-y-1/2 flex h-[26px] w-[26px] items-center justify-center rounded-full font-sans text-[11px] font-bold shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
      style={{ backgroundColor: '#b91c1c', border: '1px solid #ef4444', color: '#fff' }}
    >
      {vp}
    </div>
  );
}

function VillainCardArt({ def, attachedBystanders = 0 }: { def: VillainCardDef; attachedBystanders?: number }) {
  const borderColor = '#ef4444'; // covert red — villains show no team color

  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid' }}
      className="relative flex h-32 w-[220px] flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-2"
    >
      {/* Name row */}
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-[12px] font-bold leading-tight text-neutral-100 truncate">{def.name}</span>
      </div>
      {/* Type label */}
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        Villain
      </div>
      {/* Card text */}
      {def.text && (
        <div className="my-1 flex-1 text-[11px] leading-snug text-neutral-300">{def.text}</div>
      )}
      {!def.text && <div className="flex-1" />}
      {/* Footer */}
      <div className="mt-auto flex items-end justify-between">
        {attachedBystanders > 0 ? (
          <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">+{attachedBystanders} 👤</span>
        ) : <span />}
        <span className="flex items-center gap-0.5 text-[12px] font-semibold text-white">
          {def.attack}<SbStrikeIcon />
        </span>
      </div>
      <VpBadge vp={def.vp} />
    </div>
  );
}

function HenchmanCardArt({ def, attachedBystanders = 0 }: { def: HenchmanCardDef; attachedBystanders?: number }) {
  const borderColor = '#eab308'; // instinct yellow — henchmen show no team color

  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid' }}
      className="relative flex h-32 w-[220px] flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-2"
    >
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-[12px] font-bold leading-tight text-neutral-100 truncate">{def.name}</span>
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        Henchman
      </div>
      <div className="flex-1" />
      <div className="mt-auto flex items-end justify-between">
        {attachedBystanders > 0 ? (
          <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">+{attachedBystanders} 👤</span>
        ) : <span />}
        <span className="flex items-center gap-0.5 text-[12px] font-semibold text-white">
          {def.attack}<SbStrikeIcon />
        </span>
      </div>
      <VpBadge vp={def.vp} />
    </div>
  );
}

function MastermindCardArt({ def }: { def: MastermindCardDef }) {
  const borderColor = '#DC143C'; // crimson

  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid' }}
      className="relative flex w-[280px] flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-3"
    >
      <div className="text-[14px] font-bold text-neutral-100">{def.name}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        Mastermind
      </div>
      <div className="mt-1 text-[11px] text-neutral-400">
        Always Leads: <span className="font-semibold text-neutral-200">{def.alwaysLeads.toUpperCase()}</span>
      </div>
      {def.text && (
        <div className="my-2 border-t border-neutral-800 pt-2 text-[11px] leading-snug text-neutral-300">
          {def.text}
        </div>
      )}
      <div className="mt-auto flex items-center gap-4 border-t border-neutral-800 pt-2 text-[12px]">
        <span className="flex items-center gap-0.5 font-semibold text-white">
          {def.attack}<SbStrikeIcon />
          <span className="ml-1 text-[10px] text-neutral-500">per hit</span>
        </span>
        <span className="font-semibold text-white">
          {def.hits}
          <span className="ml-1 text-[10px] text-neutral-500">hits</span>
        </span>
      </div>
      <VpBadge vp={def.vp} />
    </div>
  );
}

function SchemeCardArt({ def }: { def: SchemeCardDef }) {
  const borderColor = '#6366f1'; // indigo-500

  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid' }}
      className="flex w-[320px] flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-3"
    >
      <div className="text-[13px] font-bold text-neutral-100">{def.name}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        Scheme
      </div>
      {def.text && (
        <div className="my-2 border-t border-neutral-800 pt-2 text-[11px] leading-snug text-neutral-300">
          {def.text}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-4 border-t border-neutral-800 pt-2 text-[12px]">
        <span>
          <span className="font-bold text-white">{def.twists}</span>
          <span className="ml-1 text-[10px] text-neutral-500">Scheme Twists</span>
        </span>
        <span>
          <span className="font-bold text-white">{def.bystanders}</span>
          <span className="ml-1 text-[10px] text-neutral-500">Bystanders</span>
        </span>
        <span>
          <span className="text-[10px] text-neutral-500">Evil wins after</span>
          <span className="ml-1 font-bold text-white">{def.evilWinsAfterTwists}</span>
          <span className="ml-1 text-[10px] text-neutral-500">twists</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Author type picker — shown when user clicks "Author new pack"
// ---------------------------------------------------------------------------

const PACK_TYPES: { mode: SandboxMode; label: string; sub: string; color: string }[] = [
  { mode: 'author-hero',       label: 'Hero Pack',        sub: 'Multi-card hero class for player decks',    color: '#10b981' },
  { mode: 'author-villain',    label: 'Villain Group',    sub: 'Multi-card villain group for the City row', color: '#ef4444' },
  { mode: 'author-henchman',   label: 'Henchman Group',  sub: 'Low-stat fodder group for the Villain Deck', color: '#f97316' },
  { mode: 'author-mastermind', label: 'Mastermind',      sub: 'Single boss card with Always Leads team',    color: '#DC143C' },
  { mode: 'author-scheme',     label: 'Scheme',           sub: 'Loss condition + twist effect',              color: '#6366f1' },
];

function AuthorTypePicker({
  onSelect,
  onBack,
}: {
  onSelect: (type: SandboxMode) => void;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Author new pack</h1>
          <p className="text-xs text-neutral-500">Choose what kind of pack to create.</p>
        </div>
        <button onClick={onBack} className="text-xs text-neutral-400 hover:text-neutral-200">
          ← back to browse
        </button>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PACK_TYPES.map(({ mode, label, sub, color }) => (
          <button
            key={mode}
            onClick={() => onSelect(mode)}
            className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-5 text-left transition hover:border-neutral-600 hover:bg-neutral-900/80"
          >
            <span
              className="inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}50` }}
            >
              {label}
            </span>
            <span className="text-xs text-neutral-400">{sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Villain Group author
// ---------------------------------------------------------------------------

type VillainCardInPack = { def: VillainCardDef; copies: number };
type VillainPack = { groupId: string; groupName: string; cards: VillainCardInPack[] };

const VILLAIN_STORAGE_KEY = 'legendary-sandbox-villain-v1';

function emptyVillainPack(): VillainPack {
  return { groupId: '', groupName: '', cards: [] };
}

function emptyVillainDef(): VillainCardDef {
  return { kind: 'villain', cardId: '', name: '', team: 'hydra', attack: 5, vp: 3 };
}

function VillainAuthor({ onBack }: { onBack: () => void }) {
  const [pack, setPack]           = useState<VillainPack>(emptyVillainPack);
  const [draft, setDraft]         = useState<VillainCardDef>(emptyVillainDef);
  const [copies, setCopies]       = useState(3);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [hydrated, setHydrated]   = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VILLAIN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as VillainPack;
        if (parsed && Array.isArray(parsed.cards)) setPack(parsed);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(VILLAIN_STORAGE_KEY, JSON.stringify(pack)); } catch {}
  }, [pack, hydrated]);

  // Auto-derive cardId from groupName + name
  useEffect(() => {
    if (editingIdx !== null) return;
    const id = slugCardId(pack.groupName, draft.name);
    if (id !== draft.cardId) setDraft(d => ({ ...d, cardId: id }));
  }, [pack.groupName, draft.name, editingIdx, draft.cardId]);

  function startNew() {
    setEditingIdx(null);
    setDraft(emptyVillainDef());
    setCopies(3);
  }

  function editCard(idx: number) {
    const c = pack.cards[idx];
    if (!c) return;
    setEditingIdx(idx);
    setDraft(structuredClone(c.def));
    setCopies(c.copies);
  }

  function removeCard(idx: number) {
    setPack(p => ({ ...p, cards: p.cards.filter((_, i) => i !== idx) }));
    if (editingIdx === idx) startNew();
  }

  function saveCard() {
    if (!draft.name.trim() || !draft.cardId.trim()) return;
    setPack(p => {
      const cards = [...p.cards];
      const card: VillainCardInPack = { def: structuredClone(draft), copies };
      if (editingIdx !== null) cards[editingIdx] = card;
      else cards.push(card);
      return { ...p, cards };
    });
    if (editingIdx === null) startNew();
  }

  const canExport = pack.cards.length > 0 && pack.groupName.trim() !== '';
  const [copied, setCopied] = useState(false);

  function generateVillainTS(): string {
    const constName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const groupConst = constName(pack.groupName) + '_GROUP';
    const lines: string[] = [];
    lines.push(`// Generated by /legendary-sandbox. Paste into`);
    lines.push(`// src/lib/games/legendary/villains/${pack.groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ts`);
    lines.push('');
    lines.push(`import type { VillainCardDef } from '../types';`);
    lines.push('');
    for (const { def, copies: c } of pack.cards) {
      const cn = constName(`${pack.groupName}_${def.name}`);
      lines.push(`export const ${cn}: VillainCardDef = {`);
      lines.push(`  kind: 'villain',`);
      lines.push(`  cardId: '${def.cardId}',`);
      lines.push(`  name: '${def.name}',`);
      lines.push(`  team: '${def.team}',`);
      lines.push(`  attack: ${def.attack},`);
      lines.push(`  vp: ${def.vp},`);
      if (def.text) lines.push(`  text: '${def.text.replace(/'/g, "\\'")}',`);
      lines.push(`};`);
      lines.push('');
      void c;
    }
    lines.push(`export const ${groupConst} = {`);
    lines.push(`  groupId: '${pack.groupId || pack.groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}',`);
    lines.push(`  groupName: '${pack.groupName}',`);
    lines.push(`  cards: [`);
    for (const { def, copies: c } of pack.cards) {
      const cn = constName(`${pack.groupName}_${def.name}`);
      lines.push(`    { def: ${cn}, copies: ${c} },`);
    }
    lines.push(`  ],`);
    lines.push(`};`);
    lines.push('');
    return lines.join('\n');
  }

  async function copyTS() {
    try {
      await navigator.clipboard.writeText(generateVillainTS());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Villain Group Author</h1>
          <p className="text-xs text-neutral-500">Build a villain group. Auto-saved locally.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-xs text-emerald-400 hover:text-emerald-300">
            ← Browse
          </button>
          <Link href="/lobby" className="text-xs text-neutral-400 hover:text-neutral-200">← lobby</Link>
        </div>
      </header>

      {/* Group metadata */}
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Group name</span>
          <input
            value={pack.groupName}
            onChange={e => setPack(p => ({ ...p, groupName: e.target.value }))}
            placeholder="e.g. HYDRA"
            className="w-48 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Group id</span>
          <input
            value={pack.groupId}
            onChange={e => setPack(p => ({ ...p, groupId: e.target.value }))}
            placeholder="auto from name"
            className="w-36 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-sm text-neutral-100"
          />
        </label>
        <div className="ml-auto flex gap-2">
          <button
            onClick={copyTS}
            disabled={!canExport}
            className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-black hover:bg-emerald-400 disabled:bg-neutral-700 disabled:text-neutral-500"
          >
            {copied ? '✓ Copied' : 'Copy TS'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr_260px]">
        {/* Left: card list */}
        <aside className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Cards in group</span>
            <span className="text-xs font-mono text-neutral-400">{pack.cards.length}</span>
          </div>
          {pack.cards.length === 0 && (
            <div className="rounded border border-dashed border-neutral-800 p-3 text-center text-[11px] text-neutral-600">
              No cards yet.
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {pack.cards.map((c, i) => (
              <li key={c.def.cardId + i}>
                <div
                  className={`flex items-center gap-1 rounded border px-2 py-1.5 text-xs ${
                    editingIdx === i ? 'border-emerald-500 bg-emerald-500/5' : 'border-neutral-800 hover:border-neutral-600'
                  }`}
                >
                  <button
                    onClick={() => editCard(i)}
                    className="flex flex-1 items-baseline gap-1 truncate text-left text-neutral-200"
                  >
                    <span className="font-mono text-[10px] text-neutral-500">{c.copies}×</span>
                    <span className="truncate">{c.def.name || '(unnamed)'}</span>
                    <span className="ml-auto font-mono text-[10px] text-neutral-500">{c.def.attack}⚔</span>
                  </button>
                  <button onClick={() => removeCard(i)} className="text-[10px] text-neutral-600 hover:text-rose-400" title="Remove">✕</button>
                </div>
              </li>
            ))}
          </ul>
          <button
            onClick={startNew}
            className="mt-2 rounded border border-emerald-700 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:border-emerald-400 hover:bg-emerald-500/20"
          >
            + New card
          </button>
        </aside>

        {/* Center: editor */}
        <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">
              {editingIdx !== null ? `Editing: ${pack.cards[editingIdx]?.def.name || '(unnamed)'}` : 'New villain card'}
            </h2>
            {editingIdx !== null && (
              <button onClick={startNew} className="text-[10px] text-neutral-500 hover:text-neutral-300">
                cancel — back to new card
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="e.g. HYDRA Soldier"
                className={input()}
              />
            </Field>
            <Field label="Team">
              <select
                value={draft.team}
                onChange={e => setDraft(d => ({ ...d, team: e.target.value as Team }))}
                className={input()}
              >
                {ALL_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Attack (⚔)">
              <input
                type="number" min={1} max={20}
                value={draft.attack}
                onChange={e => setDraft(d => ({ ...d, attack: clampInt(e.target.value, 1, 20) }))}
                className={input()}
              />
            </Field>
            <Field label="VP">
              <input
                type="number" min={0} max={10}
                value={draft.vp}
                onChange={e => setDraft(d => ({ ...d, vp: clampInt(e.target.value, 0, 10) }))}
                className={input()}
              />
            </Field>
            <Field label="Copies">
              <input
                type="number" min={1} max={10}
                value={copies}
                onChange={e => setCopies(clampInt(e.target.value, 1, 10))}
                className={input()}
              />
            </Field>
            <Field label="Card id (auto)">
              <input
                value={draft.cardId}
                onChange={e => setDraft(d => ({ ...d, cardId: e.target.value }))}
                className={`${input()} font-mono`}
              />
            </Field>
          </div>
          <Field label="Card text (optional)">
            <textarea
              value={draft.text ?? ''}
              onChange={e => setDraft(d => ({ ...d, text: e.target.value || undefined }))}
              placeholder="e.g. Ambush: each player discards a card."
              rows={2}
              className={`${input()} resize-none`}
            />
          </Field>
          <div className="mt-4 flex justify-end">
            <button
              onClick={saveCard}
              disabled={!draft.name.trim() || !draft.cardId.trim()}
              className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              {editingIdx !== null ? 'Save changes' : 'Add to group'}
            </button>
          </div>
        </section>

        {/* Right: preview */}
        <aside className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">Live preview</div>
          <div className="flex items-center justify-center rounded-md bg-neutral-900/60 p-3">
            <VillainCardArt def={draft} />
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 text-xs text-neutral-300">
            <div className="font-semibold text-neutral-100">{pack.groupName || '(unnamed group)'}</div>
            <div className="mt-1 flex justify-between text-neutral-500">
              <span>{pack.cards.length} unique cards</span>
              <span>{pack.cards.reduce((s, c) => s + c.copies, 0)} copies</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Henchman Group author
// ---------------------------------------------------------------------------

type HenchmanCardInPack = { def: HenchmanCardDef; copies: number };
type HenchmanPack = { groupId: string; groupName: string; cards: HenchmanCardInPack[] };

const HENCHMAN_STORAGE_KEY = 'legendary-sandbox-henchman-v1';

function emptyHenchmanPack(): HenchmanPack {
  return { groupId: '', groupName: '', cards: [] };
}

function emptyHenchmanDef(): HenchmanCardDef {
  return { kind: 'henchman', cardId: '', name: '', team: 'hydra', attack: 3, vp: 1 };
}

function HenchmanAuthor({ onBack }: { onBack: () => void }) {
  const [pack, setPack]             = useState<HenchmanPack>(emptyHenchmanPack);
  const [draft, setDraft]           = useState<HenchmanCardDef>(emptyHenchmanDef);
  const [copies, setCopies]         = useState(10);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [hydrated, setHydrated]     = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HENCHMAN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as HenchmanPack;
        if (parsed && Array.isArray(parsed.cards)) setPack(parsed);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(HENCHMAN_STORAGE_KEY, JSON.stringify(pack)); } catch {}
  }, [pack, hydrated]);

  useEffect(() => {
    if (editingIdx !== null) return;
    const id = slugCardId(pack.groupName, draft.name);
    if (id !== draft.cardId) setDraft(d => ({ ...d, cardId: id }));
  }, [pack.groupName, draft.name, editingIdx, draft.cardId]);

  function startNew() {
    setEditingIdx(null);
    setDraft(emptyHenchmanDef());
    setCopies(10);
  }

  function editCard(idx: number) {
    const c = pack.cards[idx];
    if (!c) return;
    setEditingIdx(idx);
    setDraft(structuredClone(c.def));
    setCopies(c.copies);
  }

  function removeCard(idx: number) {
    setPack(p => ({ ...p, cards: p.cards.filter((_, i) => i !== idx) }));
    if (editingIdx === idx) startNew();
  }

  function saveCard() {
    if (!draft.name.trim() || !draft.cardId.trim()) return;
    setPack(p => {
      const cards = [...p.cards];
      const card: HenchmanCardInPack = { def: structuredClone(draft), copies };
      if (editingIdx !== null) cards[editingIdx] = card;
      else cards.push(card);
      return { ...p, cards };
    });
    if (editingIdx === null) startNew();
  }

  const canExport = pack.cards.length > 0 && pack.groupName.trim() !== '';
  const [copied, setCopied] = useState(false);

  function generateHenchmanTS(): string {
    const constName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const groupConst = constName(pack.groupName) + '_GROUP';
    const lines: string[] = [];
    lines.push(`// Generated by /legendary-sandbox. Paste into`);
    lines.push(`// src/lib/games/legendary/villains/${pack.groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ts`);
    lines.push('');
    lines.push(`import type { HenchmanCardDef } from '../types';`);
    lines.push('');
    for (const { def, copies: c } of pack.cards) {
      const cn = constName(`${pack.groupName}_${def.name}`);
      lines.push(`export const ${cn}: HenchmanCardDef = {`);
      lines.push(`  kind: 'henchman',`);
      lines.push(`  cardId: '${def.cardId}',`);
      lines.push(`  name: '${def.name}',`);
      lines.push(`  team: '${def.team}',`);
      lines.push(`  attack: ${def.attack},`);
      lines.push(`  vp: ${def.vp},`);
      lines.push(`};`);
      lines.push('');
      void c;
    }
    lines.push(`export const ${groupConst} = {`);
    lines.push(`  groupId: '${pack.groupId || pack.groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}',`);
    lines.push(`  groupName: '${pack.groupName}',`);
    lines.push(`  cards: [`);
    for (const { def, copies: c } of pack.cards) {
      const cn = constName(`${pack.groupName}_${def.name}`);
      lines.push(`    { def: ${cn}, copies: ${c} },`);
    }
    lines.push(`  ],`);
    lines.push(`};`);
    lines.push('');
    return lines.join('\n');
  }

  async function copyTS() {
    try {
      await navigator.clipboard.writeText(generateHenchmanTS());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Henchman Group Author</h1>
          <p className="text-xs text-neutral-500">Build a henchman group. Auto-saved locally.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-xs text-emerald-400 hover:text-emerald-300">
            ← Browse
          </button>
          <Link href="/lobby" className="text-xs text-neutral-400 hover:text-neutral-200">← lobby</Link>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Group name</span>
          <input
            value={pack.groupName}
            onChange={e => setPack(p => ({ ...p, groupName: e.target.value }))}
            placeholder="e.g. Hand Ninjas"
            className="w-48 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Group id</span>
          <input
            value={pack.groupId}
            onChange={e => setPack(p => ({ ...p, groupId: e.target.value }))}
            placeholder="auto from name"
            className="w-36 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-sm text-neutral-100"
          />
        </label>
        <div className="ml-auto">
          <button
            onClick={copyTS}
            disabled={!canExport}
            className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-black hover:bg-emerald-400 disabled:bg-neutral-700 disabled:text-neutral-500"
          >
            {copied ? '✓ Copied' : 'Copy TS'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr_260px]">
        {/* Left */}
        <aside className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Cards in group</span>
            <span className="text-xs font-mono text-neutral-400">{pack.cards.length}</span>
          </div>
          {pack.cards.length === 0 && (
            <div className="rounded border border-dashed border-neutral-800 p-3 text-center text-[11px] text-neutral-600">No cards yet.</div>
          )}
          <ul className="flex flex-col gap-1">
            {pack.cards.map((c, i) => (
              <li key={c.def.cardId + i}>
                <div
                  className={`flex items-center gap-1 rounded border px-2 py-1.5 text-xs ${
                    editingIdx === i ? 'border-emerald-500 bg-emerald-500/5' : 'border-neutral-800 hover:border-neutral-600'
                  }`}
                >
                  <button
                    onClick={() => editCard(i)}
                    className="flex flex-1 items-baseline gap-1 truncate text-left text-neutral-200"
                  >
                    <span className="font-mono text-[10px] text-neutral-500">{c.copies}×</span>
                    <span className="truncate">{c.def.name || '(unnamed)'}</span>
                    <span className="ml-auto font-mono text-[10px] text-neutral-500">{c.def.attack}⚔</span>
                  </button>
                  <button onClick={() => removeCard(i)} className="text-[10px] text-neutral-600 hover:text-rose-400" title="Remove">✕</button>
                </div>
              </li>
            ))}
          </ul>
          <button
            onClick={startNew}
            className="mt-2 rounded border border-emerald-700 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:border-emerald-400 hover:bg-emerald-500/20"
          >
            + New card
          </button>
        </aside>

        {/* Center */}
        <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">
              {editingIdx !== null ? `Editing: ${pack.cards[editingIdx]?.def.name || '(unnamed)'}` : 'New henchman card'}
            </h2>
            {editingIdx !== null && (
              <button onClick={startNew} className="text-[10px] text-neutral-500 hover:text-neutral-300">
                cancel — back to new card
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Hand Ninja"
                className={input()}
              />
            </Field>
            <Field label="Team">
              <select
                value={draft.team}
                onChange={e => setDraft(d => ({ ...d, team: e.target.value as Team }))}
                className={input()}
              >
                {ALL_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Attack (⚔)">
              <input
                type="number" min={1} max={20}
                value={draft.attack}
                onChange={e => setDraft(d => ({ ...d, attack: clampInt(e.target.value, 1, 20) }))}
                className={input()}
              />
            </Field>
            <Field label="VP">
              <input
                type="number" min={0} max={10}
                value={draft.vp}
                onChange={e => setDraft(d => ({ ...d, vp: clampInt(e.target.value, 0, 10) }))}
                className={input()}
              />
            </Field>
            <Field label="Copies">
              <input
                type="number" min={1} max={10}
                value={copies}
                onChange={e => setCopies(clampInt(e.target.value, 1, 10))}
                className={input()}
              />
            </Field>
            <Field label="Card id (auto)">
              <input
                value={draft.cardId}
                onChange={e => setDraft(d => ({ ...d, cardId: e.target.value }))}
                className={`${input()} font-mono`}
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={saveCard}
              disabled={!draft.name.trim() || !draft.cardId.trim()}
              className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              {editingIdx !== null ? 'Save changes' : 'Add to group'}
            </button>
          </div>
        </section>

        {/* Right: preview */}
        <aside className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">Live preview</div>
          <div className="flex items-center justify-center rounded-md bg-neutral-900/60 p-3">
            <HenchmanCardArt def={draft} />
          </div>
          <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-2 text-xs text-neutral-300">
            <div className="font-semibold text-neutral-100">{pack.groupName || '(unnamed group)'}</div>
            <div className="mt-1 flex justify-between text-neutral-500">
              <span>{pack.cards.length} unique cards</span>
              <span>{pack.cards.reduce((s, c) => s + c.copies, 0)} copies</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mastermind author
// ---------------------------------------------------------------------------

const MASTERMIND_STORAGE_KEY = 'legendary-sandbox-mastermind-v1';

function emptyMastermindDef(): MastermindCardDef {
  return { kind: 'mastermind', cardId: '', name: '', alwaysLeads: 'hydra', attack: 8, vp: 5, hits: 4, strike: [] };
}

function MastermindAuthor({ onBack }: { onBack: () => void }) {
  const [draft, setDraft]       = useState<MastermindCardDef>(emptyMastermindDef);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied]     = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MASTERMIND_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MastermindCardDef;
        if (parsed && parsed.kind === 'mastermind') setDraft(parsed);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(MASTERMIND_STORAGE_KEY, JSON.stringify(draft)); } catch {}
  }, [draft, hydrated]);

  // Auto-derive cardId from name when user hasn't manually overridden
  const [cardIdManual, setCardIdManual] = useState(false);
  useEffect(() => {
    if (cardIdManual) return;
    const id = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (id !== draft.cardId) setDraft(d => ({ ...d, cardId: id }));
  }, [draft.name, cardIdManual, draft.cardId]);

  const canExport = draft.name.trim() !== '' && draft.cardId.trim() !== '';

  function generateMastermindTS(): string {
    const lines: string[] = [];
    lines.push(`// Generated by /legendary-sandbox. Paste into`);
    lines.push(`// src/lib/games/legendary/masterminds/${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ts`);
    lines.push('');
    lines.push(`import type { MastermindCardDef } from '../types';`);
    lines.push('');
    const cn = draft.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    lines.push(`export const ${cn}: MastermindCardDef = {`);
    lines.push(`  kind: 'mastermind',`);
    lines.push(`  cardId: '${draft.cardId}',`);
    lines.push(`  name: '${draft.name}',`);
    lines.push(`  alwaysLeads: '${draft.alwaysLeads}',`);
    lines.push(`  attack: ${draft.attack},`);
    lines.push(`  vp: ${draft.vp},`);
    lines.push(`  hits: ${draft.hits},`);
    lines.push(`  strike: [],`);
    if (draft.text) lines.push(`  text: '${draft.text.replace(/'/g, "\\'")}',`);
    lines.push(`};`);
    lines.push('');
    return lines.join('\n');
  }

  async function copyTS() {
    try {
      await navigator.clipboard.writeText(generateMastermindTS());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Mastermind Author</h1>
          <p className="text-xs text-neutral-500">Build a single mastermind card. Auto-saved locally.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-xs text-emerald-400 hover:text-emerald-300">
            ← Browse
          </button>
          <Link href="/lobby" className="text-xs text-neutral-400 hover:text-neutral-200">← lobby</Link>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* Editor */}
        <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Red Skull"
                className={input()}
              />
            </Field>
            <Field label="Card id (auto)">
              <input
                value={draft.cardId}
                onChange={e => { setCardIdManual(true); setDraft(d => ({ ...d, cardId: e.target.value })); }}
                className={`${input()} font-mono`}
              />
            </Field>
            <Field label="Always Leads (team)">
              <select
                value={draft.alwaysLeads}
                onChange={e => setDraft(d => ({ ...d, alwaysLeads: e.target.value as Team }))}
                className={input()}
              >
                {ALL_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Attack (⚔ per hit)">
              <input
                type="number" min={1} max={20}
                value={draft.attack}
                onChange={e => setDraft(d => ({ ...d, attack: clampInt(e.target.value, 1, 20) }))}
                className={input()}
              />
            </Field>
            <Field label="VP">
              <input
                type="number" min={0} max={20}
                value={draft.vp}
                onChange={e => setDraft(d => ({ ...d, vp: clampInt(e.target.value, 0, 20) }))}
                className={input()}
              />
            </Field>
            <Field label="Hits to defeat">
              <input
                type="number" min={1} max={10}
                value={draft.hits}
                onChange={e => setDraft(d => ({ ...d, hits: clampInt(e.target.value, 1, 10) }))}
                className={input()}
              />
            </Field>
          </div>
          <Field label="Card text (optional)">
            <textarea
              value={draft.text ?? ''}
              onChange={e => setDraft(d => ({ ...d, text: e.target.value || undefined }))}
              placeholder="e.g. Master Strike: Each player discards down to 4 cards."
              rows={2}
              className={`${input()} resize-none`}
            />
          </Field>
          <div className="mt-4 flex justify-end">
            <button
              onClick={copyTS}
              disabled={!canExport}
              className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              {copied ? '✓ Copied TS' : 'Copy TS'}
            </button>
          </div>
        </section>

        {/* Preview */}
        <aside className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">Live preview</div>
          <div className="flex items-center justify-center rounded-md bg-neutral-900/60 p-3">
            <MastermindCardArt def={draft} />
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheme author
// ---------------------------------------------------------------------------

const SCHEME_STORAGE_KEY = 'legendary-sandbox-scheme-v1';

function emptyScheme(): SchemeCardDef {
  return { kind: 'scheme', cardId: '', name: '', twists: 8, bystanders: 5, evilWinsAfterTwists: 5, text: '' };
}

function SchemeAuthor({ onBack }: { onBack: () => void }) {
  const [draft, setDraft]       = useState<SchemeCardDef>(emptyScheme);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied]     = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCHEME_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SchemeCardDef;
        if (parsed && parsed.kind === 'scheme') setDraft(parsed);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(SCHEME_STORAGE_KEY, JSON.stringify(draft)); } catch {}
  }, [draft, hydrated]);

  const [cardIdManual, setCardIdManual] = useState(false);
  useEffect(() => {
    if (cardIdManual) return;
    const id = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (id !== draft.cardId) setDraft(d => ({ ...d, cardId: id }));
  }, [draft.name, cardIdManual, draft.cardId]);

  const canExport = draft.name.trim() !== '' && draft.cardId.trim() !== '';

  function generateSchemeTS(): string {
    const lines: string[] = [];
    lines.push(`// Generated by /legendary-sandbox. Paste into`);
    lines.push(`// src/lib/games/legendary/schemes/${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ts`);
    lines.push('');
    lines.push(`import type { SchemeCardDef } from '../types';`);
    lines.push('');
    const cn = draft.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    lines.push(`export const ${cn}: SchemeCardDef = {`);
    lines.push(`  kind: 'scheme',`);
    lines.push(`  cardId: '${draft.cardId}',`);
    lines.push(`  name: '${draft.name}',`);
    lines.push(`  twists: ${draft.twists},`);
    lines.push(`  bystanders: ${draft.bystanders},`);
    lines.push(`  evilWinsAfterTwists: ${draft.evilWinsAfterTwists},`);
    lines.push(`  text: '${draft.text.replace(/'/g, "\\'")}',`);
    lines.push(`};`);
    lines.push('');
    return lines.join('\n');
  }

  async function copyTS() {
    try {
      await navigator.clipboard.writeText(generateSchemeTS());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Scheme Author</h1>
          <p className="text-xs text-neutral-500">Build a single scheme card. Auto-saved locally.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-xs text-emerald-400 hover:text-emerald-300">
            ← Browse
          </button>
          <Link href="/lobby" className="text-xs text-neutral-400 hover:text-neutral-200">← lobby</Link>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Editor */}
        <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Negative Zone Prison Breakout"
                className={input()}
              />
            </Field>
            <Field label="Card id (auto)">
              <input
                value={draft.cardId}
                onChange={e => { setCardIdManual(true); setDraft(d => ({ ...d, cardId: e.target.value })); }}
                className={`${input()} font-mono`}
              />
            </Field>
            <Field label="Scheme Twists in deck">
              <input
                type="number" min={1} max={20}
                value={draft.twists}
                onChange={e => setDraft(d => ({ ...d, twists: clampInt(e.target.value, 1, 20) }))}
                className={input()}
              />
            </Field>
            <Field label="Bystanders in villain deck">
              <input
                type="number" min={0} max={30}
                value={draft.bystanders}
                onChange={e => setDraft(d => ({ ...d, bystanders: clampInt(e.target.value, 0, 30) }))}
                className={input()}
              />
            </Field>
            <Field label="Evil wins after N twists">
              <input
                type="number" min={1} max={20}
                value={draft.evilWinsAfterTwists}
                onChange={e => setDraft(d => ({ ...d, evilWinsAfterTwists: clampInt(e.target.value, 1, 20) }))}
                className={input()}
              />
            </Field>
          </div>
          <Field label="Scheme text / rules">
            <textarea
              value={draft.text}
              onChange={e => setDraft(d => ({ ...d, text: e.target.value }))}
              placeholder="e.g. Twist: Move the top villain from the Villain Deck into the city."
              rows={3}
              className={`${input()} resize-none`}
            />
          </Field>
          <div className="mt-4 flex justify-end">
            <button
              onClick={copyTS}
              disabled={!canExport}
              className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              {copied ? '✓ Copied TS' : 'Copy TS'}
            </button>
          </div>
        </section>

        {/* Preview */}
        <aside className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">Live preview</div>
          <div className="flex items-center justify-center rounded-md bg-neutral-900/60 p-3">
            <SchemeCardArt def={draft} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Convert a JS value into a TS literal string. Strings → single-quoted,
 *  arrays/objects → recursive. */
function tsValue(v: unknown): string {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const inner = v.map(item => tsValue(item)).join(', ');
    // Heuristic: short arrays inline, long arrays wrap
    if (inner.length < 60) return `[${inner}]`;
    return `[\n    ${v.map(item => tsValue(item)).join(',\n    ')},\n  ]`;
  }
  if (typeof v === 'object' && v !== null) {
    const obj = v as Record<string, unknown>;
    const entries = Object.entries(obj).filter(([, val]) => val !== undefined);
    if (entries.length === 0) return '{}';
    return `{ ${entries.map(([k, val]) => `${k}: ${tsValue(val)}`).join(', ')} }`;
  }
  return JSON.stringify(v);
}
