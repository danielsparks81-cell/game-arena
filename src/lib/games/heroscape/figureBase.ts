// Base-crop logic — SHARED by the 3D board (HeroBoard3D) and the 2D figure gallery
// (/heroscape-sandbox) so the two never drift.
//
// THE RULE (analyzeCut): a figure's moulded plastic base flares WIDER than its feet, so
// it reads as the widest horizontal band at the bottom of the cut-out. We find that band
// and crop at its TOP — where the silhouette narrows from the base flare up to the
// feet/legs — then seat the figure's cut edge on the player's colour disc (the disc IS
// the base). This auto-detects the crop per image, so almost no figure needs a hand value.
//
// BASE_CROP_OVERRIDE is ONLY for the few where the rule misfires: tall flyers / wings /
// curvy dragons whose widest bottom band is not a clean base disc. A value there wins.

// Hand-tuned per-figure values. The auto rule (analyzeCut) is only a FALLBACK for figures
// not listed here — because silhouette analysis can't reliably find the base top on long
// coats/robes (solid to the floor), splayed legs/claws (as wide as the base), capes, or
// dragons. Almost every current figure is pinned; new figures get a sane auto guess.
export const BASE_CROP_OVERRIDE: Record<string, number> = {
  drake: 0.13, ne_gok_sa: 0.20, zettian_guards: 0.15, deathwalker_9000: 0.15,
  thorgrim: 0.14, raelin: 0.10, finn: 0.13, syvarris: 0.12, agent_carr: 0.13,
  krav_maga: 0.13, airborne_elite: 0.14, major_q9: 0.20,
  grimnak: 0.13, mimring: 0.15, nilfheim: 0.15, theracus: 0.14, braxas: 0.10, jotun: 0.13,
  marro_warriors: 0.20, 'marro_warriors-1': 0.20, 'marro_warriors-2': 0.21, 'marro_warriors-3': 0.20, 'marro_warriors-4': 0.19,
  tarn_vikings: 0.14, 'tarn_vikings-1': 0.13, 'tarn_vikings-2': 0.13, 'tarn_vikings-3': 0.14, 'tarn_vikings-4': 0.14,
  izumi_samurai: 0.14, 'izumi_samurai-1': 0.13, 'izumi_samurai-2': 0.14, 'izumi_samurai-3': 0.14,
};

/** A manual crop override (fraction of figure height, 0 = feet, 1 = top) for figures where
 *  the widest-band rule misfires; `undefined` = use the auto rule. Squad members can be
 *  keyed `<card>-<index>` (wins over the card value). */
export function cropOverride(cardId: string, index: number): number | undefined {
  return BASE_CROP_OVERRIDE[`${cardId}-${index}`] ?? BASE_CROP_OVERRIDE[cardId];
}

/** THE "BLACK DOT" ANCHOR (user's model). A single point on the cut-out — normalized image
 *  coords, x from LEFT, y from TOP (0..1) — that does double duty:
 *    • its Y is the CUT LINE: everything BELOW it is discarded (slices the moulded base off,
 *      and any leftover backdrop white sitting beside the base goes with it), and
 *    • the point itself is the SEAT: it's placed at the disc centre, so it sets left/right
 *      centring AND depth in one mark.
 *  It supersedes cropOverride (the fraction guess) + the auto baseCenterX for any figure
 *  listed here. SIZE is untouched — still the base-width ruler. The disc centre (the "red
 *  dot") is computed by the board, so only this one point is ever needed per figure. */
