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

## 1. Fixed (high confidence — unambiguous data error vs the official card)

| Card | Field | Was | Now | Source |
|---|---|---|---|---|
| **Raelin the Kyrie Warrior** | personality | `Resolute` | **`Merciful`** | `cards.md:177` (RotV index-card scan) — "Warrior · Kyrie · **Merciful** · Valhalla" |
| **Deathwalker 9000** | defense | `7` | **`9`** | `Index_3x5_Deathwalker_9000.pdf` — rendered + visually confirmed DEF 9. Was wrong in BOTH `content.ts` and `cards.md`. Combat-relevant; engine stat-check test updated to 9. |

`CARD_IDENTITY.raelin.personality` is display-only (low-risk). The Deathwalker Defense fix IS
combat-relevant (a more durable Soulborg) — `content.ts`, `cards.md`, the engine `toMatchObject`
test, and the regenerated traits matrix all updated.

> ✅ **Full re-verification 2026-06-27:** with the official card library (`Desktop\Heroscape Cards`,
> 204 PDFs) + Poppler installed, all **29** cards were re-checked field-by-field against their exact
> canonical PDF (render + `pdftotext -raw`), not just against `cards.md`. **28/29 matched perfectly;**
> the only error was the Deathwalker Defense above. Canonical editions are now locked + documented in
> [`cards.md` → Card editions & sources](cards.md): Drake/Raelin = ROTV, Swog = plain, Major = Q9,
> Deathwalker = 9000.

---

## 2. Flags — please confirm against the physical cards on re-upload

### ✅ A. The three Grut squads: Common — RESOLVED 2026-06-27

The user uploaded the official index-card PDFs (`HSB_3x5_Heavy_Gruts`, `Index_3x5_Blade_Gruts`,
`Index_3x5_Arrow_Gruts`); text extraction shows all three nameplates read **COMMON SQUAD**.
`content.ts` was already correct (`common: true`) — the error was in `cards.md`, which has now
been fixed. No code change. The earlier "conflict" was my own extraction doc being wrong, not
the game.

### ✅ A2. Deathreavers: Common — RESOLVED 2026-06-27

The `Index_3x5_Deathreavers` card reads **COMMON SQUAD**. `content.ts` had it Unique — **fixed**
(`common: true`) + `cards.md` row corrected + the common-pool test now expects 5 Common Utgar
units (Swog Rider + 3 Gruts + Deathreavers). Everything else on the card matches (Soulborg ·
Deathreaver · Tricky · Alpha Prime · Small 3 · L1 M6 R1 A1 D4 · 60 · Scatter/Disengage/Climb X2).

### ✅ B. Eldgrim & Otonashi — RESOLVED 2026-06-27 (both real, both correct)

The user uploaded `Index_3x5_Eldgrim_The__Viking_Champion` and `Index_3x5_Otonashi`. Both are real
cards and **every field matches `content.ts`** (the earlier "placeholder / too cheap" worry was
unfounded). `-raw` text extraction (label→value in stream order) settled the stat ambiguity:

| Card | Verified from the card | Match? |
|---|---|---|
| **Eldgrim** | Unique Hero · Human · Champion · Valiant · Earth · Medium 4 · L3 M5 R1 A2 D2 · 30 · Overextend Attack + Warrior's Swiftness Spirit | ✅ stats match. **Overextend** is already wired (`canOverextend`, keyed by card id). 🟡 minor gap: *Warrior's Swiftness Spirit* (on-destroy, +1 move to a unique card) isn't implemented — backlog. |
| **Otonashi** | Unique Hero · Human · Ninja · Tricky · Earth · Medium 4 · L1 M6 R1 A2 D3 · 10 · Phantom Walk + Attack the Wild 2 + Tricky Speed 4 | ✅ fully matches (ghostWalk + disengage + attackTheWild 2 + trickySpeed 4). |

### ✅ C. Big Heroes — RESOLVED 2026-06-27 (all 6 verified, factions confirmed)

All six were rendered from their canonical PDFs and the faction emblems read directly. **My earlier
suspicions (Braxas→Utgar, Jotun→Vydar, Nilfheim uncertain) were all WRONG** — `CARD_IDENTITY` is
correct:

| Card | Faction (emblem) | Stats vs `content.ts` |
|---|---|---|
| Su-Bak-Na | **Utgar** ✓ | ✅ L5 M6 R1 A7 D3 · 160 · Huge 12 · Hivelord |
| Nilfheim | **Jandar** ✓ | ✅ L6 M6 R1 A6 D4 · 240 · Huge 12 · Dragon/King |
| Braxas | **Vydar** ✓ | ✅ L8 M6 R1 A5 D3 · 210 · Huge 13 · Dragon/Queen |
| Theracus | **Ullar** ✓ | ✅ L3 M7 R1 A3 D3 · 40 · Large 5 · Gryphillin/Scout |
| Major Q9 | **Vydar** ✓ | ✅ L4 M5 R8 A4 D7 · 250 · Large 7 · Soulborg/Major |
| Jotun | **Ullar** ✓ | ✅ L7 M6 R1 A8 D4 · 225 · Huge 10 · Giant/Warrior |

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
