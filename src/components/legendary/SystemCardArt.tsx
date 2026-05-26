// Shared card art for non-hero cards — villains, henchmen, and system cards
// (wounds, bystanders, master strikes, scheme twists).
//
// Imported by both the sandbox (browse preview) and the live board (CitySlot,
// HandCard). Keeping them here means the board and sandbox can't drift apart.

import type { VillainCardDef, HenchmanCardDef, TacticCardDef } from '@/lib/games/legendary';
import { CardText } from '@/components/legendary/HeroCardArt';

// ─── Strike icon — three claw scratch marks ──────────────────────────────────
export function StrikeIcon({ size = 14 }: { size?: number }) {
  const h = Math.round(size * 12 / 14);
  return (
    <svg
      width={size} height={h} viewBox="0 0 16 14"
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

// ─── VP badge — red circle, vertically centred on right edge ─────────────────
export function VpBadge({ vp, label }: { vp: number; label?: string }) {
  const display = label ?? String(vp);
  // Shrink font slightly for multi-char labels like "3*"
  const fontSize = display.length > 1 ? 'text-[9px]' : 'text-[11px]';
  return (
    <div
      aria-label={`${vp} VP`}
      className={`absolute right-1 top-1/2 -translate-y-1/2 flex h-[26px] w-[26px] items-center justify-center rounded-full font-sans ${fontSize} font-bold shadow-[0_1px_3px_rgba(0,0,0,0.6)]`}
      style={{ backgroundColor: '#b91c1c', border: '1px solid #ef4444', color: '#fff' }}
    >
      {display}
    </div>
  );
}

// ─── Team label helper ────────────────────────────────────────────────────────
const TEAM_LABELS: Record<string, string> = {
  'hydra':                 'Hydra',
  'brotherhood':           'Brotherhood',
  'doombot-legion':        'Doombot Legion',
  'masters-of-evil':       'Masters of Evil',
  'enemies-of-asgard':     'Enemies of Asgard',
  'hand':                  'The Hand',
  'savage-land-mutates':   'Savage Land Mutates',
  'sentinels':             'Sentinels',
};

function teamLabel(team: string): string {
  return TEAM_LABELS[team] ?? team.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ─── Villain card ─────────────────────────────────────────────────────────────
/**
 * Canonical villain card art used in both the sandbox preview and the live
 * board's city slots. `wide` stretches the width to fill the parent (board
 * grid column); default is the 220 px fixed sandbox size.
 *
 * Optional `attachedBystanders` shows a rescue counter on the card.
 * `canFight` / `fightable` are purely visual — the caller wraps in a <button>.
 */
export function VillainCardArt({
  def, wide = false, attachedBystanders = 0, locationDebuff = 0,
  attachedHeroName, attachedHeroCost, killbotStrike,
}: {
  def: VillainCardDef;
  wide?: boolean;
  attachedBystanders?: number;
  /** Storm/Lightning Bolt location debuff — reduces effective attack shown on the card. */
  locationDebuff?: number;
  /** Skrull attach-hero mechanic: when a Hero is tucked under this villain,
   *  show the Hero's name above the card and override the displayed strike
   *  with the Hero's cost. */
  attachedHeroName?: string;
  attachedHeroCost?: number;
  /** Killbots scheme: the live strike value (= current twist count). When
   *  provided AND the villain is a Killbot, replaces the printed "*". */
  killbotStrike?: number;
}) {
  const borderColor = '#ef4444'; // covert red — villains have no team color
  const widthClass  = wide ? 'w-full'  : 'w-[220px]';
  const heightClass = wide ? 'h-36'    : 'h-40';
  const hasAttachedHero = attachedHeroName !== undefined && attachedHeroCost !== undefined;
  const isKillbotWithStrike = def.cardId === 'killbot' && killbotStrike !== undefined;
  // Display strike priority:
  //   1. Attached hero cost (Skrull)
  //   2. Killbot live strike (= twist count)
  //   3. Printed attack (Storm debuff applied below)
  const displayedAttack = hasAttachedHero
    ? attachedHeroCost!
    : isKillbotWithStrike
    ? killbotStrike!
    : def.attack;

  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid' }}
      className={`relative flex ${heightClass} ${widthClass} flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-2 text-left`}
    >
      {/* Attached Hero tab — Skrull mechanic. Renders ABOVE the bystander tab
          slot so both can coexist (use a slight horizontal offset when both). */}
      {hasAttachedHero && (
        <div
          className="absolute -translate-x-1/2 flex items-center gap-1 pointer-events-none"
          style={{
            top: -15,
            left: attachedBystanders > 0 ? 'calc(50% - 32px)' : '50%',
            backgroundColor: '#16a34a',
            border: '2px solid #4ade80',
            borderBottom: 'none',
            borderRadius: '4px 4px 0 0',
            padding: '2px 8px 3px',
            fontSize: '9px',
            fontWeight: 700,
            color: '#04240e',
            whiteSpace: 'nowrap',
            zIndex: 21,
            boxShadow: '0 -2px 6px rgba(22,163,74,0.6)',
            maxWidth: 140,
          }}
          title={`Hero attached (Skrull): ${attachedHeroName} — cost ${attachedHeroCost}`}
        >
          <span>🦠</span>
          <span className="truncate">{attachedHeroName}</span>
          <span className="rounded bg-emerald-900 px-1">{attachedHeroCost}</span>
        </div>
      )}
      {/* Bystander tab — sticks up above the card top */}
      {attachedBystanders > 0 && (
        <div
          className="absolute -translate-x-1/2 flex items-center gap-1 pointer-events-none"
          style={{
            top: -15,
            left: hasAttachedHero ? 'calc(50% + 32px)' : '50%',
            backgroundColor: '#c4a800',
            border: '2px solid #f0c000',
            borderBottom: 'none',
            borderRadius: '4px 4px 0 0',
            padding: '2px 8px 3px',
            fontSize: '9px',
            fontWeight: 700,
            color: '#1a1000',
            whiteSpace: 'nowrap',
            zIndex: 20,
            boxShadow: '0 -2px 6px rgba(196,168,0,0.5)',
          }}
        >
          <span>👤</span>
          <span>×{attachedBystanders}</span>
        </div>
      )}
      {/* Name row */}
      <div className="flex items-center gap-1 min-w-0">
        <span className="truncate text-[12px] font-bold leading-tight text-neutral-100">{def.name}</span>
      </div>
      {/* Type label — "Villain - Brotherhood" etc. */}
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        Villain - {teamLabel(def.team)}
      </div>
      {/* Card text — pr-8 clears the VP badge; CardText renders inline tokens */}
      {def.text && (
        <div className="my-1 flex-1 pl-3 pr-8 text-[11px] leading-snug text-neutral-300">
          <CardText text={def.text} />
        </div>
      )}
      {!def.text && <div className="flex-1" />}
      {/* Attack — absolute bottom-right. Shows the effective strike:
           - Skrull attach: hero's cost (in green, with * for "variable").
           - Killbot with live twist count: count in green with strikethrough *.
           - variableStrike (no override yet): just the white "*" glyph.
           - Storm debuff: emerald reduced value with strikethrough printed. */}
      <span className="absolute bottom-2 right-2 flex items-center gap-0.5 text-[12px] font-semibold">
        {hasAttachedHero || isKillbotWithStrike ? (
          <>
            <span className="mr-0.5 text-neutral-500 line-through text-[10px]">*</span>
            <span style={{ color: '#4ade80' }}>{displayedAttack}</span>
          </>
        ) : def.variableStrike ? (
          // Printed "*" — variable strike with no Hero attached yet.
          // 14×14 inline-flex wrapper matches the StrikeIcon next to it.
          // Asterisk glyph naturally sits in the upper portion of its em-box,
          // so we shift it down 4px via translateY to land its visible
          // center on the StrikeIcon's middle. Size reduced 25% (36→27).
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              overflow: 'visible',
              color: '#ffffff',
              fontSize: 27,
              lineHeight: 1,
              fontWeight: 700,
              transform: 'translateY(4px)',
            }}
          >
            *
          </span>
        ) : locationDebuff > 0 ? (
          <>
            <span className="mr-0.5 text-neutral-500 line-through">{def.attack}</span>
            <span style={{ color: '#34d399' }}>{Math.max(0, def.attack - locationDebuff)}</span>
          </>
        ) : (
          <span className="text-white">{def.attack}</span>
        )}
        <StrikeIcon />
      </span>
      <VpBadge vp={def.vp} label={(def.vpScale || def.vpScaleClass) ? `${def.vp}*` : undefined} />
    </div>
  );
}

