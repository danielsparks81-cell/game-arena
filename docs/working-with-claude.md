# Working with Claude on Game Arena (a plain-English guide)

You're building this site with Claude. You don't need to know the code — but knowing **how to
drive Claude** makes a huge difference. This is your cheat sheet.

## The two things that remember stuff for you

1. **Memory** (`~/.claude/projects/.../memory/`) — Claude writes durable notes here that load
   into **every future session**. This is why a new chat still "knows" the project. If you
   learn or decide something important, say: **"save this to memory."**
2. **Skills** (`.claude/skills/` + built-ins) — reusable playbooks Claude follows for specific
   work. They trigger automatically, but you can force one: **"use the heroscape-engine skill."**
   Current game skills: `heroscape-engine`, `heroquest-engine`, `heroquest-vision`,
   `legendary-engine`, `heroscape-figures` (mini cut-outs), `game-arena-platform`,
   `building-a-new-game`, `rules-fidelity`.

## The build → ship loop (what happens when you ask for a change)

1. **Edit** the code.
2. **Typecheck**: `npx tsc --noEmit` (catches type errors).
3. **Test**: `npx vitest run <area>` (e.g. `src/lib/games/heroscape`) — proves rules still work.
4. **Commit + push** to `main`.
5. **Push = auto-deploy.** Vercel rebuilds and updates the live site (~1–2 min). There is no
   separate "deploy" step — pushing IS deploying.
6. **Verify it's live** before trusting it (see below).

You can just say **"make the change, test it, and deploy."**

## Useful things to say to Claude

- **"Use plan mode"** (or it'll offer) for anything big/multi-file — you approve a written plan
  before any code is touched. Great for new games, new powers, movement features.
- **"Run the tests"** / **"verify it in the app"** — don't assume; confirm.
- **"Save this to memory"** — locks in a decision or lesson for future sessions.
- **"Hard-refresh"** (Ctrl+Shift+R) — if a change looks deployed but you don't see it, your
  browser is showing cached old code. Plain F5 often isn't enough.

## Verifying a deploy actually went live

- **Code change:** the latest **Production** deployment SHA should equal the newest commit and
  read `success` (Claude checks this with `gh`). Then hard-refresh.
- **Image/asset change** (e.g. a figure PNG): assets are cache-busted with `?v=…`; Claude
  fetches the live file and compares it byte-for-byte to the local one.
  (Details live in the `feedback-deployment` memory.)

## Guardrails already in place (so you don't have to worry)

- **The GitHub repo is PUBLIC** → never commit secrets. Only the *public* Supabase keys are in
  it. Claude follows this.
- **Push to `main` = live**, so changes go straight to players — Claude commits/pushes when you
  ask, and tests first.
- **Server rolls all dice** (fairness) — players can't fake rolls.

## Where to read more

- `docs/heroscape/` and `docs/heroquest/` — the actual game rulebooks, turned into references.
- `docs/heroscape/ARCHITECTURE.md` — how the HeroScape engine is built.
- The skills above each contain a deeper map of their area.

You're doing fine. The setup is designed so a beginner + Claude can ship real features safely.
