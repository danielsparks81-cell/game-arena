---
name: heroscape-figures
description: >
  Turn a photo of a painted miniature into an in-game HeroScape board figure (a
  cut-out standee on a player-colour disc). USE THIS whenever the user sends photos of
  minis / miniatures / figures to add to the HeroScape board, or asks to cut out / knock
  out / background-remove a figure, add or replace a standee, fix a figure's base / crop /
  centering / sizing / placement on the disc, or reshoot a figure. Covers the photography
  spec, the bg-knockout cut, verification, deploy, and the board's crop/center/size rules.
---

# Pictures → in-game HeroScape figure

A board figure is a **flat camera-facing billboard** of the user's own painted mini, cut
out of a photo and seated on a 3D player-colour disc. The moulded plastic base is **cropped
off** and the colour disc becomes the base. Because it's a flat billboard, the base can
never lie flat — it must be cut away (see Rules).

## Pipeline (do this each time)

1. **Identify** which card each photo is (ask if unsure). Note `cardId` and, for squads,
   the trooper index. Card ids + which are 2-hex (`baseSize: 2`) are in
   `src/lib/games/heroscape/content.ts`.
2. **Find the source files** — the user drops photos in their Downloads folder; grab the
   newest N (`ls -t *.jpg | head`). Thumbnail-montage several at once to map file→figure.
3. **Knock out** each with `bg-knockout.mjs` (in the sibling `heroscape-extract/` tools
   folder, which has `@napi-rs/canvas`). See *Cutting*.
4. **Verify** the cut on a checkerboard montage — look for erosion (thin weapons, light
   capes, pale parts) and a clean silhouette. Re-cut at a different `tol` if needed.
5. **Measure exposure** (mean luma of opaque pixels). ~150–160 = good → deploy RAW.
   ~175+ = overexposed (see Photography); deploy raw anyway and tell the user to drop
   exposure next time — do NOT post-correct (see Rules).
6. **Deploy**: copy to `public/heroscape/figures/<cardId>.png` (hero) or
   `<cardId>-<index>.png` per squad trooper. Refresh the `<cardId>.png` fallback too.
7. **Crop/size** are auto-detected at render (see Rules) — only add a manual
   `cropOverride` in `figureBase.ts` if a figure reads wrong.
8. **typecheck → commit → push** (push = auto-deploy). End commit bodies with the
   Co-Authored-By line. The repo is PUBLIC — never commit secrets.

## Photography spec (tell the user)