// ─── Henchman card ────────────────────────────────────────────────────────────
export function HenchmanCardArt({
  def, wide = false, attachedBystanders = 0,
}: {
  def: HenchmanCardDef;
  wide?: boolean;
  attachedBystanders?: number;
}) {
  const widthClass  = wide ? 'w-full'  : 'w-[230px]';
  const heightClass = wide ? 'h-36'    : 'h-[165px]';

  return (
    <div
      style={{ borderWidth: 2, borderColor: '#eab308', borderStyle: 'solid' }}
      className={`relative flex ${heightClass} ${widthClass} flex-col items-stretch rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-2 text-left`}
    >
      {/* Bystander tab — sticks up above the card top */}
      {attachedBystanders > 0 && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 pointer-events-none"
          style={{
            top: -15,
            backgroundColor: '#c4a800',
            border: '2px solid #f0c000',
            borderBottom: 'none',
            borderRadius: '4px 4px 0 0',
            padding: '2px 8px 3px',
            fontSize: '9px',
            fontWeight: 700,
            color: '#1a1000',
            whiteSpace: 'nowrap',
            zIndex: 20,
            boxShadow: '0 -2px 6px rgba(196,168,0,0.5)',
          }}
        >
          <span>👤</span>
          <span>×{attachedBystanders}</span>
        </div>
      )}

      {/* Line 1: card name — mirrors hero card layout */}
      <div className="flex items-center gap-1 min-w-0">
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold leading-tight text-neutral-100">{def.name}</span>
      </div>

      {/* Line 2: type label */}
      <div className="flex items-center gap-1">
        <span className="text-[12px] font-medium" style={{ color: '#eab308' }}>
          Henchman - Villain
        </span>
      </div>

      {/* Card text — pr-8 keeps text clear of the VP badge on the right edge */}
      {def.text && (
        <div className="mb-1 flex-1 pl-3 pr-8 pt-3 text-[12px] leading-snug text-neutral-300">
          <CardText text={def.text} />
        </div>
      )}
      {!def.text && <div className="flex-1" />}

      {/* Attack — absolute bottom-right, same position as the cost badge on hero cards */}
      <span className="absolute bottom-2 right-2 flex items-center gap-0.5 text-[12px] font-semibold text-white">
        {def.attack}<StrikeIcon size={16} />
      </span>

      <VpBadge vp={def.vp} />
    </div>
  );
}

