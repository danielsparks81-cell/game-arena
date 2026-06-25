# HeroScape — sound & animation coverage

Tracking what has audio/visual feedback and what still needs it. Update this as FX land.

Legend: ✅ done · 🟡 partial · ⬜ missing

## How FX are wired (so additions are consistent)
- **Board animations** — the engine calls `setEffect(s, kind, from, to)` (engine.ts ~6191) to stamp `state.lastEffect`; `HeroBoard3D` watches it and spawns the matching VFX component. Kinds today: `fire_line`, `blast`, `counter_strike`, `chomp`, `ice_shard`, `acid_breath` (→ `BreathFx`/`BlastFx`/`SwordFx`/`FangsFx`).
- **Dice overlays** — `setLastRoll(s, {title, dice, …})` drives the big d20 overlay; normal attacks use the attack/defense dice overlay (`rollAttack`).
- **Standee motion** — walk (hex-line, center-to-center) + flying arc, in `HeroBoard3D`'s standee `useFrame`.
- **Glyph events** — the "Glyph triggered" banner (`HeroScapeBoard` `glyphFlash`).
- **Sound** — `import { sounds } from '@/lib/sounds'`. The HeroScape set is wired from `HeroScapeBoard`'s effect hooks so audio fires with its animation: `hsDice` (combat + every d20 roll), per-figure `hsHit`/`hsBlocked`/`hsDeath` (as each defender resolves in the overlay), the six special-attack stings off `lastEffect` (`hsChomp`/`hsBlast`/`hsFire`/`hsIce`/`hsAcid`/`hsSword`), `hsGlyph` (reveal banner), `hsStep` (footstep per move), `hsFall` (fresh `fall` log line), `win`/`draw` (game end), and the roll-ceremony death/rise. Spoken `mindFreak` for Mind Shackle. Title-keyed stings off the d20 overlay for the no-VFX powers: `hsBerserk` (Berserker Charge), `hsThrow` (Throw), `hsDrop` (The Drop), `hsWaterClone` (Water Clone). `hsTurn` ticks each turn as the order marker flips up.

## Coverage table

| Event / power | Owner | Animation | Sound | Notes / next step |
|---|---|---|---|---|
| Normal attack | all | ✅ dice overlay | ✅ `hsDice` + `hsHit`/`hsBlocked` | per-defender hit/block as the overlay resolves; an impact flash on the target would still help |
| Defense roll | all | ✅ (same overlay) | ✅ (shared roll) | |
| Initiative roll | — | ✅ d20 overlay | ✅ `hsDice` | |
| Move / walk | all | ✅ hex-by-hex walk | ✅ `hsStep` | soft scuff per hex |
| Flying | Raelin, Mimring | ✅ fly arc | ⬜ | takeoff/landing whoosh still TODO (needs wiring in the 3D layer) |
| Fall (normal/major/extreme) | all | ⬜ | ✅ `hsFall` | a drop + thud VFX (bigger for extreme) is the most-missed VISUAL |
| Wound / destroy | all | 🟡 wound pips; figure removed | ✅ `hsHit`/`hsDeath` | a death fade-out VFX would still help |
| Berserker Charge | Tarn | ✅ d20 overlay | ✅ `hsBerserk` | |
| Water Clone | Marro | ⬜ | ✅ `hsWaterClone` | a watery shimmer VFX when a clone returns still TODO |
| Chomp | Grimnak | ✅ fangs + d20 | ✅ `hsChomp` | |
| Grenade | Airborne Elite | ✅ blast | ✅ `hsBlast` | throw-whistle preamble optional |
| Mind Shackle | Ne-Gok-Sa | ✅ d20 | ✅ `mindFreak` | |
| Fire Line | Mimring | ✅ fire tunnel | ✅ `hsFire` | |
| Explosion | Deathwalker 9000 | ✅ blast | ✅ `hsBlast` | |
| Ice Shard | Nilfheim | ✅ shard streak | ✅ `hsIce` | |
| Acid Breath | Braxas | ✅ acid spray | ✅ `hsAcid` | |
| Wild Swing | Jotun | ⬜ (uses attack overlay) | ⬜ | a sweeping-arc VFX + whoosh |
| Queglix | (soulborg) | ⬜ (uses attack overlay) | ⬜ | rapid laser bursts VFX + sound |
| Throw | Jotun | 🟡 d20 only | ✅ `hsThrow` | a thrown-figure ARC VFX (figure flies to landing) still TODO |
| Carry | Theracus | 🟡 carrier moves; passenger not shown riding | ⬜ | render the passenger riding along; flap/whoosh |
| The Drop | Airborne Elite | ✅ d20 + teleport snap | ✅ `hsDrop` | |
| Counter Strike | Izumi Samurai | ✅ sword swipe back | ✅ `hsSword` | |
| Stealth Dodge | Krav Maga | ⬜ (passive) | ⬜ | a quick dodge flicker + whiff sound when it negates |
| Glyph reveal / trigger | — | ✅ "Glyph triggered" banner | ✅ `hsGlyph` | a distinct ominous sting for a CURSE (Mitonsoul/Wannok/Oreld) vs a boon would add drama |
| Order-marker reveal | — | ⬜ | ✅ `hsTurn` | soft flip as the turn advances |
| Victory | — | ✅ win banner | ✅ `win`/`draw` | |

## Summary & recommendations
- **Animations: good.** Every special *attack* has a distinct VFX, plus dice overlays, walk/fly motion, and the glyph banner. The remaining gaps are non-attack beats: **fall impact, death fade, Wild Swing / Queglix / Throw arcs, Water Clone shimmer, Carry passenger riding.**
- **Sound: comprehensive.** Wired: dice rattle (combat + every d20), per-figure hit / blocked / death, all six special stings, glyph reveal, footstep, fall thud, victory/draw, the roll-ceremony death/rise — and (2026-06-25) **Berserker Charge / Throw / The Drop / Water Clone** stings plus a per-turn **order-marker tick** (`hsTurn`). Remaining (low priority): a **flying takeoff whoosh** (needs the 3D layer), **Wild Swing / Queglix** stings (they reuse the plain attack overlay, no distinct event yet), a **Stealth-Dodge whiff**, and an optional **curse-vs-boon** glyph distinction.
- Add new sounds as methods in `src/lib/sounds.ts` (Web Audio, same pattern) and call them from the same effect hooks that fire the animations (`lastEffect` / `lastRoll` / `lastAttack` overlay), so audio and visuals stay in sync.
