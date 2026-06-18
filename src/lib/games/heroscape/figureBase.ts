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
  grimnak: 0.13, mimring: 0.15, nilfheim: 0.15, theracus: 0.14, braxas: 0.10,
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

/** Analyse a cut-out's alpha and find the base crop by the WIDEST-BAND rule (see top).
 *  Returns the opaque pixel bounds, the crop fraction `clip` (0 = the figure's feet/bottom,
 *  1 = its top), and the feet centroid X (0..1 of width) for re-centring off-centre poses.
 *  A `clipOverride` (from cropOverride) wins over the detected value when provided. */
export function analyzeCut(
  data: Uint8ClampedArray, W: number, H: number, clipOverride?: number,
): { top: number; bottom: number; left: number; right: number; clip: number; baseCenterX: number } {
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
  // Centre on the BASE, not the figure: baseCenterX = the midpoint of the widest bottom
  // row (the disc's diameter). A sword/arm/lunge that overhangs into another hex is fine
  // and intended — only the disc needs to sit on the player's hex.
  let lr = -1, rr = -1;
  for (let x = 0; x < W; x++) if (op(x, yRim)) { if (lr < 0) lr = x; rr = x; }
  const baseCenterX = lr >= 0 ? (lr + rr) / 2 / W : 0.5;
  return { top, bottom, left, right, clip, baseCenterX };
}
