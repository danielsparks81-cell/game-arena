/** Curated set of dark-UI-friendly accent colors. Both the client-side
    picker UI and the server-side updateAccentColor validator import this
    same list so users can't store a color that's not on the palette. */
export const ACCENT_PALETTE = [
  '#10b981', // emerald
  '#84cc16', // lime
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#1d4ed8', // navy (blue-700)
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#64748b', // slate (slate-500 — darker than the original slate-400 which read as near-white)
] as const;

export type AccentColor = typeof ACCENT_PALETTE[number];

/** Default for any profile that hasn't picked one yet — must match the DB
    migration's default. Also used as a fallback if a stored color somehow
    isn't on the current palette (e.g. you removed a color and old profiles
    still reference it). */
export const DEFAULT_ACCENT: AccentColor = '#10b981';

export function isValidAccent(color: string | null | undefined): color is AccentColor {
  if (!color) return false;
  return (ACCENT_PALETTE as readonly string[]).includes(color);
}

export function safeAccent(color: string | null | undefined): AccentColor {
  return isValidAccent(color) ? color : DEFAULT_ACCENT;
}