// ─── Tactic card ─────────────────────────────────────────────────────────────
/** One of a mastermind's four tactic cards. Earned by landing a hit. */
export function TacticCardArt({
  def, wide = false, mastermindName, attack,
}: {
  def: TacticCardDef;
  wide?: boolean;
  /** Name of the mastermind this tactic belongs to (e.g. "Red Skull"). */
  mastermindName?: string;
  /** Mastermind's attack value — shown in the footer with the strike icon. */
  attack?: number;
}) {
  const borderColor = '#DC143C'; // crimson — same family as the mastermind card
  const widthClass = wide ? 'w-full' : 'w-[220px]';
  const typeLabel = mastermindName
    ? `Mastermind Tactic - ${mastermindName}`
    : 'Mastermind Tactic';

  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid' }}
      className={`relative flex h-40 ${widthClass} flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-2`}
    >
      <div className="flex items-center gap-1 min-w-0">
        <span className="truncate text-[12px] font-bold leading-tight text-neutral-100">{def.name}</span>
      </div>
      <div className="truncate text-[9px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        {typeLabel}
      </div>
      {def.text && (
        <div className="mt-3 mb-1 flex-1 pr-7 text-[11px] leading-snug text-neutral-300">
          <CardText text={def.text} />
        </div>
      )}
      {!def.text && <div className="flex-1" />}
      {/* Attack stat — pinned to absolute bottom-right, clear of the VP badge */}
      {attack !== undefined && (
        <span className="absolute bottom-2 right-2 flex items-center gap-0.5 text-[12px] font-semibold text-white">
          {attack}<StrikeIcon />
        </span>
      )}
      <VpBadge vp={def.vp} />
    </div>
  );
}

