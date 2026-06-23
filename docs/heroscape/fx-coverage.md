# HeroScape — sound & animation coverage

Tracking what has audio/visual feedback and what still needs it. Update this as FX land.

Legend: ✅ done · 🟡 partial · ⬜ missing

## How FX are wired (so additions are consistent)
- **Board animations** — the engine calls `setEffect(s, kind, from, to)` (engine.ts ~6191) to stamp `state.lastEffect`; `HeroBoard3D` watches it and spawns the matching VFX component. Kinds today: `fire_line`, `blast`, `counter_strike`, `chomp`, `ice_shard`, `acid_breath` (→ `BreathFx`/`BlastFx`/`SwordFx`/`FangsFx`).
- **Dice overlays** — `setLastRoll(s, {title, dice, …})` drives the big d20 overlay; normal attacks use the attack/defense dice overlay (`rollAttack`).
- **Standee motion** — walk (hex-line, center-to-center) + flying arc, in `HeroBoard3D`'s standee `useFrame`.
- **Glyph events** — the "Glyph triggered" banner (`HeroScapeBoard` `glyphFlash`).
- **Sound** — `import { sounds } from '@/lib/sounds'`. A HeroScape set is now wired: `hsDice` (combat + d20 rolls), per-figure `hsHit`/`hsBlocked`/`hsDeath` (revealed as each defender resolves in the overlay), special stings off `lastEffect` (`hsChomp`/`hsBlast`/`hsFire`/`hsIce`/`hsAcid`/`hsSword`), `hsGlyph` (reveal), and `win`/`draw` at game end. `hsStep` exists but isn't hooked yet (footsteps deferred). Plus Mind Shackle's spoken `mindFreak`.

## Coverage table

| Event / power | Owner | Animation | Sound | Notes / next step |
|---|---|---|---|---|
| Normal attack | all | ✅ dice overlay | ⬜ | add a dice-rattle + a hit/clash sting; an impact flash on the target would help |
| Defense roll | all | ✅ (same overlay) | ⬜ | shares the attack roll sound |
| Initiative roll | — | ✅ d20 overlay | ⬜ | short d20 rattle |
| Move / walk | all | ✅ hex-by-hex walk | ⬜ | soft footstep/scuff per hex |
| Flying | Raelin, Mimring | ✅ fly arc | ⬜ | whoosh on takeoff/landing |
| Fall (normal/major/extreme) | all | ⬜ | ⬜ | a drop + thud (and a bigger one for extreme) is the most missed beat |
| Wound / destroy | all | 🟡 wound pips; figure removed | ⬜ | a death fade-out + a hit/death sound |
| Berserker Charge | Tarn | ✅ d20 overlay | ⬜ | growl/charge sting |
| Water Clone | Marro | ⬜ | ⬜ | a watery shimmer when a clone returns |
| Chomp | Grimnak | ✅ fangs + d20 | ⬜ | bite/crunch — high impact, top pick |
| Grenade | Airborne Elite | ✅ blast | ⬜ | throw whistle + explosion |
| Mind Shackle | Ne-Gok-Sa | ✅ d20 | ✅ `mindFreak` | the one fully-sounded power |
| Fire Line | Mimring | ✅ fire tunnel | ⬜ | roaring flame |
| Explosion | Deathwalker 9000 | ✅ blast | ⬜ | big boom |
| Ice Shard | Nilfheim | ✅ shard streak | ⬜ | icy crack/shatter |
| Acid Breath | Braxas | ✅ acid spray | ⬜ | hiss/sizzle |
| Wild Swing | Jotun | ⬜ (uses attack overlay) | ⬜ | a sweeping-arc VFX + whoosh |
| Queglix | (soulborg) | ⬜ (uses attack overlay) | ⬜ | rapid laser bursts VFX + sound |
| Throw | Jotun | 🟡 d20 only | ⬜ | a thrown-figure ARC (figure flies to landing) + grunt/impact |
| Carry | Theracus | 🟡 carrier moves; passenger not shown riding | ⬜ | render the passenger riding along; flap/whoosh |
| The Drop | Airborne Elite | ✅ d20 + teleport snap | ⬜ | parachute/landing thud per figure |
| Counter Strike | Izumi Samurai | ✅ sword swipe back | ⬜ | blade clash |
| Stealth Dodge | Krav Maga | ⬜ (passive) | ⬜ | a quick dodge flicker + whiff sound when it negates |
| Glyph reveal / trigger | — | ✅ "Glyph triggered" banner | ⬜ | a reveal chime; distinct sting for a curse vs a boon |
| Order-marker reveal | — | ⬜ | ⬜ | a small flip sound at turn start |
| Victory | — | ✅ win banner | ⬜ | wire the existing `sounds.win` |

## Summary & recommendations
- **Animations: good.** Every special *attack* has a distinct VFX, plus dice overlays, walk/fly motion, and the glyph banner. Gaps are mostly non-attack beats: **fall impact, death fade, Wild Swing / Queglix / Throw arcs, Water Clone, carry passenger**.
- **Sound: core loop + specials + footsteps + fall DONE** (✅). Wired: dice rattle (combat + d20), per-figure hit / blocked / death, all six special stings, glyph reveal, victory/draw, **footstep per move** (`hsStep`), and **fall thud** (`hsFall`, on a fresh `fall` log line). Remaining (low priority): **flying takeoff whoosh** (needs wiring in the 3D layer) and an **order-marker flip** at turn start.
- Add new sounds as methods in `src/lib/sounds.ts` (Web Audio, same pattern) and call them from the same effect hooks that fire the animations (`lastEffect` / `lastRoll` / `lastAttack` overlay), so audio and visuals stay in sync.
