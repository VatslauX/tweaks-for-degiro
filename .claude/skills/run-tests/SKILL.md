---
name: run-tests
description: Use from the main session whenever tests need running in this repo (after a change, to check a fix, before review or commit). Not from sub-agents or forked skills such as `review`: its result would go to the main session, so they run `npm run --silent test:report -- <scope>` with Bash in the background instead. Runs typecheck, lint, unit, integration and e2e tests (or a narrower scope) in its own Haiku sub-agent and returns one structured JSON result. Only runs and reports; never edits or fixes.
argument-hint: "[typecheck|lint|unit|integration|e2e|all] [tests/e2e/x.spec.js[:line]] [tests/unit/x.test.js] [tests/integration/x.test.js] [-g \"<test name>\"]"
context: fork
agent: general-purpose
model: haiku
background: true
allowed-tools: Bash(npm run test:report*), Bash(npm run --silent test:report*)
disallowed-tools: Edit, Write, NotebookEdit, Agent
---

# Run tests

You run the tests of "Tweaks for DEGIRO (unofficial)" and report the result. You do nothing else.

Scope requested: `$ARGUMENTS` (empty means the full suite: typecheck, lint, unit, integration, e2e).

## Rules

- Only run the one command below. Never edit, create or delete files, never fix anything, never commit, never stash or check out.
- Never open or contact the real DEGIRO site. The e2e tests use a local mock; nothing else is needed.
- Don't run `npm test`, `npx playwright` or other commands as a fallback, and don't retry a failed run. A failure is a result: report it.
- Don't kill other processes. Another `npm test` may be running at the same time; that's fine.

## Steps

1. Run, from the repo root, with `run_in_background: true` and `timeout: 600000`:

   ```
   npm run --silent test:report -- <scope>
   ```

   `<scope>` is `$ARGUMENTS` as given; leave it (and the `--`) out when it's empty. Keep quotes around a `-g` name, for example `npm run --silent test:report -- -g "adds a Spread row"`. The full suite takes about 8 minutes, one unit or integration file a second, one e2e spec under a minute.
2. Wait for the background-task notification. Don't poll the output or loop on `sleep`; the notification arrives when the command exits.
3. Read the command's output once. Stdout is one JSON object (stderr only has `[test-report]` progress lines). Exit code 0 means everything run passed, 1 means a failure, 2 means a bad scope argument.
4. Reply with exactly this, and nothing else:

   ````
   RESULT: PASS | FAIL
   ```json
   <the JSON from stdout, verbatim>
   ```
   ````

   Copy the JSON as printed: don't reformat, shorten, summarise or explain it. If there is no JSON at all (the script itself crashed), reply `RESULT: FAIL`, the exact command, the exit code and at most 10 lines of its stderr.

## Output format (from `scripts/test-report.js`)

```json
{
  "ok": false,
  "command": "node scripts/test-report.js -g \"adds a Spread row\"",
  "durationS": 12.4,
  "stages": {
    "typecheck": {"status":"not run","passed":0,"failed":0,"skipped":0,"durationS":0,"command":null},
    "lint": {"status":"not run", ...},
    "unit": {"status":"not run", ...},
    "integration": {"status":"not run", ...},
    "e2e": {"status":"failed","passed":0,"failed":1,"skipped":0,"durationS":11.9,"command":"playwright test -g \"adds a Spread row\"","artifacts":"/tmp/dgt-report-…/results"}
  },
  "failures": [
    {"stage":"e2e","location":"tests/e2e/features.spec.js:42","title":"spread > adds a Spread row","error":["Error: expect(locator).toHaveText(expected) failed","Expected: \"0.05\"","Received: \"0.04\""]}
  ],
  "failuresOmitted": 0
}
```

- `status`: `passed`, `failed` or `not run` (outside the scope). Counts are tests for unit, integration and e2e, tsconfig projects for typecheck, files for lint. e2e may add `flaky` (passed on retry) and `artifacts` (traces of failed tests).
- A scope that runs no tests (for example a `-g` name that matches nothing) is a failure.