- **Same lighting, angle, and distance every time** (the user's stated rule) — consistency
  is what makes the rest work.
- **Bright, even, MATTE white** background (matte avoids glossy hotspots).
- **Don't overexpose.** A white card bounces a lot of fill and blows the figure out
  (washed, low-contrast). Drop **−0.7 to −1 EV** (or one fewer / bounced light). Aim for a
  figure mean luma ~155, not ~175. *Validated:* a −1 EV reshoot landed a cream figure at
  157 with no correction needed.
- Soft, slightly warm light reads fine; the figure just needs to be clearly brighter and
  more saturated than the card without clipping.
- ⭐ **A PALE/WHITE figure that "won't cut" on a white card is an OVEREXPOSURE problem, not a
  background problem.** If the card is blown out (clips to 255) and the figure's whites are
  also ~255, they're identical → uncuttable (the figure dissolves; only its dark parts and the
  silhouette survive). **Fix: drop exposure so the white card reads an un-clipped light GREY
  (~200).** That restores the separation — the figure's whites sit a notch brighter than the
  card — so a **gentle `tol` (~20)** keys it cleanly, and the colours stay TRUE (a neutral grey
  bg doesn't shift white-balance). *Validated on Nilfheim (white bones + black wings):* blown
  white = only floating wings survived; the same figure on an un-clipped grey card cut whole at
  tol 20, raw, accurate. Go LOW on tol — the pale extremities (a thin neck/tail) are the margin
  and erode first as tol climbs.
- **Saturated (blue/green) bg is a FALLBACK, not the first move.** It separates a two-tone
  figure by hue, but a big saturated field fools the phone's auto white-balance into a WARM cast
  (whites→gold, blacks→tan; measured (203,179,144) on a blue Nilfheim cut). If you must use it,
  LOCK white balance (Pro/Expert manual WB ~5000–5500K, or long-press AE/AWB lock, or a grey
  card in-frame), or neutralise after with `wb.mjs` (see Cutting) — but the un-clipped-grey
  approach above is simpler and gives a raw, accurate cut with no correction. (User PREFERRED
  the warm raw blue over a wb-corrected one once — don't assume neutralising is wanted; ask.)

## Cutting — `bg-knockout.mjs`

`node bg-knockout.mjs <in.jpg> <out.png> [tol=30] [maxW=600] [sat=0]`
Keeps a pixel only if it's NOT within `tol` of a bright-low-sat backdrop sample AND it's
border-connected; enclosed light details (a blade, a face) survive. Trims to the figure
and writes a transparent PNG (the moulded base is KEPT in the PNG — it's cropped at render).

**`tol` by figure tone** (the key knob):
- **Dark** (black coats, grey robots, olive soldiers): `tol 36–44`, `sat 0`.
- **Warm / cream / bone** (Marro, Ne-Gok-Sa): `tol 36`, `sat 0` — keys cleanly off BRIGHT
  white (the body sits ~75 RGB-units from white). Impossible on a dim/grey backdrop.
- **Pale / white / silver** (white kimono, silver wings/armour): `tol 28–30` (gentle) or
  the light parts erode at the silhouette edge.
- `sat>0` (~0.18) only as the inversion fix for a dim/warm backdrop (rarely needed on
  clean white). `sat 0` keeps dark figure parts.
- **Saturated (blue/green) backdrop:** the bright-low-sat ref filter rejects all the coloured
  refs, so the tool falls back to sampling them and keys the colour anyway — use a HIGHER
  `tol` (~60) since the figure sits far from the bg in RGB, and **`sat 0`** (a `sat>0` would
  delete the figure's own near-neutral whites). Then white-balance-correct (next line).
- **`wb.mjs <in.png> <out.png> [strength] [lo] [hi] [satMax]`** — neutralises a global colour
  cast (e.g. the auto-WB warm shift from a saturated bg). Reference = opaque MIDTONE
  (`lo..hi` luma, default 110–225) NEAR-NEUTRAL (`sat<satMax`) pixels — the parts that *should*
  be grey but got tinted, skipping clipped highlights and the genuinely-coloured bits — then
  per-channel gains to neutralise. It removes a cast, NOT a saturation boost, so it won't
  overcook warm figures the way `tone.mjs` did. Stopgap only; locked in-camera WB beats it.

**Verify** by compositing the cut(s) on a checkerboard (`@napi-rs/canvas`) and reading it.
Re-cut if a thin weapon/cape/pale region is eaten. A low-contrast figure on a dim backdrop
**cannot** be keyed — ask for a bright-white reshoot.

## The board's crop / center / size rules (how a figure sits)

These are implemented in `src/components/HeroBoard3D.tsx` (`Standee`, `useOpaqueBoundsV`)
and `src/lib/games/heroscape/figureBase.ts` (`analyzeCut`, `cropOverride`).

- **CROP at the base's widest band** (user's rule). The moulded base flares wider than the
  feet; cut at the **top of that widest band** so the base is removed and the figure butts
  *inside* the player disc. `analyzeCut` auto-detects this; it's the **fallback** — every
  current figure is hand-pinned in `cropOverride`/`BASE_CROP_OVERRIDE` because silhouette
  detection fails on long coats/robes (solid to the floor), splayed legs/claws (as wide as
  the base), capes, and dragons. New figures get the auto guess.
- **CENTER on the BASE, not the figure** (user's rule). `baseCenterX` = the midpoint of the
  disc's **bottom rim** (a band just above the very bottom), NOT the widest row — a
  cape/shield/weapon hanging beside the base widens the widest row and drags the centre
  sideways (it was over-shifting figures left). The rim sits below all that. Shift the plane
  so the centre lands on the hex centre, **full shift** (no "split the difference"). A
  sword/arm **overhanging** into a neighbour hex is fine and intended.
- **SIZE by the BASE — never resize to a uniform size** (user's rule: "figures should be
  different sizes"). Every mini is on the same physical base, so the base is a built-in
  ruler: scale so the detected base width renders at `BASE_DISC_W`. A taller mini has more
  pixels above that same base → comes through taller. **`figH/baseW` is a within-image
  ratio, so it's immune to the cut-out being normalised to a fixed pixel width.** One knob
  (`BASE_DISC_W`) scales the whole roster. (2-hex figures still use the legacy height-stat
  `figScale` until their peanut base is calibrated.)
- **SINK to the same level for all.** The cut edge sits at the disc top (`pivotY = DISC_H`)
  for every figure; the billboard pivots there so orbiting rotates it in place.
- **Billboard:** 1-hex figures full-billboard (always face camera); 2-hex lock tilt/roll
  and rotate around vertical only.
- **2-hex must NOT flip (head locked to a world direction).** A 2-hex plane turns to face
  the camera from whichever side it's on; that turn would mirror the photo so the figure's
  head/lead **jumps to the opposite hex** as you orbit past the back — the user's rule is the
  head must always face the **same** direction. Fix: mirror the texture (`planeRef.scale.x =
  -1`) **in lockstep** with that facing-flip, so the head stays world-stable. The swap lands
  exactly when the plane goes edge-on (camera crossing the long axis), so it's invisible. (If
  the head ends up locked over the *trail* hex instead of the lead, flip the scale sign — it's
  still no-flip either way; the sign just picks which end the head sits over.)
- **2-hex disc = a PEANUT** (a lobe over each hex + a pinched waist), not a uniform pill;
  extruded via `peanutShape`. 1-hex disc = a cylinder.
- **sRGB:** the figure shader manually encodes linear→sRGB — a custom ShaderMaterial gets
  no output colour pass, so without it figures render too dark.

## Hard-won gotchas

- **Deploy RAW; never post-correct colour.** A saturation boost overcooks cream/warm
  figures into orange. `tone.mjs` (adaptive exposure/sat) exists but is **retired** —
  fixing exposure in-camera always beats it. If a figure is washed/orange, reshoot.
- A **flat horizontal crop can't keep a weapon/claw that rests ON the base** (Drake's
  sword tip, Marro claws) — accept the minor loss; it's a billboard, not a 3D model.
- **Leftover background white** (a small pure-white gap between legs/under an arm that the
  knockout's LARGE-pocket cull missed, showing as a white blob on the board): do NOT strip
  it by a COLOUR THRESHOLD. A figure's own white/silver/cream is the same brightness, so a
  threshold erodes it — a blanket luma>247 strip ate ~1000px of Raelin's silver wings and
  had to be reverted. Remove it by **connectivity** instead: re-cut that figure at a higher
  `tol` (the knockout removes border-connected backdrop, edge-aware), or lower the knockout's
  enclosed-pocket size floor. That spares the figure's interior light areas. It's a per-cut
  fix, not a roster-wide pass.
- **EXIF rotation:** a tall figure shot in portrait may display sideways in the Read tool,
  but `@napi-rs/canvas` applies the EXIF so the cut comes out upright. Don't pre-rotate by
  how Read shows it — cut first, then check.
- **Squads:** one cut per trooper, `<cardId>-<index>.png`.
- Each card also needs a **card scan** (`public/heroscape/cards/<cardId>.jpg`) for the
  draft/hover panel — separate asset, see the figures memory.
- **Node path note:** call the tools with Windows-style paths; `/tmp` maps oddly — write
  temp files into the local tools folder.

## Inspecting

`/heroscape-sandbox` (TopBar "⬡ HS figures") is a flat gallery of every figure on its disc;
click one to open it on a hex in the real 3D board (orbit/zoom). Use it to vet a new cut's
crop/center/size. 2-hex figures get a 2nd hex there so their peanut disc shows.