// ─── System card (wound / bystander / master strike / scheme twist) ───────────
/**
 * Plain colored card with a centered name. Used in the sandbox browse panel
 * AND in the board's hand display for non-hero cards (wounds, bystanders).
 *
 * `wide` stretches to fill the parent; default is the 220 px fixed sandbox
 * size. Hand cards in the board use the h-28 height override.
 */
export function SystemCardArt({
  name, borderColor, vp, bg, text, typeLabel,
  wide = false, height = 'h-[165px]',
}: {
  name: string;
  borderColor: string;
  vp?: number;
  bg?: string;
  /** When provided, switches from centered-name to name-at-top + ability-text layout. */
  text?: string;
  /** Optional sub-label rendered below the name (e.g. mastermind name for Master Strike).
   *  Always occupies a row — invisible when omitted — so ability text aligns with
   *  hero card ability text regardless of whether a label is shown. */
  typeLabel?: string;
  wide?: boolean;
  height?: 'h-28' | 'h-32' | 'h-40' | 'h-[165px]';
}) {
  const widthClass = wide ? 'w-full' : 'w-[220px]';

  if (text) {
    // Name-at-top layout. Two-row header matches hero card structure so ability
    // text starts at the same vertical position as on hero cards.
    return (
      <div
        style={{ borderWidth: 2, borderColor, borderStyle: 'solid', background: bg }}
        className={`relative flex ${height} ${widthClass} flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-2`}
      >
        {/* Row 1 — card name */}
        <span className="text-[12px] font-bold leading-tight text-neutral-100">{name}</span>
        {/* Row 2 — type label (mirrors hero card's class-name row). Transparent when absent
             so it still takes up space and keeps the ability text at a consistent height. */}
        <div
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: typeLabel ? borderColor : 'transparent' }}
        >
          {typeLabel ?? ' '}
        </div>
        {/* Ability text — pt-3 + text-[12px] matches hero card text start position */}
        <div className="mb-1 flex-1 pr-2 pt-3 text-[12px] leading-snug text-neutral-300">
          <CardText text={text} />
        </div>
        {vp !== undefined && <VpBadge vp={vp} />}
      </div>
    );
  }

  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid', background: bg }}
      className={`relative flex ${height} ${widthClass} items-center justify-center rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950`}
    >
      <span className="text-[14px] font-bold text-neutral-100">{name}</span>
      {vp !== undefined && (
        <div
          aria-label={`${vp} VP`}
          className="absolute right-1 top-1/2 -translate-y-1/2 flex h-[26px] w-[26px] items-center justify-center rounded-full font-sans text-[11px] font-bold shadow"
          style={{ backgroundColor: '#b91c1c', border: '1px solid #ef4444', color: '#fff' }}
        >
          {vp}
        </div>
      )}
    </div>
  );
}
