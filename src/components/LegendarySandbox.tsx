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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { HeroCardArt, CLASS_COLORS, CLASS_LABELS, CLASS_CHIP_COLORS, CLASS_ICONS, TEAM_ICON_DATA, CardText, useAutoFitFontSize } from '@/components/legendary/HeroCardArt';
import { VillainCardArt, HenchmanCardArt, TacticCardArt } from '@/components/legendary/SystemCardArt';
import type { Effect, HeroCardDef, HeroClass, Team, VillainCardDef, HenchmanCardDef, MastermindCardDef, TacticCardDef, SchemeCardDef } from '@/lib/games/legendary';
import { ALL_HERO_CLASSES } from '@/lib/games/legendary/heroes/all-heroes';
import { HYDRA_GROUP } from '@/lib/games/legendary/villains/hydra';
import { BROTHERHOOD_GROUP } from '@/lib/games/legendary/villains/brotherhood';
import { ENEMIES_OF_ASGARD_GROUP } from '@/lib/games/legendary/villains/enemies-of-asgard';
import { MASTERS_OF_EVIL_GROUP } from '@/lib/games/legendary/villains/masters-of-evil';
import { HAND_NINJA_GROUP } from '@/lib/games/legendary/villains/hand-ninjas';
import { DOOMBOT_HENCHMAN_GROUP } from '@/lib/games/legendary/villains/doombot-legion';
import { SAVAGE_LAND_MUTATES_GROUP } from '@/lib/games/legendary/villains/savage-land-mutates';
import { SENTINEL_GROUP } from '@/lib/games/legendary/villains/sentinels';
import { RED_SKULL, RED_SKULL_TACTICS } from '@/lib/games/legendary/masterminds/red-skull';
import { DR_DOOM, DR_DOOM_TACTICS } from '@/lib/games/legendary/masterminds/dr-doom';
import { LOKI, LOKI_TACTICS } from '@/lib/games/legendary/masterminds/loki';
import { MAGNETO, MAGNETO_TACTICS } from '@/lib/games/legendary/masterminds/magneto';
import { NEGATIVE_ZONE_PRISON_BREAKOUT } from '@/lib/games/legendary/schemes/prison-breakout';
import { COSMIC_CUBE } from '@/lib/games/legendary/schemes/cosmic-cube';
import { TROOPER, AGENT, OFFICER, SIDEKICK } from '@/lib/games/legendary/heroes/shield';
import { WOUND, BYSTANDER, MASTER_STRIKE, SCHEME_TWIST, MASTER_STRIKES_IN_DECK, teamDisplayName, SCHEMES as ALL_SCHEMES, groupBySource } from '@/lib/games/legendary';
import type { WoundCardDef, BystanderCardDef, MasterStrikeCardDef, SchemeTwistCardDef } from '@/lib/games/legendary';
import { KEYWORDS, type KeywordCategory } from '@/lib/games/legendary/keywords';

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
  { kind: 'ko_from_hand',               label: 'KO from hand',        description: 'May KO up to N cards from your hand. Optional filter and bonus effects.' },
  { kind: 'discard_from_hand',          label: 'Discard from hand',   description: 'Discard up to N cards from your hand. Optional bonus effects.' },
  { kind: 'gain_attack_per_class',      label: '+Strike per class',   description: '+N Strike for each card of this class played this turn (incl. or excl. self).' },
  { kind: 'gain_recruit_per_class',     label: '+Recruit per class',  description: '+N Recruit for each card of this class played this turn.' },
  { kind: 'gain_attack_per_team',          label: '+Strike per team',       description: '+N Strike for each card of this team played this turn.' },
  { kind: 'gain_recruit_per_team',         label: '+Recruit per team',      description: '+N Recruit for each card of this team played this turn.' },
  { kind: 'gain_attack_per_vp_bystander',  label: '+Strike / VP Bystander', description: '+1 Strike for each Bystander in your Victory Pile when this card is played.' },
  { kind: 'grant_free_bystander_fight',    label: 'Free Bystander Fight',   description: 'May fight one villain or mastermind that has a Bystander for free (no Attack cost) this turn.' },
  { kind: 'if_played_class_this_turn',     label: 'If played class ≥ N',   description: 'Conditional: fires nested effects when total class count this turn ≥ N.' },
  { kind: 'if_played_team_this_turn',      label: 'If played team ≥ N',    description: 'Conditional: fires nested effects when total team count this turn ≥ N.' },
  { kind: 'if_played_hero_this_turn',      label: 'If played hero ≥ N',    description: 'Conditional: fires nested effects when total hero-name count this turn ≥ N.' },
  // Gambit-specific
  { kind: 'put_card_from_hand_on_deck',           label: 'Topdeck from hand (mandatory)', description: 'Prompt the player to choose a card from hand to put on top of their deck.' },
  { kind: 'reveal_top_draw_if_xmen',              label: 'Reveal top → draw if X-Men',   description: 'Peek the top card; if it\'s an X-Men Hero, draw it.' },
  { kind: 'reveal_top_discard_or_return',         label: 'Reveal top → discard or keep', description: 'Prompt to discard the top card of your deck or put it back.' },
  { kind: 'reveal_top_discard_or_return_others',  label: 'Reveal top others → discard',  description: 'Auto-reveal and discard the top card of each other player\'s deck.' },
  { kind: 'gain_attack_equal_to_top_card_cost',   label: '+Strike = top card cost',       description: 'Peek the top card; gain Attack equal to its cost (card stays on top).' },
  // Deadpool-specific
  { kind: 'villain_captures_bystander',           label: 'Villain captures Bystander', description: 'Leftmost city villain (or Mastermind) captures a fresh Bystander.' },
  { kind: 'gain_attack_per_odd_cost_hero_played', label: '+Strike / odd-cost Hero',    description: '+1 Strike per other hero with odd cost played before this card this turn.' },
  { kind: 'if_first_hero_discard_hand_draw_four', label: 'Do-Over (first hero)',       description: 'If this is the first hero played, prompt to discard hand and draw 4.' },
  { kind: 'optional_gain_wound_pass_left',        label: 'Wound? Then pass left',      description: 'Optional wound into hand, then all players pass their top hand-card left.' },
  // Hawkeye-specific
  { kind: 'gain_rescue_bystanders_on_kill',       label: 'Rescue 3 on kill',           description: 'Each time you defeat a Villain or Mastermind this turn, rescue 3 Bystanders.' },
  { kind: 'choose_others_draw_or_discard',        label: '[tech] Others draw or discard', description: 'Binary choice — each other player draws a card (Accept) or discards (Skip).' },
  // Hulk-specific
  { kind: 'each_player_gains_wound',              label: 'Each player gains Wound',    description: 'Every player (including you) takes a Wound into their discard pile.' },
  // Jean Grey-specific
  { kind: 'gain_recruit_per_bystander_rescued_this_turn', label: '+Recruit per Bystander rescued', description: 'This turn: each time you rescue a Bystander, gain +1 Recruit.' },
  { kind: 'draw_per_bystander_rescued_this_turn',         label: 'Draw per Bystander rescued',     description: 'This turn: each time you rescue a Bystander, draw a card.' },
  { kind: 'gain_attack_per_bystander_rescued_this_turn',  label: '+Strike per Bystander rescued',  description: 'This turn: each time you rescue a Bystander, gain +1 Attack.' },
  { kind: 'rescue_bystander_per_xmen_played',             label: 'Rescue per other X-Men played',  description: 'Rescue a Bystander for each other X-Men Hero you played this turn.' },
  // Nick Fury-specific
  { kind: 'gain_card_to_hand',                  label: 'Gain card to hand',              description: 'Place a copy of the given card directly into the player\'s hand (no cost).' },
  { kind: 'defeat_villain_under_shield_ko_count', label: 'Defeat villain < SHIELD KO count', description: 'Auto-defeat all City villains (and Mastermind) whose Attack < # of SHIELD Heroes in the KO pile.' },
  // Rogue-specific
  { kind: 'copy_played_hero',               label: 'Copy played Hero',          description: 'Prompt the player to pick a Hero from played-this-turn and fire its onPlay effects.' },
  { kind: 'play_copy_each_player_top_card', label: 'Play copy of each top card', description: 'Each player reveals & discards top deck card; active player fires onPlay of any Hero cards revealed.' },
  // Spider-Man-specific
  { kind: 'reveal_top_draw_if_cost_le_2',       label: 'Reveal top → draw if ≤2 cost',  description: 'Peek the top card of the deck; draw it if its cost is 2 or less, else leave it on top.' },
  { kind: 'reveal_top_three_draw_cost_le_2',    label: 'Reveal top 3 → draw ≤2 cost',   description: 'Reveal the top 3 cards; draw those that cost 2 or less; put the rest back on top.' },
  // Storm-specific
  { kind: 'villain_debuff_at_location',         label: 'Villain debuff at location',     description: 'Villains fought at the given city space get -N Attack this turn.' },
  { kind: 'move_villain_rescue_bystanders',     label: 'Move Villain + rescue bystanders', description: 'Prompt to move a city Villain to a new slot; rescues its bystanders; swaps if occupied.' },
  { kind: 'mastermind_attack_debuff',           label: 'Mastermind -N Attack this turn', description: 'Reduce the Mastermind\'s effective Attack by N for the rest of this turn.' },
  // Thor-specific
  { kind: 'if_recruit_ge',                      label: 'If recruit ≥ N',                 description: 'Conditional: fires nested effects if the current Recruit pool is ≥ threshold.' },
  { kind: 'enable_recruit_as_attack',           label: 'Recruit → Attack (one-way)',      description: 'For this turn, Recruit can be spent as Attack. Attack cannot pay Recruit costs.' },
  // Wolverine-specific
  { kind: 'gain_attack_per_extra_card_drawn_this_turn', label: '+Strike per extra card drawn',   description: '+N Attack for each extra card drawn via effects this turn (Berserker Rage).' },
  { kind: 'gain_attack_per_unique_class_in_hand',       label: '+Strike per unique class in hand', description: '+1 Strike per distinct hero class among cards in hand + played this turn.' },
  { kind: 'gain_recruit_per_unique_class_in_hand',      label: '+Recruit per unique class in hand', description: '+1 Recruit per distinct hero class among cards in hand + played this turn.' },
  // Masters of Evil villain effects
  { kind: 'rescue_bystander_per_avengers_hero',    label: 'Rescue per Avengers Hero',        description: 'Rescue one Bystander for each Avengers Hero the active player has in hand or played this turn.' },
  { kind: 'ko_heroes_from_hand_if_at_location',    label: 'KO Heroes if at location',         description: 'KO N Heroes from hand if the villain was fought at one of the given city locations.' },
  { kind: 'each_player_reveal_tech_hero_or_wound',  label: 'Reveal [tech] or Wound (all)',    description: 'Each player reveals a [tech] Hero from hand or gains a Wound.' },
  { kind: 'melter_reveal_top_each_player',         label: 'Reveal top deck (all) KO/return', description: 'Each player reveals their top deck card; active player KOs or returns each.' },
  // Scheme twist conditional
  { kind: 'if_twists_revealed', label: 'If twists in range', description: 'Fire inner effects only when the twist count is within the given range.' },
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
          <Field label="Filter" inline>
            <select
              value={effect.filter ?? ''}
              onChange={e => onChange({ ...effect, filter: (e.target.value || undefined) as 'wounds_only' | 'shield_heroes' | 'heroes_only' | undefined })}
              className={inputSm()}
            >
              <option value="">Any card</option>
              <option value="wounds_only">Wounds only</option>
              <option value="shield_heroes">S.H.I.E.L.D. Heroes only</option>
              <option value="heroes_only">Heroes only</option>
            </select>
          </Field>
          <Field label="Bonus effects (if player does)">
            <EffectsEditor
              nested
              effects={effect.bonus ?? []}
              onChange={bonus => onChange({ ...effect, bonus })}
            />
          </Field>
        </>
      );
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
        </>
      );
    case 'gain_attack_per_class':
    case 'gain_recruit_per_class':
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
          <Field label="Bonus per card" inline>
            <input
              type="number" min={1} max={10}
              value={effect.bonus}
              onChange={e => onChange({ ...effect, bonus: clampInt(e.target.value, 1, 10) })}
              className={inputSm()}
            />
          </Field>
          <Field label="Include self" inline>
            <input
              type="checkbox"
              checked={!!effect.includeSelf}
              onChange={e => onChange({ ...effect, includeSelf: e.target.checked })}
            />
          </Field>
        </>
      );
    case 'gain_attack_per_team':
    case 'gain_recruit_per_team':
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
          <Field label="Bonus per card" inline>
            <input
              type="number" min={1} max={10}
              value={effect.bonus}
              onChange={e => onChange({ ...effect, bonus: clampInt(e.target.value, 1, 10) })}
              className={inputSm()}
            />
          </Field>
          <Field label="Include self" inline>
            <input
              type="checkbox"
              checked={!!effect.includeSelf}
              onChange={e => onChange({ ...effect, includeSelf: e.target.checked })}
            />
          </Field>
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
          <Field label="Min count" inline>
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
          <Field label="Min count" inline>
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
    case 'if_played_hero_this_turn':
      return (
        <>
          <Field label="Hero name" inline>
            <input
              type="text"
              value={effect.heroName}
              onChange={e => onChange({ ...effect, heroName: e.target.value })}
              placeholder="e.g. Hulk"
              className={inputSm()}
            />
          </Field>
          <Field label="Min count" inline>
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
    case 'gain_attack_per_class':      return { kind, cls: 'strength', bonus: 1, includeSelf: false };
    case 'gain_recruit_per_class':     return { kind, cls: 'strength', bonus: 1, includeSelf: false };
    case 'gain_attack_per_team':             return { kind, team: 'avengers', bonus: 1, includeSelf: false };
    case 'gain_recruit_per_team':            return { kind, team: 'avengers', bonus: 1, includeSelf: false };
    case 'gain_attack_per_vp_bystander':     return { kind };
    case 'grant_free_bystander_fight':       return { kind };
    case 'if_played_class_this_turn':               return { kind, cls: 'strength', minOthers: 2, effects: [] };
    case 'if_played_team_this_turn':                return { kind, team: 'avengers', minOthers: 2, effects: [] };
    case 'if_played_hero_this_turn':                return { kind, heroName: '', minOthers: 2, effects: [] };
    case 'gain_attack_per_unique_class_in_hand':    return { kind };
    case 'gain_recruit_per_unique_class_in_hand':   return { kind };
    case 'put_card_from_hand_on_deck':              return { kind };
    case 'reveal_top_draw_if_xmen':                 return { kind };
    case 'reveal_top_discard_or_return':            return { kind };
    case 'reveal_top_discard_or_return_others':     return { kind };
    case 'gain_attack_equal_to_top_card_cost':      return { kind };
    case 'villain_captures_bystander':              return { kind };
    case 'gain_attack_per_odd_cost_hero_played':    return { kind };
    case 'if_first_hero_discard_hand_draw_four':    return { kind };
    case 'optional_gain_wound_pass_left':           return { kind };
    case 'gain_rescue_bystanders_on_kill':          return { kind };
    case 'choose_others_draw_or_discard':           return { kind };
    case 'each_player_gains_wound':                         return { kind };
    case 'gain_recruit_per_bystander_rescued_this_turn':    return { kind };
    case 'draw_per_bystander_rescued_this_turn':            return { kind };
    case 'gain_attack_per_bystander_rescued_this_turn':     return { kind };
    case 'rescue_bystander_per_xmen_played':                return { kind };
    case 'gain_card_to_hand':                              return { kind, cardId: 'shield_officer' };
    case 'defeat_villain_under_shield_ko_count':           return { kind };
    case 'copy_played_hero':                               return { kind };
    case 'play_copy_each_player_top_card':                 return { kind };
    // Spider-Man
    case 'reveal_top_draw_if_cost_le_2':                   return { kind };
    case 'reveal_top_three_draw_cost_le_2':                return { kind };
    // Storm
    case 'villain_debuff_at_location':                     return { kind, location: 'rooftops', amount: 2 };
    case 'move_villain_rescue_bystanders':                 return { kind };
    case 'mastermind_attack_debuff':                       return { kind, amount: 2 };
    // Thor
    case 'if_recruit_ge':                                  return { kind, threshold: 8, effects: [] };
    case 'enable_recruit_as_attack':                       return { kind };
    // Wolverine
    case 'gain_attack_per_extra_card_drawn_this_turn':     return { kind, amount: 1 };
    // Red Skull / Sidekick effects
    case 'optional_return_sidekick_draw_two':              return { kind };
    case 'each_player_ko_hero_from_hand':                  return { kind };
    case 'look_top_three_ko_discard_return':               return { kind };
    case 'draw_per_hydra_in_victory_pile':                 return { kind };
    // Dr. Doom
    case 'doom_master_strike':                             return { kind };
    case 'free_recruit_tech_or_ranged_from_hq':            return { kind };
    case 'extra_hand_cards':                               return { kind, amount: 3 };
    case 'extra_turn':                                     return { kind };
    // Doombot Legion henchman fight
    case 'look_top_two_ko_one_return_one':                 return { kind };
    // Brotherhood villain effects
    case 'reveal_xmen_or_wound':                           return { kind };
    case 'each_player_reveal_xmen_or_wound':               return { kind };
    case 'ko_heroes_from_discard':                         return { kind, amount: 2 };
    case 'ko_heroes_from_hand_immediate':                  return { kind, amount: 2 };
    case 'trigger_scheme_twist':                           return { kind };
    case 'reveal_ranged_or_wound':                         return { kind };
    case 'each_player_reveal_ranged_or_wound':             return { kind };
    case 'ko_wounds_from_hand_and_discard':                return { kind };
    case 'ko_all_shield_from_hand':                        return { kind };
    // HYDRA villain effects
    case 'villain_deck_reveal_top':                        return { kind, amount: 2 };
    case 'each_player_without_hydra_vp_gains_wound':       return { kind };
    // Masters of Evil villain effects
    case 'rescue_bystander_per_avengers_hero':             return { kind };
    case 'ko_heroes_from_hand_if_at_location':             return { kind, locations: ['rooftops', 'bridge'], amount: 2 };
    case 'each_player_reveal_tech_hero_or_wound':          return { kind };
    case 'melter_reveal_top_each_player':                  return { kind };
    // Scheme twist conditional
    case 'if_twists_revealed':                             return { kind, min: 5, max: 6, effects: [] };
    // Loki effects
    case 'loki_master_strike':                             return { kind };
    case 'ko_villain_from_vp':                             return { kind };
    case 'ko_bystanders_from_vp':                          return { kind, count: 2 };
    case 'grant_fight_city_free':                          return { kind };
    case 'ko_up_to_from_discard':                          return { kind, amount: 4 };
    // Magneto effects
    case 'magneto_master_strike':                          return { kind };
    case 'free_recruit_xmen_from_hq_effect':               return { kind };
    case 'em_bubble':                                      return { kind };
    case 'ko_all_heroes_in_hq':                            return { kind };
    case 'reveal_xmen_or_gain_wounds':                     return { kind, amount: 2 };
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

type CardFilter = 'heroes' | 'teams' | 'starters' | 'villains' | 'henchmen' | 'mastermind' | 'scheme' | 'rules' | 'icons';

const FILTER_TABS: { id: CardFilter; label: string; badge: string }[] = [
  { id: 'heroes',      label: 'Heroes',          badge: '15 classes' },
  { id: 'teams',       label: 'Teams',            badge: '4 teams' },
  { id: 'starters',   label: 'Generic Cards',    badge: 'S.H.I.E.L.D. + System' },
  { id: 'villains',   label: 'Villains',         badge: 'HYDRA' },
  { id: 'henchmen',   label: 'Henchmen',         badge: 'Hand Ninjas' },
  { id: 'mastermind', label: 'Mastermind',       badge: 'Red Skull' },
  { id: 'scheme',     label: 'Scheme',           badge: 'Negative Zone' },
  { id: 'rules',      label: 'Rules & Keywords', badge: 'glossary' },
  { id: 'icons',      label: 'Icons',            badge: 'class symbols' },
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
      {filter === 'teams'       && <TeamsSection />}
      {filter === 'starters'   && <StartersSection />}
      {filter === 'villains'   && <VillainsSection />}
      {filter === 'henchmen'   && <HenchmenSection />}
      {filter === 'mastermind' && <MastermindSection />}
      {filter === 'scheme'     && <SchemeSection />}
      {filter === 'rules'      && <RulesSection />}
      {filter === 'icons'      && <IconsSection />}
    </div>
  );
}

