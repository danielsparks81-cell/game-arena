# Verify and deploy

The exact, repeatable cycle used for every change this project ships. Following
it in order catches the failures that the Windows toolchain and the
random-setup engines like to produce.

## Environment quirks (Windows)

- **Always run `tsc`/`vitest`/`npm` from the repo root.** From any other
  directory the WindowsApps `python`/`tsc` shim intercepts and errors with "This
  is not the tsc command you are looking for." Prefix commands with
  `cd /c/Users/Dan/Desktop/game-arena &&` (the working directory does not always
  persist between tool calls).
- **LF→CRLF git warnings are benign.** `git add` prints "LF will be replaced by
  CRLF" — ignore it; it's just the line-ending normalization.
- **Bash tool is available** alongside PowerShell; the commands below assume
  bash. PowerShell 5.1 has its own gotchas (no `&&` chaining) — prefer bash for
  these.

## The loop

```bash
cd /c/Users/Dan/Desktop/game-arena

# 1. Typecheck — the first gate. The sandbox's exhaustive effect switch means a
#    forgotten Effect/PendingChoice case fails here (that's intended).
npx tsc --noEmit -p tsconfig.json

# 2. Tests. Engines with random setup (Legendary's freshSinglePlayerGame picks a
#    random scheme/mastermind) can be flaky — run 2-3x when a change could
#    interact with randomness, and pin determinism in tests that need it.
npx vitest run
for i in 1 2 3; do npx vitest run 2>&1 | grep -E "Tests |failed"; done   # flakiness check

# 3. Production build — catches Next/SSR issues tests don't.
npm run build

# 4. Commit. Branch first if on the default branch. Co-author line at the end.
git add -A
git commit -m "$(cat <<'EOF'
<concise subject>

<body explaining the why>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# 5. Deploy to production.
vercel --prod
```

## Reading a good result

- **tsc**: no output = pass.
- **vitest**: `Tests  N passed (N)`. A flaky failure that only appears some runs
  usually means a test assumed a specific random scheme/mastermind/starting
  player — fix the test (pin `currentPlayerIdx`/ids), not the engine.
- **build**: ends with the route table and `○ (Static) / ƒ (Dynamic)` legend.
- **deploy**: look for `▲ Aliased https://game-arena-ten-gamma.vercel.app` and
  `"readyState": "READY"`. `vercel --prod` sometimes prints the deployment URL
  but not the alias on the first call — re-run or grep for `aliased|ready` to
  confirm the alias flipped to the new deployment.

## When to add a test vs just verify

Always add a regression test to the engine's `*.test.ts` for any **rule** or
**bug fix** — the suite is the institutional memory that stops a fix from
silently regressing when shared code changes later. Pure UI/styling tweaks
(padding, a hover preview, a highlight ring) don't need a test, but still run
tsc + build before deploying.

## Migrations

DB schema changes are hand-written SQL under `supabase/migrations/NNN_*.sql`,
applied **manually** by the user in the Supabase SQL editor — there is no
automated migrate command. After adding one:

1. Make dependent code degrade gracefully if the column/table is missing (retry
   without the new field, or show a "run the migration" hint) so nothing crashes
   in the window before it's applied.
2. Explicitly tell the user which migration file to run.

## Spawning follow-up work

If you spot an out-of-scope issue while working (dead code, a stale doc, a
security smell, a missing test), note it for the user rather than expanding the
current change — keep diffs focused so they're easy to review and revert.
