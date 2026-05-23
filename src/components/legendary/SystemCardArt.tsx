// Shared card art for non-hero cards — villains, henchmen, and system cards
// (wounds, bystanders, master strikes, scheme twists).
//
// Imported by both the sandbox (browse preview) and the live board (CitySlot,
// HandCard). Keeping them here means the board and sandbox can't drift apart.

import type { VillainCardDef, HenchmanCardDef } from '@/lib/games/legendary';

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
export function VpBadge({ vp }: { vp: number }) {
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
  def, wide = false, attachedBystanders = 0,
}: {
  def: VillainCardDef;
  wide?: boolean;
  attachedBystanders?: number;
}) {
  const borderColor = '#ef4444'; // covert red — villains have no team color
  const widthClass = wide ? 'w-full' : 'w-[220px]';

  return (
    <div
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid' }}
      className={`relative flex h-40 ${widthClass} flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-2`}
    >
      {/* Name row */}
      <div className="flex items-center gap-1 min-w-0">
        <span className="truncate text-[12px] font-bold leading-tight text-neutral-100">{def.name}</span>
      </div>
      {/* Type label */}
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        Villain
      </div>
      {/* Card text */}
      {def.text && (
        <div className="my-1 flex-1 px-1 text-[11px] leading-snug text-neutral-300">{def.text}</div>
      )}
      {!def.text && <div className="flex-1" />}
      {/* Footer: bystander count left, attack right */}
      <div className="mt-auto flex items-end justify-between">
        {attachedBystanders > 0 ? (
          <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">
            +{attachedBystanders} 👤
          </span>
        ) : <span />}
        <span className="flex items-center gap-0.5 text-[12px] font-semibold text-white">
          {def.attack}<StrikeIcon />
        </span>
      </div>
      <VpBadge vp={def.vp} />
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
  const widthClass = wide ? 'w-full' : 'w-[220px]';

  return (
    <div
      style={{ borderWidth: 2, borderColor: '#eab308', borderStyle: 'solid' }}
      className={`relative flex h-40 ${widthClass} flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-2`}
    >
      <div className="flex items-center gap-1 min-w-0">
        <span className="truncate text-[12px] font-bold leading-tight text-neutral-100">{def.name}</span>
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#eab308' }}>
        Henchman
      </div>
      <div className="flex-1" />
      {/* Footer: bystander count left, attack right */}
      <div className="mt-auto flex items-end justify-between">
        {attachedBystanders > 0 ? (
          <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">
            +{attachedBystanders} 👤
          </span>
        ) : <span />}
        <span className="flex items-center gap-0.5 text-[12px] font-semibold text-white">
          {def.attack}<StrikeIcon />
        </span>
      </div>
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
  name, borderColor, vp, bg, text,
  wide = false, height = 'h-[165px]',
}: {
  name: string;
  borderColor: string;
  vp?: number;
  bg?: string;
  /** When provided, switches from centered-name to name-at-top + body-text layout. */
  text?: string;
  wide?: boolean;
  height?: 'h-28' | 'h-32' | 'h-40' | 'h-[165px]';
}) {
  const widthClass = wide ? 'w-full' : 'w-[220px]';

  if (text) {
    // Name-at-top layout (matches hero card structure) for cards with ability text.
    return (
      <div
        style={{ borderWidth: 2, borderColor, borderStyle: 'solid', background: bg }}
        className={`relative flex ${height} ${widthClass} flex-col rounded-lg bg-gradient-to-br from-neutral-900 to-neutral-950 p-2`}
      >
        <span className="text-[12px] font-bold leading-tight text-neutral-100">{name}</span>
        <div className="mt-1 flex-1 text-[10px] leading-snug text-neutral-300">{text}</div>
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