// ─── Hero class section ───────────────────────────────────────────────────────

// Sorted once at module level (static data, never changes at runtime).
const SORTED_HERO_CLASSES = [...ALL_HERO_CLASSES].sort((a, b) =>
  a.className.localeCompare(b.className)
);

function HeroSection() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const heroClass = SORTED_HERO_CLASSES[selectedIdx];

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Left: class list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
          Hero classes ({SORTED_HERO_CLASSES.length})
        </div>
        {groupBySource(SORTED_HERO_CLASSES).map(({ source, items }) => (
          <Fragment key={source.id}>
            <div className="mt-2 px-2 text-[9px] font-semibold uppercase tracking-wider text-neutral-600 first:mt-0">
              {source.shortName}
            </div>
            {items.map(hc => {
              const i = SORTED_HERO_CLASSES.indexOf(hc);
              return (
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
              );
            })}
          </Fragment>
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
                <div className="w-[230px] rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[10px] leading-snug text-neutral-400">
                  <CardText text={def.text} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Teams section ────────────────────────────────────────────────────────────

// One entry per hero-side team. Add new entries here as expansion sets
// introduce new teams. The heroes array lists all class names on that team.
const TEAM_BROWSER_DATA: {
  team: string;
  name: string;
  description: string;
  heroes: string[];
}[] = [
  {
    team: 'avengers',
    name: 'Avengers',
    description: "Earth's Mightiest Heroes. Assembled to fight threats no single hero could withstand alone.",
    heroes: ['Captain America', 'Iron Man', 'Thor', 'Hulk', 'Hawkeye', 'Black Widow'],
  },
  {
    team: 'x-men',
    name: 'X-Men',
    description: 'Mutant heroes who protect a world that fears and hates them.',
    heroes: ['Wolverine', 'Cyclops', 'Gambit', 'Rogue', 'Storm', 'Jean Grey'],
  },
  {
    team: 'spider-friends',
    name: 'Spider-Friends',
    description: "Spider-Man and his web-slinging allies, swinging through the streets of New York.",
    heroes: ['Spider-Man'],
  },
  {
    team: 'shield-officer',
    name: 'S.H.I.E.L.D.',
    description: 'Strategic Homeland Intervention, Enforcement and Logistics Division. The world\'s foremost intelligence agency.',
    heroes: ['Nick Fury'],
  },
];

function TeamsSection() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-neutral-100">Teams</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Hero teams from the base set. Each team icon appears on its heroes' cards and powers class-synergy abilities.
          New teams will appear here as expansion sets are added.
        </p>
      </div>

      {/* Team cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TEAM_BROWSER_DATA.map(({ team, name, description, heroes }) => {
          const data = TEAM_ICON_DATA[team];
          if (!data) return null;
          return (
            <div
              key={team}
              className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4"
            >
              {/* Icon + name row */}
              <div className="flex items-center gap-3">
                <div
                  style={{ backgroundColor: data.color, color: data.textColor ?? '#000' }}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center text-xl font-black shadow ${team.startsWith('shield') ? 'rounded-full' : 'rounded-md'}`}
                >
                  {data.abbr}
                </div>
                <div>
                  <div className="text-sm font-semibold text-neutral-100">{name}</div>
                  <div className="text-[10px] text-neutral-500">
                    {heroes.length} hero class{heroes.length !== 1 ? 'es' : ''} · Base Game
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className="text-[11px] leading-snug text-neutral-400">{description}</p>

              {/* Hero chips */}
              <div className="mt-auto flex flex-wrap gap-1 pt-1">
                {heroes.map(h => (
                  <span
                    key={h}
                    className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Token legend */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="mb-3 text-[10px] uppercase tracking-wider text-neutral-500">Team icon legend</div>
        <div className="flex flex-wrap gap-4">
          {TEAM_BROWSER_DATA.map(({ team, name }) => {
            const data = TEAM_ICON_DATA[team];
            if (!data) return null;
            return (
              <div key={team} className="flex items-center gap-2">
                <div
                  style={{ backgroundColor: data.color, color: data.textColor ?? '#000' }}
                  className={`flex h-[14px] w-[14px] shrink-0 items-center justify-center text-[7px] font-black leading-none ${team.startsWith('shield') ? 'rounded-full' : 'rounded-sm'}`}
                >
                  {data.abbr}
                </div>
                <span className="text-xs text-neutral-300">{name}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] leading-snug text-neutral-600">
          The small team icon appears in the top-left corner of every hero card. Abilities that reference
          a team (e.g. "for each other [X-Men] Hero you played this turn") count all cards whose team
          matches, including those played earlier in the same turn.
        </p>
      </div>
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

/** Unified system card — name centered (no text) or name-at-top + ability-text layout.
 *  Two-row header matches hero card structure so ability text aligns at the same position. */
function SystemCardArt({ name, borderColor, vp, bg, text, typeLabel }: {
  name: string; borderColor: string; vp?: number; bg?: string; text?: string; typeLabel?: string;
}) {
  if (text) {
    return (
      <div
        style={{ borderWidth: 2, borderColor, borderStyle: 'solid', background: bg }}
        className="relative flex h-[165px] w-[220px] flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-2"
      >
        {/* Row 1 — card name */}
        <span className="text-[12px] font-bold leading-tight text-neutral-100">{name}</span>
        {/* Row 2 — type label; transparent when absent so text still starts at the same height */}
        <div
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: typeLabel ? borderColor : 'transparent' }}
        >
          {typeLabel ?? ' '}
        </div>
        {/* Ability text — pt-3 + text-[12px] matches hero card text start position */}
        <div className="mb-1 flex-1 pr-2 pt-3 text-[12px] leading-snug text-neutral-300">{text}</div>
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
  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid', background: bg }}
      className="relative flex h-40 w-[220px] items-center justify-center rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950"
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
          <SystemCardArt name="Wound" borderColor="#7a3030" bg="linear-gradient(135deg, #6b2525, #5a1e1e)" text={(WOUND as { text?: string }).text} />
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
          Civilians caught up in the fight. Attached to villain cards when revealed — worth 1 VP each.
          Card effects that say "rescue a Bystander" draw from the Bystander Deck and put it
          directly in your Victory Pile. To save Bystanders held by a specific villain in the
          City, you must defeat that villain — rescue effects can't reach them.
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
          Shuffled into the Villain Deck. When revealed, the active Mastermind's strike effect fires.
          Most strikes affect each player, but some only affect the current player — check the
          Mastermind card for the exact wording. The Master Strike card is then KO'd (does not enter the City).
        </p>
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col items-start gap-2">
          <SystemCardArt
            name="Master Strike"
            borderColor="#c45000"
            bg="linear-gradient(135deg, #8a3800, #6a2c00)"
            text="The Mastermind's strike effect fires against every player simultaneously."
          />
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
          <div className="text-xs text-neutral-500">{scheme.twists} twists · {scheme.bystanders} bystanders</div>
        </div>
      </div>
    </>
  );
}


// ─── Villain section ──────────────────────────────────────────────────────────

const VILLAIN_GROUPS = [HYDRA_GROUP, BROTHERHOOD_GROUP, ENEMIES_OF_ASGARD_GROUP, MASTERS_OF_EVIL_GROUP];

function VillainsSection() {
  const [selectedGroup, setSelectedGroup] = useState(0);
  const group = VILLAIN_GROUPS[selectedGroup];

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Left: group list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">Villain groups</div>
        {/* groupBySource falls back to 'base' for groups that don't yet set source */}
        {groupBySource(VILLAIN_GROUPS).map(({ source, items }) => (
          <Fragment key={source.id}>
            <div className="mt-2 px-2 text-[9px] font-semibold uppercase tracking-wider text-neutral-600 first:mt-0">
              {source.shortName}
            </div>
            {items.map(g => {
              const i = VILLAIN_GROUPS.indexOf(g);
              return (
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
              );
            })}
          </Fragment>
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

const HENCHMAN_GROUPS = [HAND_NINJA_GROUP, DOOMBOT_HENCHMAN_GROUP, SAVAGE_LAND_MUTATES_GROUP, SENTINEL_GROUP];

function HenchmenSection() {
  const [selectedGroup, setSelectedGroup] = useState(0);
  const group = HENCHMAN_GROUPS[selectedGroup];

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Left: group list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">Henchman groups</div>
        {groupBySource(HENCHMAN_GROUPS).map(({ source, items }) => (
          <Fragment key={source.id}>
            <div className="mt-2 px-2 text-[9px] font-semibold uppercase tracking-wider text-neutral-600 first:mt-0">
              {source.shortName}
            </div>
            {items.map(g => {
              const i = HENCHMAN_GROUPS.indexOf(g);
              return (
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
              );
            })}
          </Fragment>
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

type MastermindEntry = { card: MastermindCardDef; tactics: readonly TacticCardDef[] };
const MASTERMINDS: MastermindEntry[] = [
  { card: RED_SKULL, tactics: RED_SKULL_TACTICS },
  { card: DR_DOOM,   tactics: DR_DOOM_TACTICS   },
  { card: LOKI,      tactics: LOKI_TACTICS      },
  { card: MAGNETO,   tactics: MAGNETO_TACTICS   },
];

/** Static board-accurate mastermind panel — matches MastermindZone in LegendaryBoard.tsx
 *  but rendered as a plain div (no fight button) for sandbox preview. */
function SandboxMastermindPanel({ def }: { def: MastermindCardDef }) {
  const borderColor = '#DC143C';
  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid' }}
      className="relative flex h-36 w-[448px] flex-col rounded-lg bg-gradient-to-br from-red-950/40 to-neutral-950/40 p-2 text-left"
    >
      {/* Name */}
      <div className="truncate text-[15px] font-bold leading-tight text-white">{def.name}</div>
      {/* Type label */}
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        Mastermind
      </div>
      {/* Always Leads */}
      <div className="mt-0.5 text-[11px]">
        <span className="font-semibold" style={{ color: borderColor }}>Always Leads: </span>
        <span className="font-bold text-white">{teamDisplayName(def.alwaysLeads)}</span>
      </div>
      {/* Master Strike text — "Label:" in crimson, body in white */}
      {def.text && (() => {
        const colonIdx = def.text!.indexOf(':');
        const label = colonIdx > 0 ? def.text!.slice(0, colonIdx + 1) : '';
        const body  = colonIdx > 0 ? def.text!.slice(colonIdx + 1).trim() : def.text!;
        return (
          <div className="mt-1 line-clamp-2 pr-8 text-[11px] leading-snug">
            {label && (
              <span className="font-bold" style={{ color: borderColor }}>{label} </span>
            )}
            <span className="text-white"><CardText text={body} /></span>
          </div>
        );
      })()}
      {/* Tactic bars — all filled (none taken in preview) */}
      <div className="mt-auto pt-1">
        <div className="flex gap-1.5">
          {Array.from({ length: def.hits }).map((_, i) => (
            <div key={i} className="h-2 flex-1 rounded bg-rose-800" />
          ))}
        </div>
      </div>
      {/* VP badge */}
      <div
        className="absolute right-1 top-1/2 -translate-y-1/2 flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-bold shadow"
        style={{ backgroundColor: '#b91c1c', border: '1px solid #ef4444', color: '#fff' }}
      >
        {def.vp}
      </div>
      {/* Attack stat — pinned above the tactic bars */}
      <span className="absolute right-1 bottom-[20px] flex items-center gap-0.5 text-[13px] font-semibold text-white">
        {def.attack}<SbStrikeIcon />
      </span>
    </div>
  );
}

function MastermindSection() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const { card: mm, tactics } = MASTERMINDS[selectedIdx];

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Left: mastermind list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">Masterminds</div>
        {/* groupBySource reads the `source` field off each MM card def */}
        {groupBySource(MASTERMINDS.map(e => e.card)).map(({ source, items }) => (
          <Fragment key={source.id}>
            <div className="mt-2 px-2 text-[9px] font-semibold uppercase tracking-wider text-neutral-600 first:mt-0">
              {source.shortName}
            </div>
            {items.map(m => {
              const i = MASTERMINDS.findIndex(e => e.card.cardId === m.cardId);
              return (
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
                  <span className="ml-1 text-[10px] text-neutral-500">(5 cards)</span>
                </button>
              );
            })}
          </Fragment>
        ))}
      </aside>

      {/* Right: board-accurate mastermind panel + tactics in a single row */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-neutral-100">{mm.name}</h2>
          <span className="text-xs text-neutral-500">1 mastermind · 4 tactics</span>
        </div>

        {/* Board-style mastermind panel — full width, matches the live game board */}
        <SandboxMastermindPanel def={mm} />

        {/* 4 tactic cards in a single horizontal row */}
        <div className="mt-6 flex gap-4 overflow-x-auto pb-2">
          {tactics.map(tactic => (
            <div key={tactic.cardId} className="flex shrink-0 flex-col items-center gap-2">
              <TacticCardArt def={tactic} mastermindName={mm.name} attack={mm.attack} />
              <div className="text-xs text-neutral-500">{tactic.vp}VP</div>
              {tactic.text && (
                <div className="w-[220px] rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[10px] leading-snug text-neutral-400">
                  <CardText text={tactic.text} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Scheme section ───────────────────────────────────────────────────────────

// Canonical scheme list lives in cards.ts; importing ensures the sandbox
// automatically picks up new schemes as they're registered there.
const SCHEMES = ALL_SCHEMES;

function SchemeSection() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const scheme = SCHEMES[selectedIdx];

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      {/* Left: scheme list */}
      <aside className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">Schemes</div>
        {groupBySource(SCHEMES).map(({ source, items }) => (
          <Fragment key={source.id}>
            <div className="mt-2 px-2 text-[9px] font-semibold uppercase tracking-wider text-neutral-600 first:mt-0">
              {source.shortName}
            </div>
            {items.map(s => {
              const i = SCHEMES.indexOf(s);
              return (
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
              );
            })}
          </Fragment>
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

// ─── Rules & Keywords section ─────────────────────────────────────────────────

const CATEGORY_ORDER: KeywordCategory[] = [
  'Turn Flow',
  'Keywords',
  'Card Types',
  'Zones',
  'Win / Loss',
];

const CATEGORY_COLORS: Record<KeywordCategory, { border: string; label: string }> = {
  'Turn Flow':  { border: '#10b981', label: '#6ee7b7' },
  'Keywords':   { border: '#ef4444', label: '#fca5a5' },
  'Card Types': { border: '#f59e0b', label: '#fcd34d' },
  'Zones':      { border: '#8b5cf6', label: '#c4b5fd' },
  'Win / Loss': { border: '#3b82f6', label: '#93c5fd' },
};

function RulesSection() {
  const grouped = CATEGORY_ORDER.map(cat => ({
    cat,
    entries: KEYWORDS.filter(k => k.category === cat),
  }));

  return (
    <div className="flex flex-col gap-8">
      {grouped.map(({ cat, entries }) => {
        const colors = CATEGORY_COLORS[cat];
        return (
          <section key={cat}>
            <div
              className="mb-3 border-b pb-1 text-xs font-bold uppercase tracking-widest"
              style={{ borderColor: colors.border, color: colors.label }}
            >
              {cat}
            </div>
            <div className="overflow-hidden rounded-lg border border-neutral-800">
              <table className="w-full text-sm">
                <tbody>
                  {entries.map((entry, i) => (
                    <tr
                      key={entry.term}
                      className={i % 2 === 0 ? 'bg-neutral-950/60' : 'bg-neutral-900/40'}
                    >
                      <td
                        className="w-48 shrink-0 py-3 pl-4 pr-6 align-top font-semibold"
                        style={{ color: colors.label }}
                      >
                        {entry.term}
                      </td>
                      <td className="py-3 pr-4 align-top text-[13px] leading-relaxed text-neutral-300">
                        {entry.definition}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── Shared card art (villain / henchman / system) ────────────────────────────

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
        Always Leads: <span className="font-semibold text-neutral-200">{teamDisplayName(def.alwaysLeads)}</span>
      </div>
      {def.text && (
        <div className="my-2 border-t border-neutral-800 pt-2 text-[11px] leading-snug text-neutral-300">
          <CardText text={def.text} />
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

/** Board-accurate scheme panel — matches SchemeZone on the live board exactly.
 *  Same dimensions as SandboxMastermindPanel: w-[448px] h-36.
 *  Body text auto-fits via useAutoFitFontSize so long schemes (Killbots,
 *  Skrull Invasion) stay readable without clipping. */
function SchemeCardArt({ def }: { def: SchemeCardDef }) {
  const labelColor = '#a78bfa'; // violet-400 — matches board SchemeZone
  const textRef = useAutoFitFontSize(11, 8, [def.text, def.cardId]);

  return (
    <div className="flex h-36 w-[448px] flex-col rounded-lg border-2 border-solid border-violet-700/70 bg-gradient-to-br from-violet-950/40 to-neutral-950/40 px-2 py-1">
      <span className="truncate text-[14px] font-bold leading-tight text-white">{def.name}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: labelColor }}>Scheme</span>
      {def.text && (
        <div ref={textRef} className="mt-1 flex-1 overflow-hidden leading-tight">
          {def.text.split('\n').map((segment, i) => {
            const colonIdx = segment.indexOf(':');
            if (colonIdx > 0) {
              const label = segment.slice(0, colonIdx + 1);
              const body  = segment.slice(colonIdx + 1).trim();
              return (
                <div key={i}>
                  <span className="font-bold" style={{ color: labelColor }}>{label}</span>
                  {body && <span className="ml-0.5 text-white"><CardText text={body} /></span>}
                </div>
              );
            }
            return <div key={i} className="text-white"><CardText text={segment} /></div>;
          })}
        </div>
      )}
      {/* Twist progress pips — unlit in the static sandbox preview */}
      <div className="mt-auto flex gap-0.5">
        {Array.from({ length: def.twists }).map((_, i) => (
          <div key={i} className="h-1.5 flex-1 rounded bg-neutral-700" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons section — class icon comparison across all three iterations
// ---------------------------------------------------------------------------

const ICON_CLASSES: { key: 'strength' | 'instinct' | 'covert' | 'tech' | 'ranged'; label: string; dotColor: string }[] = [
  { key: 'strength', label: 'Strength', dotColor: '#22c55e' },
  { key: 'instinct', label: 'Instinct', dotColor: '#eab308' },
  { key: 'covert',   label: 'Covert',   dotColor: '#ef4444' },
  { key: 'tech',     label: 'Tech',     dotColor: '#4a5568' },
  { key: 'ranged',   label: 'Ranged',   dotColor: '#3b82f6' },
];

const ICON_SIZES = [12, 16, 24, 32, 48] as const;

/** SVG icons — hand-crafted geometric approximations (v2, replaced by PNG). */
const SVG_ICONS_V2: Record<string, React.ReactElement> = {
  strength: (
    <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
      <rect x="3.5" y="1"   width="2.8" height="4.5" rx="1.4" fill="#22c55e" stroke="#14532d" strokeWidth="0.5"/>
      <rect x="7"   y="1.5" width="2.8" height="4"   rx="1.4" fill="#22c55e" stroke="#14532d" strokeWidth="0.5"/>
      <rect x="10"  y="2"   width="2.5" height="3.5" rx="1.2" fill="#22c55e" stroke="#14532d" strokeWidth="0.5"/>
      <rect x="3"   y="4.5" width="10"  height="8.5" rx="1.5" fill="#22c55e" stroke="#14532d" strokeWidth="0.5"/>
      <rect x="1"   y="7.5" width="3.5" height="4"   rx="1.5" fill="#22c55e" stroke="#14532d" strokeWidth="0.5"/>
      <rect x="4"   y="5.8" width="8.5" height="1.2" rx="0.6" fill="#14532d" opacity="0.5"/>
      <rect x="4"   y="1.2" width="1.4" height="1.2" rx="0.5" fill="#86efac" opacity="0.7"/>
      <rect x="7.5" y="1.7" width="1.4" height="1.2" rx="0.5" fill="#86efac" opacity="0.7"/>
      <rect x="10.5" y="2.2" width="1.2" height="1"  rx="0.5" fill="#86efac" opacity="0.7"/>
    </svg>
  ),
  instinct: (
    <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
      <polygon
        points="8,0.8 9.9,4.9 14.2,4.3 11.4,7.8 13.4,12.1 8.8,10.5 8,15.2 7.2,10.5 2.6,12.1 4.6,7.8 1.8,4.3 6.1,4.9"
        fill="#eab308" stroke="#92400e" strokeWidth="0.4" strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2.6" fill="#ca8a04"/>
      <circle cx="7.2" cy="7.2" r="1" fill="#fde047" opacity="0.55"/>
    </svg>
  ),
  covert: (
    <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
      <path d="M 2.5 8.5 A 5.5 5.5 0 0 1 13.5 7.5" stroke="#ef4444" strokeWidth="2.4" strokeLinecap="round"/>
      <polygon points="12,4.5 15.2,7.8 11.8,9.5" fill="#ef4444"/>
      <path d="M 13.5 7.5 A 5.5 5.5 0 0 1 2.5 8.5" stroke="#ef4444" strokeWidth="2.4" strokeLinecap="round"/>
      <polygon points="4,11.5 0.8,8.2 4.2,6.5" fill="#ef4444"/>
    </svg>
  ),
  tech: (
    <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
      <rect x="4"    y="4"    width="8"   height="8"   rx="1.2" fill="#374151" stroke="#9ca3af" strokeWidth="0.8"/>
      <rect x="5.8"  y="5.8"  width="4.4" height="4.4" rx="0.6" fill="#6b7280"/>
      <rect x="6.6"  y="6.6"  width="1.2" height="1.2" rx="0.2" fill="#9ca3af"/>
      <rect x="8.2"  y="6.6"  width="1.2" height="1.2" rx="0.2" fill="#9ca3af"/>
      <rect x="6.6"  y="8.2"  width="1.2" height="1.2" rx="0.2" fill="#9ca3af"/>
      <rect x="8.2"  y="8.2"  width="1.2" height="1.2" rx="0.2" fill="#9ca3af"/>
      <rect x="6.4"  y="1.8"  width="1.1" height="2.4" rx="0.4" fill="#9ca3af"/>
      <rect x="8.5"  y="1.8"  width="1.1" height="2.4" rx="0.4" fill="#9ca3af"/>
      <rect x="6.4"  y="11.8" width="1.1" height="2.4" rx="0.4" fill="#9ca3af"/>
      <rect x="8.5"  y="11.8" width="1.1" height="2.4" rx="0.4" fill="#9ca3af"/>
      <rect x="1.8"  y="6.4"  width="2.4" height="1.1" rx="0.4" fill="#9ca3af"/>
      <rect x="1.8"  y="8.5"  width="2.4" height="1.1" rx="0.4" fill="#9ca3af"/>
      <rect x="11.8" y="6.4"  width="2.4" height="1.1" rx="0.4" fill="#9ca3af"/>
      <rect x="11.8" y="8.5"  width="2.4" height="1.1" rx="0.4" fill="#9ca3af"/>
    </svg>
  ),
  ranged: (
    <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
      <polygon points="8,1 15,8 8,15 1,8" fill="none" stroke="#22d3ee" strokeWidth="1.5"/>
      <line x1="3.2"  y1="3.2"  x2="12.8" y2="12.8" stroke="#22d3ee" strokeWidth="0.9" opacity="0.65"/>
      <line x1="12.8" y1="3.2"  x2="3.2"  y2="12.8" stroke="#22d3ee" strokeWidth="0.9" opacity="0.65"/>
      <polygon points="8,4.5 11.5,8 8,11.5 4.5,8" fill="#22d3ee" opacity="0.25"/>
      <circle cx="8" cy="8" r="1.8" fill="#22d3ee" opacity="0.9"/>
    </svg>
  ),
};

/** New SVG variant sets for the Icons sandbox tab. */
const SVG_VARIANTS: {
  id: string;
  label: string;
  notes: string;
  icons: Record<string, React.ReactElement>;
}[] = [
  {
    id: 'v2',
    label: 'Original SVG',
    notes: 'Fist · Star · Dual arcs · Chip · Diamond',
    icons: SVG_ICONS_V2,
  },
  {
    id: 'B',
    label: 'Shield · Lightning · Dagger · Gear · Bullseye',
    notes: 'Strength=shield, Instinct=bolt (not a star), Covert=dagger, Tech=cog, Ranged=target',
    icons: {
      strength: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <path d="M8,1.2 L13.8,4 L13.8,9.5 Q13.8,14.5 8,15.2 Q2.2,14.5 2.2,9.5 L2.2,4 Z" fill="#22c55e" stroke="#14532d" strokeWidth="0.6"/>
          <rect x="7.1" y="3.8" width="1.8" height="7.5" rx="0.5" fill="#14532d" opacity="0.45"/>
          <rect x="4"   y="6.5" width="8"   height="1.8" rx="0.5" fill="#14532d" opacity="0.45"/>
        </svg>
      ),
      instinct: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <path d="M10.5,1.5 L5.5,8.5 L9.2,8.5 L5.8,14.5 L12.5,6.5 L8.8,6.5 Z" fill="#eab308" stroke="#92400e" strokeWidth="0.4" strokeLinejoin="round"/>
          <line x1="9.5" y1="2.5" x2="7" y2="7" stroke="#fde047" strokeWidth="0.7" strokeLinecap="round" opacity="0.65"/>
        </svg>
      ),
      covert: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <path d="M8,1.2 L9.8,7.8 L8,9.5 L6.2,7.8 Z" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.4"/>
          <rect x="4.5" y="8.5" width="7"  height="2"   rx="1"   fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.4"/>
          <rect x="7"   y="10.5" width="2" height="4"   rx="0.8" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.4"/>
          <line x1="7.6" y1="2.5" x2="7.2" y2="7.2" stroke="#fca5a5" strokeWidth="0.7" strokeLinecap="round" opacity="0.6"/>
        </svg>
      ),
      tech: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <circle cx="8" cy="8" r="5.5" fill="#374151" stroke="#9ca3af" strokeWidth="0.8"/>
          <rect x="6.5" y="0.5" width="3" height="2" rx="0.5" fill="#374151" stroke="#9ca3af" strokeWidth="0.6" transform="rotate(0,8,8)"/>
          <rect x="6.5" y="0.5" width="3" height="2" rx="0.5" fill="#374151" stroke="#9ca3af" strokeWidth="0.6" transform="rotate(45,8,8)"/>
          <rect x="6.5" y="0.5" width="3" height="2" rx="0.5" fill="#374151" stroke="#9ca3af" strokeWidth="0.6" transform="rotate(90,8,8)"/>
          <rect x="6.5" y="0.5" width="3" height="2" rx="0.5" fill="#374151" stroke="#9ca3af" strokeWidth="0.6" transform="rotate(135,8,8)"/>
          <rect x="6.5" y="0.5" width="3" height="2" rx="0.5" fill="#374151" stroke="#9ca3af" strokeWidth="0.6" transform="rotate(180,8,8)"/>
          <rect x="6.5" y="0.5" width="3" height="2" rx="0.5" fill="#374151" stroke="#9ca3af" strokeWidth="0.6" transform="rotate(225,8,8)"/>
          <rect x="6.5" y="0.5" width="3" height="2" rx="0.5" fill="#374151" stroke="#9ca3af" strokeWidth="0.6" transform="rotate(270,8,8)"/>
          <rect x="6.5" y="0.5" width="3" height="2" rx="0.5" fill="#374151" stroke="#9ca3af" strokeWidth="0.6" transform="rotate(315,8,8)"/>
          <circle cx="8" cy="8" r="2.2" fill="#1f2937"/>
          <circle cx="8" cy="8" r="1"   fill="#374151"/>
        </svg>
      ),
      ranged: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <circle cx="8" cy="8" r="6.5" stroke="#22d3ee" strokeWidth="1.2" fill="none"/>
          <circle cx="8" cy="8" r="4.2" stroke="#22d3ee" strokeWidth="1.2" fill="none"/>
          <circle cx="8" cy="8" r="2"   fill="#22d3ee" opacity="0.9"/>
          <line x1="8"   y1="0.5"  x2="8"   y2="3"    stroke="#22d3ee" strokeWidth="1" strokeLinecap="round"/>
          <line x1="8"   y1="13"   x2="8"   y2="15.5" stroke="#22d3ee" strokeWidth="1" strokeLinecap="round"/>
          <line x1="0.5" y1="8"    x2="3"   y2="8"    stroke="#22d3ee" strokeWidth="1" strokeLinecap="round"/>
          <line x1="13"  y1="8"    x2="15.5" y2="8"   stroke="#22d3ee" strokeWidth="1" strokeLinecap="round"/>
        </svg>
      ),
    },
  },
  {
    id: 'C',
    label: 'Clean fist · Claw marks · Eye mask · Circuit · Arrow',
    notes: 'Strength=tighter fist, Instinct=3 claw slashes, Covert=domino mask, Tech=circuit traces, Ranged=diagonal arrow',
    icons: {
      strength: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <rect x="3.5" y="1.5" width="2"   height="4"   rx="1"   fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          <rect x="6"   y="1"   width="2"   height="4.5" rx="1"   fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          <rect x="8.5" y="1.3" width="2"   height="4.2" rx="1"   fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          <rect x="11"  y="2"   width="1.8" height="3.5" rx="1"   fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          <rect x="3"   y="4.5" width="10"  height="8"   rx="1.5" fill="#22c55e" stroke="#14532d" strokeWidth="0.5"/>
          <rect x="0.8" y="7"   width="3.5" height="3.5" rx="1.5" fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          <line x1="3.5" y1="6.2" x2="12.5" y2="6.2" stroke="#14532d" strokeWidth="0.7" opacity="0.4"/>
        </svg>
      ),
      instinct: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <path d="M4.5,1.5 C3.5,5 4,9 5.5,14"    stroke="#eab308" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
          <path d="M8,1.2 C7.5,5 7.5,9 8,14"       stroke="#eab308" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
          <path d="M11.5,1.5 C12.5,5 12,9 10.5,14" stroke="#eab308" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
        </svg>
      ),
      covert: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <path d="M1,7 Q4,4.5 8,5.5 Q12,4.5 15,7 L15,10 Q12,12.5 8,11.5 Q4,12.5 1,10 Z" fill="#ef4444"/>
          <ellipse cx="5"  cy="8.2" rx="2"   ry="2.3" fill="#1a0505"/>
          <ellipse cx="11" cy="8.2" rx="2"   ry="2.3" fill="#1a0505"/>
          <rect x="7" y="5.5" width="2" height="5.8" rx="0.8" fill="#ef4444"/>
          <path d="M2,7.5 Q8,4.5 14,7.5" stroke="#fca5a5" strokeWidth="0.6" strokeLinecap="round" opacity="0.45" fill="none"/>
        </svg>
      ),
      tech: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <line x1="2"  y1="4"  x2="7"  y2="4"  stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="7"  y1="4"  x2="7"  y2="8"  stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="7"  y1="8"  x2="12" y2="8"  stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="12" y1="8"  x2="12" y2="12" stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="12" y1="12" x2="14" y2="12" stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="2"  y1="12" x2="7"  y2="12" stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="4"  y1="8"  x2="4"  y2="12" stroke="#9ca3af" strokeWidth="1.2" strokeLinecap="round"/>
          <circle cx="2"  cy="4"  r="1.2" fill="#9ca3af"/>
          <circle cx="7"  cy="4"  r="1.2" fill="#9ca3af"/>
          <circle cx="12" cy="8"  r="1.2" fill="#9ca3af"/>
          <circle cx="14" cy="12" r="1.2" fill="#9ca3af"/>
          <circle cx="2"  cy="12" r="1.2" fill="#9ca3af"/>
          <circle cx="4"  cy="12" r="1.2" fill="#9ca3af"/>
        </svg>
      ),
      ranged: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <line x1="3" y1="13" x2="12" y2="4" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round"/>
          <polygon points="12,4 8.5,4.5 11.5,7.5" fill="#22d3ee"/>
          <path d="M3,13 L1,11 L4,10"    stroke="#22d3ee" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
          <path d="M3,13 L2,15.5 L5,13.5" stroke="#22d3ee" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
        </svg>
      ),
    },
  },
  {
    id: 'D',
    label: 'Power bars · Animal eye · Separated arrows · Wrench · Bow',
    notes: 'Strength=3 bars, Instinct=slit-pupil eye, Covert=2 non-overlapping arcs (fixed), Tech=wrench, Ranged=bow+arrow',
    icons: {
      strength: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <rect x="1.5" y="2.5"  width="13" height="3" rx="1.5" fill="#22c55e"/>
          <rect x="1.5" y="6.5"  width="13" height="3" rx="1.5" fill="#22c55e" opacity="0.75"/>
          <rect x="1.5" y="10.5" width="13" height="3" rx="1.5" fill="#22c55e" opacity="0.5"/>
          <rect x="2.5" y="3"    width="5"  height="1" rx="0.5" fill="#86efac" opacity="0.5"/>
        </svg>
      ),
      instinct: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <path d="M1.5,8 Q4,3 8,3 Q12,3 14.5,8 Q12,13 8,13 Q4,13 1.5,8 Z" fill="#eab308" opacity="0.9"/>
          <circle cx="8" cy="8" r="3.2" fill="#ca8a04"/>
          <ellipse cx="8" cy="8" rx="1.1" ry="2.8" fill="#1a0a00"/>
          <ellipse cx="6.8" cy="6.5" rx="0.8" ry="0.5" fill="#fde047" opacity="0.5"/>
        </svg>
      ),
      covert: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <path d="M10.5,3 A2.5,2.5 0 0,1 13,5.5" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
          <polygon points="13,6.8 11.5,4.2 14.5,4.2" fill="#ef4444"/>
          <path d="M5.5,13 A2.5,2.5 0 0,1 3,10.5" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
          <polygon points="3,9.2 4.5,11.8 1.5,11.8" fill="#ef4444"/>
        </svg>
      ),
      tech: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <path d="M4,12 L11,5" stroke="#9ca3af" strokeWidth="2.8" strokeLinecap="round"/>
          <path d="M9.5,3.5 Q12.5,1 14.5,3 Q15.5,5.5 13.5,7 L11,5 Z" fill="#374151" stroke="#9ca3af" strokeWidth="0.8"/>
          <circle cx="12.2" cy="4.4" r="1.2" fill="#1f2937"/>
          <circle cx="3.5"  cy="12.5" r="2"   fill="#374151" stroke="#9ca3af" strokeWidth="0.7"/>
          <circle cx="3.5"  cy="12.5" r="0.9" fill="#1f2937"/>
        </svg>
      ),
      ranged: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          <path d="M3,2 Q0,8 3,14" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" fill="none"/>
          <line x1="3" y1="2"  x2="3" y2="14" stroke="#22d3ee" strokeWidth="0.8" opacity="0.6"/>
          <line x1="3" y1="8"  x2="14" y2="8" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round"/>
          <polygon points="14,8 11,6.2 11,9.8" fill="#22d3ee"/>
          <circle cx="3" cy="8" r="0.8" fill="#22d3ee"/>
        </svg>
      ),
    },
  },
  // ── Variant E ──────────────────────────────────────────────────────────────
  {
    id: 'E',
    label: 'Front fist · Paw print · Swirl arrows · Hex nut · Arrow+diamond',
    notes: 'Strength=face-on fist (4 knuckles), Instinct=paw print, Covert=2 swirling arcs, Tech=hex nut, Ranged=darker blue',
    icons: {
      strength: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Knuckle row — 4 bumps */}
          <rect x="2.5"  y="2.5" width="2.5" height="3"   rx="1.2" fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          <rect x="5.5"  y="2"   width="2.5" height="3.5" rx="1.2" fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          <rect x="8.5"  y="2"   width="2.5" height="3.5" rx="1.2" fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          <rect x="11.5" y="2.5" width="2"   height="3"   rx="1"   fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          {/* Fist body */}
          <rect x="2.5" y="5"   width="11"  height="8"   rx="1.5" fill="#22c55e" stroke="#14532d" strokeWidth="0.5"/>
          {/* Thumb */}
          <rect x="0.5" y="9.5" width="3.5" height="2.5" rx="1.2" fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          {/* Finger dividers */}
          <line x1="5.5"  y1="5.5" x2="5.5"  y2="9" stroke="#14532d" strokeWidth="0.5" opacity="0.35"/>
          <line x1="8.5"  y1="5.5" x2="8.5"  y2="9" stroke="#14532d" strokeWidth="0.5" opacity="0.35"/>
          <line x1="11.5" y1="5.5" x2="11.5" y2="9" stroke="#14532d" strokeWidth="0.5" opacity="0.35"/>
        </svg>
      ),
      instinct: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Three toe pads */}
          <circle cx="5.5"  cy="4"  r="1.5" fill="#eab308"/>
          <circle cx="8"    cy="3"  r="1.5" fill="#eab308"/>
          <circle cx="10.5" cy="4"  r="1.5" fill="#eab308"/>
          {/* Main pad */}
          <ellipse cx="8" cy="9.5" rx="3.5" ry="3" fill="#eab308"/>
          {/* Lower toe pads */}
          <circle cx="5"  cy="13" r="1.3" fill="#eab308"/>
          <circle cx="11" cy="13" r="1.3" fill="#eab308"/>
        </svg>
      ),
      covert: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Arc 1: from 1-o'clock to 6-o'clock, clockwise (~150°) */}
          <path d="M10.5,3.7 A5,5 0 0,1 8,13" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
          <polygon points="6.5,13 8.5,11.5 8.5,14.5" fill="#ef4444"/>
          {/* Arc 2: from 7-o'clock to 12-o'clock, clockwise (~150°) */}
          <path d="M5.5,12.3 A5,5 0 0,1 8,3" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
          <polygon points="9.5,3 7.5,1.5 7.5,4.5" fill="#ef4444"/>
        </svg>
      ),
      tech: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Hexagon outer */}
          <polygon points="8,1 13.5,4.5 13.5,11.5 8,15 2.5,11.5 2.5,4.5" fill="#374151" stroke="#9ca3af" strokeWidth="0.8"/>
          {/* Inner hex recess */}
          <polygon points="8,3.8 12,6 12,10.5 8,12.5 4,10.5 4,6" fill="#1f2937"/>
          {/* Centre bolt hole */}
          <circle cx="8" cy="8" r="2" fill="#374151" stroke="#9ca3af" strokeWidth="0.6"/>
        </svg>
      ),
      ranged: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Diamond target */}
          <polygon points="8,2 12.5,8 8,14 3.5,8" fill="none" stroke="#3b82f6" strokeWidth="1.3"/>
          {/* Arrow through it */}
          <line x1="0.5" y1="8" x2="12" y2="8" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round"/>
          <polygon points="15,8 11.5,6.2 11.5,9.8" fill="#3b82f6"/>
        </svg>
      ),
    },
  },
  // ── Variant F ──────────────────────────────────────────────────────────────
  {
    id: 'F',
    label: 'Dumbbell · Sunburst · Swoosh loop · Signal bars · Arrow',
    notes: 'Strength=dumbbell, Instinct=8-spoke radiate, Covert=¾-circle swoosh, Tech=signal bars, Ranged=clean arrow darker blue',
    icons: {
      strength: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Left weight */}
          <rect x="0.5" y="4.5" width="3.5" height="7" rx="1.5" fill="#22c55e" stroke="#14532d" strokeWidth="0.5"/>
          {/* Right weight */}
          <rect x="12"  y="4.5" width="3.5" height="7" rx="1.5" fill="#22c55e" stroke="#14532d" strokeWidth="0.5"/>
          {/* Handle */}
          <rect x="4"   y="6.5" width="8"   height="3" rx="1"   fill="#22c55e" stroke="#14532d" strokeWidth="0.4"/>
          {/* Grip marks */}
          <rect x="5.5" y="7"   width="0.9" height="2" rx="0.3" fill="#14532d" opacity="0.3"/>
          <rect x="7.5" y="7"   width="0.9" height="2" rx="0.3" fill="#14532d" opacity="0.3"/>
          <rect x="9.5" y="7"   width="0.9" height="2" rx="0.3" fill="#14532d" opacity="0.3"/>
        </svg>
      ),
      instinct: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* 8 spokes */}
          <line x1="8" y1="1.5"  x2="8"    y2="3.5"  stroke="#eab308" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="8" y1="12.5" x2="8"    y2="14.5" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="1.5" y1="8"  x2="3.5"  y2="8"    stroke="#eab308" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="12.5" y1="8" x2="14.5" y2="8"    stroke="#eab308" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="3.5"  y1="3.5"  x2="5"    y2="5"    stroke="#eab308" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="11"   y1="3.5"  x2="12.5" y2="5"    stroke="#eab308" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="3.5"  y1="12.5" x2="5"    y2="11"   stroke="#eab308" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="11"   y1="12.5" x2="12.5" y2="11"   stroke="#eab308" strokeWidth="1.5" strokeLinecap="round"/>
          {/* Centre */}
          <circle cx="8" cy="8" r="2.8" fill="#eab308"/>
        </svg>
      ),
      covert: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* ¾-circle clockwise arc, arrowhead at end */}
          <path d="M13,5 A6.5,6.5 0 1,1 13,11" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
          <polygon points="13,12.5 11,10 15,10" fill="#ef4444"/>
        </svg>
      ),
      tech: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* 4 signal bars — tallest on right */}
          <rect x="1.5"  y="12"   width="2.5" height="2.5"  rx="0.5" fill="#9ca3af"/>
          <rect x="5.5"  y="9"    width="2.5" height="5.5"  rx="0.5" fill="#9ca3af"/>
          <rect x="9.5"  y="5.5"  width="2.5" height="9"    rx="0.5" fill="#9ca3af"/>
          <rect x="13.5" y="2"    width="2"   height="12.5" rx="0.5" fill="#9ca3af"/>
        </svg>
      ),
      ranged: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Shaft */}
          <line x1="3" y1="8" x2="12.5" y2="8" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"/>
          {/* Head */}
          <polygon points="15,8 11.5,6 11.5,10" fill="#3b82f6"/>
          {/* Fletching */}
          <path d="M3,8 L1.5,6"  stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
          <path d="M3,8 L1.5,10" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        </svg>
      ),
    },
  },
  // ── Variant G ──────────────────────────────────────────────────────────────
  {
    id: 'G',
    label: 'Chevrons · Crossing curves · Crossed blades · Bolt-in-box · Arc trajectory',
    notes: 'Strength=double chevron up, Instinct=crossing S-curves, Covert=crossed blades (×), Tech=lightning in chip, Ranged=arc trajectory darker blue',
    icons: {
      strength: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Two stacked chevrons pointing up */}
          <polygon points="8,2 14,8.5 12,8.5 8,4.5 4,8.5 2,8.5" fill="#22c55e"/>
          <polygon points="8,7 14,13.5 12,13.5 8,9.5 4,13.5 2,13.5" fill="#22c55e" opacity="0.6"/>
        </svg>
      ),
      instinct: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Two S-curves crossing — like a fast pounce/lunge */}
          <path d="M1.5,2.5 C5,5 11,5 14.5,8 C11,11 5,11 1.5,13.5" stroke="#eab308" strokeWidth="2.4" strokeLinecap="round" fill="none"/>
          <path d="M14.5,2.5 C11,5 5,5 1.5,8 C5,11 11,11 14.5,13.5" stroke="#eab308" strokeWidth="2.4" strokeLinecap="round" fill="none"/>
        </svg>
      ),
      covert: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Crossed blades × */}
          <rect x="7" y="2" width="2" height="12" rx="0.8" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.4" transform="rotate(45,8,8)"/>
          <rect x="7" y="2" width="2" height="12" rx="0.8" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.4" transform="rotate(-45,8,8)"/>
          {/* Centre jewel */}
          <circle cx="8" cy="8" r="1.8" fill="#7f1d1d" stroke="#ef4444" strokeWidth="0.6"/>
        </svg>
      ),
      tech: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Chip frame */}
          <rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="#9ca3af" strokeWidth="1.2"/>
          {/* Lightning bolt inside */}
          <path d="M9.5,4 L6.5,8.5 L8.5,8.5 L6.5,12 L11,7.2 L9,7.2 Z" fill="#9ca3af"/>
        </svg>
      ),
      ranged: (
        <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
          {/* Arc trajectory */}
          <path d="M2,14 Q5,2.5 14,4" stroke="#3b82f6" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="1.5 1.5" fill="none"/>
          {/* Launch point */}
          <circle cx="2.5" cy="13.5" r="1.3" fill="#3b82f6"/>
          {/* Projectile tip + arrowhead */}
          <circle cx="14" cy="4" r="1"   fill="#3b82f6"/>
          <polygon points="15.5,3.5 12.5,2 13,5.5" fill="#3b82f6"/>
        </svg>
      ),
    },
  },
];

// ── Team icon gallery — data + render helpers ─────────────────────────────────
const TEAM_ICON_TEAMS = [
  { key: 'avengers'       as const, label: 'Avengers',       letter: 'A', abbr: 'AV', pri: '#1a3370', acc: '#f5a623' },
  { key: 'x-men'          as const, label: 'X-Men',           letter: 'X', abbr: 'XM', pri: '#002D72', acc: '#FFD700' },
  { key: 'spider-friends' as const, label: 'Spider-Friends',  letter: 'S', abbr: 'SF', pri: '#7f1d1d', acc: '#fef2f2' },
  { key: 'fantastic-four' as const, label: 'Fantastic Four',  letter: '4', abbr: 'FF', pri: '#003A70', acc: '#FF6B00' },
  { key: 'shield'         as const, label: 'S.H.I.E.L.D.',   letter: 'S', abbr: 'SH', pri: '#1e293b', acc: '#60a5fa' },
];
type TID = typeof TEAM_ICON_TEAMS[number];

function tiSquare(t: TID, s: number) {
  return (
    <div style={{ width: s, height: s, borderRadius: Math.round(s * 0.18), backgroundColor: t.pri, color: t.acc, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(s * 0.52), fontWeight: 900, fontFamily: '"Arial Black", Arial, sans-serif', flexShrink: 0 }}>
      {t.letter}
    </div>
  );
}

function tiRing(t: TID, s: number) {
  const bw = Math.max(2, Math.round(s * 0.06));
  return (
    <div style={{ width: s, height: s, borderRadius: '50%', backgroundColor: t.pri, color: t.acc, border: `${bw}px solid ${t.acc}`, outline: `${Math.max(1, Math.round(s * 0.04))}px solid ${t.acc}30`, outlineOffset: `${bw + 1}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(s * 0.48), fontWeight: 900, fontFamily: '"Arial Black", Arial, sans-serif', flexShrink: 0 }}>
      {t.letter}
    </div>
  );
}