export const FIGURE_ANCHOR: Record<string, { x: number; y: number }> = {
  // USER-PICKED via the gallery cut-line picker (click the feet → x = centre, y = cut line).
  // These are the authoritative values; they override the crop-fraction + auto-centre.
  agent_carr: { x: 0.58, y: 0.83 },
  'airborne_elite-1': { x: 0.50, y: 0.73 },
  'airborne_elite-2': { x: 0.60, y: 0.80 },
  'airborne_elite-3': { x: 0.50, y: 0.75 },
  'airborne_elite-4': { x: 0.51, y: 0.72 },
  deathwalker_9000: { x: 0.47, y: 0.85 },
  finn: { x: 0.61, y: 0.79 },
  'izumi_samurai-1': { x: 0.69, y: 0.78 },
  'izumi_samurai-2': { x: 0.51, y: 0.73 },
  'izumi_samurai-3': { x: 0.50, y: 0.72 },
  'krav_maga-1': { x: 0.38, y: 0.76 },
  'krav_maga-2': { x: 0.49, y: 0.77 },
  'krav_maga-3': { x: 0.47, y: 0.74 },
  'marro_warriors-1': { x: 0.55, y: 0.77 },
  'marro_warriors-2': { x: 0.48, y: 0.74 },
  'marro_warriors-3': { x: 0.48, y: 0.76 },
  'marro_warriors-4': { x: 0.42, y: 0.74 },
  ne_gok_sa: { x: 0.55, y: 0.80 },
  raelin: { x: 0.67, y: 0.88 },
  drake: { x: 0.59, y: 0.80 },
  syvarris: { x: 0.53, y: 0.82 },
  'tarn_vikings-1': { x: 0.55, y: 0.84 },
  'tarn_vikings-2': { x: 0.44, y: 0.84 },
  'tarn_vikings-3': { x: 0.37, y: 0.80 },
  'tarn_vikings-4': { x: 0.48, y: 0.83 },
  thorgrim: { x: 0.49, y: 0.77 },
  'zettian_guards-1': { x: 0.40, y: 0.80 },
  'zettian_guards-2': { x: 0.40, y: 0.79 },
  // 2-hex big figures — Y (cut) applies; X is ignored for double-space figures (they stay
  // centred on the peanut). The high Y's = these fill the frame with the base at the bottom.
  braxas: { x: 0.43, y: 0.94 },
  grimnak: { x: 0.46, y: 0.92 },
  jotun: { x: 0.50, y: 0.93 },
  major_q9: { x: 0.51, y: 0.89 },
  mimring: { x: 0.40, y: 0.95 },
  nilfheim: { x: 0.46, y: 0.94 },
  theracus: { x: 0.51, y: 0.90 },
};

/** The anchor point for a figure, or `undefined` to fall back to cropOverride + auto-centre.
 *  Squad members keyed `<card>-<index>` win over the card value. */
export function figureAnchor(cardId: string, index: number): { x: number; y: number } | undefined {
  return FIGURE_ANCHOR[`${cardId}-${index}`] ?? FIGURE_ANCHOR[cardId];
}

/** DOUBLE-figure (2-hex) TWO-POINT pick: the two points that should sit ON the two hex marks —
 *  the front-of-BODY and back-of-BODY (NOT the head/tail tips; the head and tail OVERHANG the
 *  marks). Normalized image coords. The board scales the figure so those points sit the
 *  hex-centre distance apart (front→one mark, back→the other), centres it on the peanut by
 *  their midpoint, and crops at the lower of the two. Replaces FIGURE_ANCHOR's size for the
 *  listed doubles; un-picked doubles fall back to the height-stat scale. */
export const FIGURE_SPAN2: Record<string, { fx: number; fy: number; bx: number; by: number }> = {
  // USER-picked (gallery two-click): FRONT (head) + BACK (tail) at the base.
  braxas: { fx: 0.16, fy: 0.94, bx: 0.68, by: 0.93 },
  grimnak: { fx: 0.16, fy: 0.91, bx: 0.73, by: 0.92 },
  jotun: { fx: 0.09, fy: 0.93, bx: 0.90, by: 0.93 },
  major_q9: { fx: 0.11, fy: 0.87, bx: 0.88, by: 0.87 },
  mimring: { fx: 0.15, fy: 0.94, bx: 0.61, by: 0.95 },
  nilfheim: { fx: 0.18, fy: 0.93, bx: 0.72, by: 0.94 },
  theracus: { fx: 0.08, fy: 0.90, bx: 0.89, by: 0.90 },
};

