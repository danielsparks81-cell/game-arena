# HeroScape — Card-Data Fidelity Audit (2026-06-27)

Audit of `src/lib/games/heroscape/content.ts` (`HS_CARDS` + `CARD_IDENTITY`) against the
**digit-verified** card reference [`cards.md`](cards.md) — which itself was extracted from the
user's high-res card scans (`extraction/cards-page-1..4.md`). Method: field-by-field diff of
every categorical attribute the user called out — **type, common/unique, faction (general),
species, class, personality, world** — plus stats.

## Verdict

**The 21 Master-Set cards are highly faithful.** Every type, faction, species, class, figure
count, and stat line matches the verified scans exactly — including the deliberate
rebalanced-printing deviations (Marro Warriors 105pts/Range 6, Raelin 125pts, Izumi Attack 2,
Deathreavers 60pts). One identity field was wrong and is **fixed** below. The remaining items
are cards **outside** the verified roster (Eldgrim, Otonashi, and the 6 Big Heroes) plus one
conflict with a prior verbal instruction — all flagged for you to confirm on re-upload.

> ⚠ **Note on Deathreavers species = `Soulborg`:** I initially suspected this was wrong (rats →
> not robots), but `cards.md` line 363 confirms the printed card reads **Soulborg · Deathreaver ·
> Alpha Prime · Tricky**. Code is correct — left as-is. (Checking the scan beat my memory; good
> reminder that "cards win.")

---

## 1. Fixed (high confidence — unambiguous data error vs the verified scan)

| Card | Field | Was | Now | Source |
|---|---|---|---|---|
| **Raelin the Kyrie Warrior** | personality | `Resolute` | **`Merciful`** | `cards.md:177` (RotV index-card scan) — "Warrior · Kyrie · **Merciful** · Valhalla" |

`CARD_IDENTITY.raelin.personality` only drives the reconstructed card header (display, not
rules), so the fix is cosmetic/identity and low-risk. The traits matrix regenerates from it.

---

## 2. Flags — please confirm against the physical cards on re-upload

### ✅ A. The three Grut squads: Common — RESOLVED 2026-06-27

The user uploaded the official index-card PDFs (`HSB_3x5_Heavy_Gruts`, `Index_3x5_Blade_Gruts`,
`Index_3x5_Arrow_Gruts`); text extraction shows all three nameplates read **COMMON SQUAD**.
`content.ts` was already correct (`common: true`) — the error was in `cards.md`, which has now
been fixed. No code change. The earlier "conflict" was my own extraction doc being wrong, not
the game.

### 🟠 A2. Deathreavers — likely Common too (verify next)

`content.ts` currently has Deathreavers as **Unique** (no `common` flag), matching the old
`cards.md`. But Deathreavers were added in the *same* batch that mis-labeled the Gruts, and in
standard HeroScape Deathreavers are a **Common** squad. Their card wasn't in this upload —
**please check the Deathreavers nameplate** (Common vs Unique). If Common, it's a one-line
`common: true` fix in `content.ts` (deathreavers) plus a `cards.md` row update.

### 🟠 B. Eldgrim & Otonashi — playable but absent from the verified roster

Both are in `HS_CARDS` **and** the draft pool, but **not** in `cards.md`'s 21-card verified
roster, so I have no scan to check them against:

| Card | `content.ts` values | Concern |
|---|---|---|
| **Eldgrim the Viking Champion** | Hero · Jandar · Human · Champion · Valiant · Earth · L3 M5 R1 A2 D2 H4 · **30pts** · power `live` but **no ability flags/text** | Not in the scans. Is this a real card you own? The stat line and lack of any printed power suggest a placeholder. Please re-upload its card. |
| **Otonashi** | Hero · Vydar · Human · Ninja · Tricky · Earth · L1 M6 R1 A2 D3 H4 · **10pts** · Ghost/Phantom Walk + Disengage + Attack-the-Wild 2 + Tricky Speed 4 | Not in the scans. **10 points for four powers** looks too cheap. Re-upload to verify points + powers. |

### 🟠 C. The 6 Big Heroes — verify against your Big-Hero scans

`cards.md` covers only the Master Set; the Big Heroes were built from separate scans that aren't
in the repo. Their stats/powers I can't check, but a few **faction (general)** values look
questionable to me and are worth a glance:

| Card | `content.ts` faction | My note (verify) |
|---|---|---|
| **Braxas** | Vydar | Acid dragon — I'd have expected **Utgar**. Verify. |
| **Jotun** | Ullar | Giant — possibly **Vydar**. Verify. |
| **Nilfheim** | Jandar | Ice dragon — uncertain; verify. |
| Theracus | Ullar | Gryphillin → Ullar is plausible. |
| Major Q9 | Vydar | Soulborg → Vydar is plausible. |
| Su-Bak-Na | Utgar | Marro hivelord → Utgar is consistent. |

If you re-share the 6 Big-Hero card images (Nilfheim, Su-Bak-Na, Braxas, Theracus, Major Q9,
Jotun) I'll diff every field the same way and lock them into `cards.md` so they're covered going
forward.