function tiEmblem(t: TID, s: number) {
  if (t.key === 'avengers') return (
    <svg key="av" width={s} height={s} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="24" cy="24" r="24" fill={t.pri}/>
      <circle cx="24" cy="24" r="19.5" fill="none" stroke={t.acc} strokeWidth="1" opacity="0.45"/>
      <text x="24" y="34.5" textAnchor="middle" fill={t.acc} fontSize="30" fontWeight="900" fontFamily="Georgia, serif" fontStyle="italic">A</text>
    </svg>
  );
  if (t.key === 'x-men') return (
    <svg key="xm" width={s} height={s} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
      <rect width="48" height="48" rx="7" fill={t.pri}/>
      <circle cx="24" cy="24" r="16.5" fill="none" stroke={t.acc} strokeWidth="2.5"/>
      <line x1="14.5" y1="14.5" x2="33.5" y2="33.5" stroke={t.acc} strokeWidth="5" strokeLinecap="round"/>
      <line x1="33.5" y1="14.5" x2="14.5" y2="33.5" stroke={t.acc} strokeWidth="5" strokeLinecap="round"/>
    </svg>
  );
  if (t.key === 'spider-friends') return (
    <svg key="sf" width={s} height={s} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="24" cy="24" r="24" fill={t.pri}/>
      <ellipse cx="24" cy="30" rx="6.5" ry="7.5" fill={t.acc}/>
      <circle cx="24" cy="18.5" r="4.5" fill={t.acc}/>
      <line x1="18" y1="24" x2="5"  y2="17" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="18" y1="29" x2="5"  y2="30" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="19" y1="34" x2="8"  y2="42" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="30" y1="24" x2="43" y2="17" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="30" y1="29" x2="43" y2="30" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="29" y1="34" x2="40" y2="42" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
  if (t.key === 'fantastic-four') return (
    <svg key="ff" width={s} height={s} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
      <rect width="48" height="48" rx="7" fill={t.pri}/>
      <circle cx="24" cy="24" r="16.5" fill="none" stroke={t.acc} strokeWidth="2.5"/>
      <text x="24" y="36" textAnchor="middle" fill={t.acc} fontSize="28" fontWeight="900" fontFamily='"Arial Black", Arial, sans-serif'>4</text>
    </svg>
  );
  // S.H.I.E.L.D. — crest + eagle
  return (
    <svg key="sh" width={s} height={s} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M24 3 L43 11 V27 C43 38 34 45 24 46 C14 45 5 38 5 27 V11 Z" fill={t.pri} stroke={t.acc} strokeWidth="2.5" strokeLinejoin="round"/>
      <path d="M12 21 C16 17 20 19.5 24 19.5 C28 19.5 32 17 36 21" fill="none" stroke={t.acc} strokeWidth="2" strokeLinecap="round"/>
      <circle cx="24" cy="18" r="2.5" fill={t.acc}/>
      <line x1="24" y1="20.5" x2="24" y2="35" stroke={t.acc} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function tiOutlined(t: TID, s: number) {
  return (
    <div style={{ width: s, height: s, borderRadius: Math.round(s * 0.18), backgroundColor: 'transparent', color: t.acc, border: `${Math.max(2, Math.round(s * 0.07))}px solid ${t.acc}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(s * 0.48), fontWeight: 900, fontFamily: '"Arial Black", Arial, sans-serif', flexShrink: 0 }}>
      {t.letter}
    </div>
  );
}

function tiMonogram(t: TID, s: number) {
  return (
    <div style={{ height: s, borderRadius: Math.round(s * 0.2), padding: `0 ${Math.round(s * 0.22)}px`, minWidth: Math.round(s * 1.5), backgroundColor: t.pri, color: t.acc, border: `${Math.max(1, Math.round(s * 0.05))}px solid ${t.acc}50`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(s * 0.38), fontWeight: 900, fontFamily: '"Arial Black", Arial, sans-serif', letterSpacing: '1.5px', flexShrink: 0 }}>
      {t.abbr}
    </div>
  );
}

const TEAM_ICON_STYLES: { id: string; label: string; desc: string; fn: (t: TID, s: number) => React.ReactElement }[] = [
  { id: 'A', label: 'A — Square',   desc: 'Rounded rect, bold letter (current)',  fn: tiSquare   },
  { id: 'B', label: 'B — Ring',     desc: 'Circle with double accent border',     fn: tiRing     },
  { id: 'C', label: 'C — Emblem',   desc: 'Team-specific SVG symbol',             fn: tiEmblem   },
  { id: 'D', label: 'D — Outlined', desc: 'Transparent fill, accent border only', fn: tiOutlined },
  { id: 'E', label: 'E — Monogram', desc: 'Two-letter abbreviation',              fn: tiMonogram },
];

function IconsSection() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-neutral-100">Class Icon Comparison</h2>
        <p className="mt-1 text-xs text-neutral-500">
          All three iterations of the 5 class symbols, shown at multiple sizes.
          The PNG version (v3) is what renders in the live game.
        </p>
      </div>

      {/* ── one block per style ── */}
      {[
        {
          version: 'v1',
          label: 'Colored dot',
          desc: 'Original — a filled circle in each class color.',
          current: false,
          renderIcon: (cls: typeof ICON_CLASSES[number], sz: number) => (
            <span
              style={{
                display: 'inline-block',
                width:  sz,
                height: sz,
                borderRadius: '50%',
                backgroundColor: cls.dotColor,
                border: '1px solid rgba(255,255,255,0.5)',
                flexShrink: 0,
              }}
            />
          ),
        },
        {
          version: 'v2',
          label: 'SVG icon',
          desc: 'Hand-crafted SVG — geometric approximations of the game art.',
          current: false,
          renderIcon: (cls: typeof ICON_CLASSES[number], sz: number) => (
            <span style={{ display: 'inline-flex', width: sz, height: sz, flexShrink: 0 }}>
              {SVG_ICONS_V2[cls.key]}
            </span>
          ),
        },
        {
          version: 'v3',
          label: 'PNG icon',
          desc: 'Pixel-art PNGs cropped from the reference image — currently in use.',
          current: true,
          renderIcon: (cls: typeof ICON_CLASSES[number], sz: number) => (
            <img
              src={`/legendary/class-${cls.key}.png`}
              alt={cls.label}
              style={{ width: sz, height: sz, objectFit: 'contain', imageRendering: 'pixelated', flexShrink: 0 }}
            />
          ),
        },
      ].map(({ version, label, desc, current, renderIcon }) => (
        <div key={version} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-5">
          {/* Block header */}
          <div className="mb-4 flex items-center gap-3">
            <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-[11px] text-neutral-400">{version}</span>
            <span className="text-sm font-semibold text-neutral-200">{label}</span>
            {current && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
                current
              </span>
            )}
            <span className="text-xs text-neutral-500">{desc}</span>
          </div>

          {/* 5-column class grid */}
          <div className="grid grid-cols-5 gap-4">
            {ICON_CLASSES.map(cls => (
              <div key={cls.key} className="flex flex-col items-center gap-3">
                {/* Class name + color swatch */}
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: cls.dotColor }}
                  />
                  <span className="text-[11px] font-semibold text-neutral-300">{cls.label}</span>
                </div>

                {/* Icon at each size */}
                <div className="flex flex-col items-center gap-3">
                  {ICON_SIZES.map(sz => (
                    <div key={sz} className="flex flex-col items-center gap-1">
                      <div
                        className="flex items-center justify-center rounded bg-neutral-800/60"
                        style={{ width: Math.max(sz + 16, 40), height: Math.max(sz + 16, 40) }}
                      >
                        {renderIcon(cls, sz)}
                      </div>
                      <span className="font-mono text-[9px] text-neutral-600">{sz}px</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* ── side-by-side at card chip size (14 px) ── */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-5">
        <div className="mb-4 text-sm font-semibold text-neutral-200">
          Side-by-side at card chip size (14 px)
        </div>
        <div className="flex flex-col gap-4">
          {ICON_CLASSES.map(cls => (
            <div key={cls.key} className="flex items-center gap-6">
              {/* Label */}
              <div className="w-20 text-[11px] font-semibold text-neutral-400">{cls.label}</div>
              {/* v1 dot */}
              <div className="flex w-24 items-center gap-2">
                <span className="text-[9px] text-neutral-600">v1</span>
                <span
                  style={{
                    display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                    backgroundColor: cls.dotColor, border: '1px solid rgba(255,255,255,0.5)',
                  }}
                />
              </div>
              {/* v2 svg */}
              <div className="flex w-24 items-center gap-2">
                <span className="text-[9px] text-neutral-600">v2</span>
                <span style={{ display: 'inline-flex', width: 14, height: 14 }}>
                  {SVG_ICONS_V2[cls.key]}
                </span>
              </div>
              {/* v3 png */}
              <div className="flex w-24 items-center gap-2">
                <span className="text-[9px] text-neutral-600">v3 ✓</span>
                <img
                  src={`/legendary/class-${cls.key}.png`}
                  alt={cls.label}
                  style={{ width: 14, height: 14, objectFit: 'contain', imageRendering: 'pixelated' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SVG variant exploration ── */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-5">
        <div className="mb-1 text-sm font-semibold text-neutral-200">SVG Variant Exploration</div>
        <p className="mb-5 text-xs text-neutral-500">
          New designs — each row is a variant set, columns are the 5 classes. Shown at 24 px and 14 px (actual chip size).
          Tech and Ranged from <span className="font-mono text-neutral-400">v2</span> are the benchmark to beat.
        </p>

        {/* Column headers */}
        <div className="mb-2 grid grid-cols-[140px_repeat(5,1fr)] gap-2">
          <div />
          {ICON_CLASSES.map(cls => (
            <div key={cls.key} className="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-300">
              <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: cls.dotColor }} />
              {cls.label}
            </div>
          ))}
        </div>

        {/* Variant rows */}
        {SVG_VARIANTS.map(variant => (
          <div key={variant.id} className="mb-3 grid grid-cols-[140px_repeat(5,1fr)] gap-2 rounded border border-neutral-800/60 bg-neutral-900/30 p-3">
            {/* Row label */}
            <div className="flex flex-col justify-center gap-1 pr-2">
              <span className="font-mono text-[12px] font-semibold text-neutral-200">{variant.id}</span>
              <span className="text-[9px] leading-tight text-neutral-600">{variant.notes}</span>
            </div>
            {/* Icons — 24px preview + 14px chip */}
            {ICON_CLASSES.map(cls => (
              <div key={cls.key} className="flex flex-col items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded bg-neutral-800/60">
                  <span style={{ display: 'inline-flex', width: 24, height: 24 }}>
                    {variant.icons[cls.key]}
                  </span>
                </div>
                <div className="flex h-5 w-5 items-center justify-center rounded bg-neutral-800/40">
                  <span style={{ display: 'inline-flex', width: 14, height: 14 }}>
                    {variant.icons[cls.key]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Team icon options ── */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-5">
        <div className="mb-1 text-sm font-semibold text-neutral-200">Team Icon Options</div>
        <p className="mb-5 text-xs text-neutral-500">
          Five design options for each hero team. Shown at 40 px and 13 px (actual inline card-text size).
          Tell me which style — or mix — to implement.
        </p>

        {/* Column headers */}
        <div className="mb-2 grid grid-cols-[160px_repeat(5,1fr)] gap-2">
          <div />
          {TEAM_ICON_TEAMS.map(t => (
            <div key={t.key} className="text-center text-[11px] font-semibold text-neutral-300">{t.label}</div>
          ))}
        </div>

        {/* Style rows */}
        {TEAM_ICON_STYLES.map(({ id, label, desc, fn }) => (
          <div key={id} className="mb-2 grid grid-cols-[160px_repeat(5,1fr)] gap-2 rounded border border-neutral-800/60 bg-neutral-900/30 p-3">
            <div className="flex flex-col justify-center gap-0.5 pr-2">
              <span className="font-mono text-[12px] font-semibold text-neutral-200">{label}</span>
              <span className="text-[9px] leading-tight text-neutral-500">{desc}</span>
            </div>
            {TEAM_ICON_TEAMS.map(t => (
              <div key={t.key} className="flex flex-col items-center gap-2">
                {/* 40 px — easy to evaluate */}
                <div className="flex h-12 w-12 items-center justify-center rounded bg-neutral-800/60">
                  {fn(t, 40)}
                </div>
                {/* 13 px — actual card-text size */}
                <div className="flex h-5 w-8 items-center justify-center">
                  {fn(t, 13)}
                </div>
              </div>
            ))}
          </div>
        ))}
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
  return { kind: 'mastermind', cardId: '', name: '', alwaysLeads: 'hydra', attack: 8, vp: 5, hits: 4, tacticIds: [], strike: [] };
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
