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
  drake: 0.25,            // line just below the boots (verified on image)
  ne_gok_sa: 0.23,        // line across the lower claws (verified on image)
  zettian_guards: 0.28,
  deathwalker_9000: 0.18,
  raelin: 0.16,
  grimnak: 0.13,          // 2-hex oval base, tall rider
  mimring: 0.15,          // 2-hex dragon, low base
  nilfheim: 0.15,         // 2-hex dragon, low base
  theracus: 0.14,         // 2-hex flyer, low base
  braxas: 0.16,           // big dragon, low base
  // Marro Warriors — tall oval bases, per-pose feet lines:
  marro_warriors: 0.34,   // card fallback
  'marro_warriors-1': 0.36,
  'marro_warriors-2': 0.30,
  'marro_warriors-3': 0.33,
  'marro_warriors-4': 0.36,
};

/** The crop line for a figure: a per-squad-member override (`<card>-<index>`) wins
 *  over the card value, which wins over the global default. */
export function cropFor(cardId: string, index: number): number {
  return BASE_CROP_BY_CARD[`${cardId}-${index}`] ?? BASE_CROP_BY_CARD[cardId] ?? BASE_CROP;
}