/** The two-point span pick for a 2-hex figure, or `undefined` to fall back. */
export function figureSpan2(cardId: string, index: number): { fx: number; fy: number; bx: number; by: number } | undefined {
  return FIGURE_SPAN2[`${cardId}-${index}`] ?? FIGURE_SPAN2[cardId];
}

/** Analyse a cut-out's alpha and find the base crop by the WIDEST-BAND rule (see top).
 *  Returns the opaque pixel bounds, the crop fraction `clip` (0 = the figure's feet/bottom,
 *  1 = its top), and the feet centroid X (0..1 of width) for re-centring off-centre poses.
 *  A `clipOverride` (from cropOverride) wins over the detected value when provided. */
export function analyzeCut(
  data: Uint8ClampedArray, W: number, H: number, clipOverride?: number,
): { top: number; bottom: number; left: number; right: number; clip: number; baseCenterX: number; baseWidthFrac: number } {
  const op = (x: number, y: number) => data[(y * W + x) * 4 + 3] > 128;
  const width = new Array<number>(H).fill(0);
  let left = W - 1, right = 0;
  for (let y = 0; y < H; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < W; x++) if (op(x, y)) { if (l < 0) l = x; r = x; }
    if (l >= 0) { width[y] = r - l + 1; if (l < left) left = l; if (r > right) right = r; }
  }
  let bottom = H - 1; while (bottom > 0 && width[bottom] === 0) bottom--;
  let top = 0; while (top < H - 1 && width[top] === 0) top++;
  const figH = Math.max(1, bottom - top);
  // The base = the widest band within the bottom 40%. Cut at the TOP of that band, where
  // the silhouette narrows from the base flare to the feet/legs above it.
  const region = Math.max(top, Math.round(bottom - 0.40 * figH));
  let wBase = 0, yRim = bottom;
  for (let y = bottom; y >= region; y--) if (width[y] > wBase) { wBase = width[y]; yRim = y; }
  let y = yRim; while (y > top && width[y] >= 0.80 * wBase) y--;
  const autoClip = Math.min(0.45, Math.max(0.04, (bottom - (y + 1)) / figH));
  const clip = clipOverride ?? autoClip;
  // base WIDTH = the widest bottom row (the disc's diameter), a built-in SCALE RULER:
  // every mini sits on the same physical base, so scaling a figure so this maps to the
  // disc makes its true height come through. (figH/baseW is a within-image ratio, so it's
  // unaffected by the cut-out being normalised to a fixed pixel width.)
  let lr = -1, rr = -1;
  for (let x = 0; x < W; x++) if (op(x, yRim)) { if (lr < 0) lr = x; rr = x; }
  const baseWidthFrac = lr >= 0 ? (rr - lr + 1) / W : 0.5;
  // base CENTRE from the disc's BOTTOM RIM (a band just above the bottom), NOT the widest
  // row — a cape/shield/weapon hanging beside the base skews the widest row sideways and
  // was pulling figures off-centre. The rim is below all that, so it tracks the real disc
  // centre. A sword/arm overhanging into a neighbour hex is fine and intended.
  let cs = 0, cn = 0;
  for (let yy = Math.max(top, Math.round(bottom - 0.09 * figH)); yy <= Math.round(bottom - 0.03 * figH); yy++) {
    let l = -1, r = -1; for (let x = 0; x < W; x++) if (op(x, yy)) { if (l < 0) l = x; r = x; }
    if (l >= 0) { cs += (l + r) / 2; cn++; }
  }
  const baseCenterX = cn ? cs / cn / W : (lr >= 0 ? (lr + rr) / 2 / W : 0.5);
  return { top, bottom, left, right, clip, baseCenterX, baseWidthFrac };
}