---

## 3. Verified-clean reference table (the 21 Master-Set cards)

All fields below were confirmed identical between `content.ts` and the scan reference. `U`=Unique,
`C`=Common.

| Card | Gen | Type | U/C | Species | Class | Pers. | World | Figs | L | M | R | A | D | Pts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tarn Viking Warriors | Jandar | Squad | U | Human | Warriors | Wild | Earth | 4 | 1 | 4 | 1 | 3 | 4 | 50 |
| Finn the Viking Champion | Jandar | Hero | U | Human | Champion | Valiant | Earth | 1 | 4 | 5 | 1 | 3 | 4 | 80 |
| Thorgrim the Viking Champion | Jandar | Hero | U | Human | Champion | Valiant | Earth | 1 | 4 | 5 | 1 | 3 | 4 | 80 |
| Airborne Elite | Jandar | Squad | U | Human | Soldiers | Disciplined | Earth | 4 | 1 | 4 | 8 | 3 | 2 | 110 |
| Sgt. Drake Alexander | Jandar | Hero | U | Human | Soldier | Valiant | Earth | 1 | 5 | 5 | 1 | 6 | 3 | 110 |
| Raelin the Kyrie Warrior | Jandar | Hero | U | Kyrie | Warrior | Merciful¹ | Valhalla | 1 | 5 | 6 | 1 | 3 | 3 | 125 |
| Zettian Guards | Utgar | Squad | U | Soulborg | Guards | Precise | Alpha Prime | 2 | 1 | 4 | 7 | 2 | 7 | 70 |
| Ne-Gok-Sa | Utgar | Hero | U | Marro | Warlord | Tricky | Marr | 1 | 5 | 5 | 1 | 3 | 6 | 90 |
| Marro Warriors | Utgar | Squad | U | Marro | Warriors | Wild | Marr | 4 | 1 | 6 | 6 | 2 | 3 | 105 |
| Deathwalker 9000 | Utgar | Hero | U | Soulborg | Deathwalker | Precise | Alpha Prime | 1 | 1 | 5 | 7 | 4 | 7 | 140 |
| Mimring | Utgar | Hero | U | Dragon | Beast | Ferocious | Icaria | 1 | 5 | 6 | 1 | 4 | 3 | 150 |
| Grimnak | Utgar | Hero | U | Orc | Champion | Ferocious | Grut | 1 | 5 | 5 | 1 | 2 | 4 | 160 |
| Deathreavers | Utgar | Squad | U | Soulborg | Deathreaver | Tricky | Alpha Prime | 4 | 1 | 6 | 1 | 1 | 4 | 60 |
| Blade Gruts | Utgar | Squad | C² | Orc | Warriors | Wild | Grut | 4 | 1 | 6 | 1 | 2 | 2 | 40 |
| Heavy Gruts | Utgar | Squad | C² | Orc | Warriors | Wild | Grut | 4 | 1 | 5 | 1 | 3 | 3 | 70 |
| Arrow Gruts | Utgar | Squad | C² | Orc | Archer | Wild | Grut | 3 | 1 | 6 | 6 | 1 | 1 | 40 |
| Swog Rider | Utgar | Hero | C | Orc | Beast | Wild | Grut | 1 | 1 | 8 | 1 | 3 | 3 | 25 |
| Syvarris | Ullar | Hero | U | Elf | Archer | Precise | Feylund | 1 | 4 | 5 | 9 | 3 | 2 | 100 |
| Agent Carr | Vydar | Hero | U | Human | Agent | Tricky | Earth | 1 | 4 | 5 | 6 | 2 | 4 | 100 |
| Krav Maga Agents | Vydar | Squad | U | Human | Agents | Tricky | Earth | 3 | 1 | 6 | 7 | 3 | 3 | 100 |
| Izumi Samurai | Einar | Squad | U | Human | Samurai | Disciplined | Earth | 3 | 1 | 6 | 1 | 2 | 5 | 60 |

¹ Fixed this pass (was `Resolute`). ² Per your verbal instruction (#178); the scan reference says
Unique — see flag **A**.

> The full 29-card grid incl. Big Heroes, base sizes, and d20-ability flags lives in the
> auto-generated [`traits-matrix.md`](traits-matrix.md) (`GEN_MATRIX=1 npx vitest run traits-matrix`).

---

## 4. Structural checks (all passed)

- Every `HS_DRAFT_POOL` id (29) exists in `HS_CARDS` (29) — no dangling pool entries.
- Every `CARD_IDENTITY` key (29) has a matching `HS_CARDS` entry — no orphan identities.
- Faction grouping in `content.ts` comments matches `CARD_IDENTITY.general` for all 21 verified
  cards (Jandar ×6, Utgar ×11, Ullar ×1, Vydar ×3, Einar ×1).
- Squad figure counts match the rulebook/scan counts (Tarn 4, Zettian 2, Marro 4, Krav Maga 3,
  Izumi 3, Airborne 4, Blade 4, Heavy 4, Arrow 3, Deathreavers 4).
