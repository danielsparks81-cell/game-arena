---
name: heroscape-fx
description: Track and add HeroScape sound effects and special-power animations. Use this whenever the user mentions HeroScape sounds, audio, music, animations, VFX, "juice", game feel, or asks what feedback is done vs still missing for a power. Maintains the coverage table at docs/heroscape/fx-coverage.md and adds new FX the wired-up, in-sync way.
---

# HeroScape FX (sound + animation)

Keep `docs/heroscape/fx-coverage.md` current and add new FX so audio + visuals stay in sync.

## How FX are wired (match this)
- **Board animation:** the engine calls `setEffect(s, kind, from, to)` → stamps `state.lastEffect` →
  `HeroBoard3D` spawns the VFX component. Existing kinds: `fire_line`, `blast`, `counter_strike`,
  `chomp`, `ice_shard`, `acid_breath` (→ `BreathFx`/`BlastFx`/`SwordFx`/`FangsFx`).
- **Dice overlay:** `setLastRoll(s, {title, dice, ...})` drives the big d20 overlay; normal attacks use
  the attack/defense overlay (`rollAttack`).
- **Standee motion:** walk (hex-line, centre-to-centre) + fly arc, in `HeroBoard3D`'s standee `useFrame`.
- **Glyph banner:** `HeroScapeBoard` `glyphFlash` (watches the event log for `tag:'glyph'`).
- **Sound:** `import { sounds } from '@/lib/sounds'`. Add new sounds as Web Audio methods in
  `src/lib/sounds.ts` (mirror the existing ones), and **call them from the SAME client effect hook
  that already watches `lastEffect` / `lastRoll`** so the sound fires with its animation.

## To add a sound or animation
1. Find the trigger — an existing `setEffect` / `setLastRoll` / glyph-log event, or add one in the engine.
2. Animation → new VFX kind + component in `HeroBoard3D`. Sound → new method in `sounds.ts`.
3. Fire it from the matching client watcher (don't invent a parallel event path).
4. Update the ✅/🟡/⬜ row in `docs/heroscape/fx-coverage.md`.

## Current state (see the table for detail)
Animations are well covered (every special attack has a VFX, plus dice overlays, walk/fly, glyph
banner). **Sound is the big gap — only `sounds.mindFreak` is wired.** Priority for a sound pass:
(1) core loop heard every turn — dice rattle, hit/clash, wound/death, footstep, victory (`sounds.win`
already exists); (2) per-special stings (Chomp bite, explosion boom, fire roar, ice shatter, acid
hiss, sword clash); (3) polish — fall thud, glyph chime, takeoff whoosh.
