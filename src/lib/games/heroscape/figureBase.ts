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
  ne_gok_sa: 0.20,        // reshot 2026-06-17 clean (was the eroded cream-on-grey); clawed feet
  zettian_guards: 0.28,
  deathwalker_9000: 0.16, // reshot 2026-06-17 on clean white
  thorgrim: 0.18,         // reshot 2026-06-17 on clean white; flat disc base
  raelin: 0.11,           // reshot; tall (wings up) so the base is a small fraction
  finn: 0.13,             // reshot
  syvarris: 0.12,         // reshot
  agent_carr: 0.13,       // reshot 2026-06-17 (trenchcoat + visor + sword); boots on disc
  krav_maga: 0.13,        // RE-reshot 2026-06-17 (3 agents, dark suits); boots flat on disc
  airborne_elite: 0.14,   // reshot 2026-06-17 (4 olive paratroopers); boots flat on disc
  grimnak: 0.13,          // 2-hex oval base, tall rider
  mimring: 0.15,          // 2-hex dragon, low base
  nilfheim: 0.15,         // 2-hex dragon, low base
  theracus: 0.14,         // 2-hex flyer, low base
  braxas: 0.16,           // big dragon, low base
  // Marro Warriors — RE-reshot 2026-06-17 at correct exposure (meanL ~155-163) and
  // deployed RAW (no tone.mjs — the post-correction had overcooked the cream into
  // orange). Lean LOW: the clawed bird-feet splay onto the disc, so cut at the ankle
  // and let the 3D player disc hide the thin remaining sliver rather than slice feet.
  marro_warriors: 0.20,   // card fallback
  'marro_warriors-1': 0.20,
  'marro_warriors-2': 0.21,
  'marro_warriors-3': 0.20,
  'marro_warriors-4': 0.19,
  // Tarn Vikings — reshot 2026-06-17 on clean white (boots flat on the disc → clean
  // line; meanL 118-146, intrinsically dark figures so deployed RAW). Tall poses
  // (raised swords/spears) make the disc a small fraction, line ~0.13-0.14:
  tarn_vikings: 0.14,
  'tarn_vikings-1': 0.13,
  'tarn_vikings-2': 0.13,
  'tarn_vikings-3': 0.14,
  'tarn_vikings-4': 0.14,
  // Izumi Samurai — reshot 2026-06-17 on clean white (white-robe trooper keyed at
  // tol 30 like Raelin; the two red-armor ones at 36). Feet sit flat ON the disc so
  // the cut is clean — line just below the boots ~0.15:
  izumi_samurai: 0.15,
  'izumi_samurai-1': 0.15,  // white robe + katana
  'izumi_samurai-2': 0.16,  // red armor + silver cleaver (wide stance)
  'izumi_samurai-3': 0.15,  // red/white armor + katana (crouched)
};

/** The crop line for a figure: a per-squad-member override (`<card>-<index>`) wins
 *  over the card value, which wins over the global default. */
export function cropFor(cardId: string, index: number): number {
  return BASE_CROP_BY_CARD[`${cardId}-${index}`] ?? BASE_CROP_BY_CARD[cardId] ?? BASE_CROP;
}
