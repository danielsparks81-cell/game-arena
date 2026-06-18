// Per-figure base crop — SHARED by the 3D board (HeroBoard3D) and the 2D figure
// gallery (/heroscape-sandbox) so the two never drift.
//
// Fraction of the FIGURE's height (padding-independent), measured up from the feet,
// that is the moulded plastic base. Both renderers CROP that band off at the line and
// seat the figure's cut edge on the player's colour disc — no recolour, the disc IS
// the base. The line sits across the feet: raise a value if a base sliver still shows
// above the disc, lower it if it crops into the feet. Measured by eye per figure; any
// figure not listed uses BASE_CROP (most single-hex figures sit at ~0.20).
//
// SQUAD members can be keyed individually as `<card>-<index>` (e.g. `marro_warriors-2`)
// when their poses put the feet at different heights; that wins over the card value.
// Use cropFor() so the per-variant override is always applied.
export const BASE_CROP = 0.2;
export const BASE_CROP_BY_CARD: Record<string, number> = {
  drake: 0.17,            // reshot 2026-06-17 (full gun + cables); flat disc
  ne_gok_sa: 0.23,        // line across the lower claws (verified on image)
  zettian_guards: 0.28,
  deathwalker_9000: 0.16, // reshot 2026-06-17 on clean white
  thorgrim: 0.18,         // reshot 2026-06-17 on clean white; flat disc base
  raelin: 0.11,           // reshot; tall (wings up) so the base is a small fraction
  finn: 0.13,             // reshot
  syvarris: 0.12,         // reshot
  krav_maga: 0.14,        // reshot squad (3 agents on thin discs)
  grimnak: 0.13,          // 2-hex oval base, tall rider
  mimring: 0.15,          // 2-hex dragon, low base
  nilfheim: 0.15,         // 2-hex dragon, low base
  theracus: 0.14,         // 2-hex flyer, low base
  braxas: 0.16,           // big dragon, low base
  // Marro Warriors — oval bases; line at the claws where they meet the base top
  // (the brown base only runs to ~0.22-0.26 of the figure; higher slices the legs):
  marro_warriors: 0.24,   // card fallback
  'marro_warriors-1': 0.25,
  'marro_warriors-2': 0.22,
  'marro_warriors-3': 0.24,
  'marro_warriors-4': 0.25,
  // Tarn Vikings — SHORT rocky bases (feet sit compactly on top), line ~0.13-0.16:
  tarn_vikings: 0.15,
  'tarn_vikings-1': 0.16,
  'tarn_vikings-2': 0.14,
  'tarn_vikings-3': 0.14,
  'tarn_vikings-4': 0.15,
};

/** The crop line for a figure: a per-squad-member override (`<card>-<index>`) wins
 *  over the card value, which wins over the global default. */
export function cropFor(cardId: string, index: number): number {
  return BASE_CROP_BY_CARD[`${cardId}-${index}`] ?? BASE_CROP_BY_CARD[cardId] ?? BASE_CROP;
}
