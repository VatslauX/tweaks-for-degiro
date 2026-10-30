# CLAUDE.md

Project guidance for Claude Code working in this repository.

## Project

Unofficial Manifest V3 Chrome extension for the DEGIRO web trader (`https://trader.degiro.nl/trader/`). The extension is plain JavaScript with no runtime dependencies or bundler; only `extension/` ships. Keep the shipped source directly runnable. Do not add a build step, TypeScript source, or framework unless a Firefox build, runtime package, UI framework, or substantially larger codebase makes that necessary.

## Common commands

```sh
npm test                   # typecheck, lint, unit, integration, e2e (CI and humans)
npm run test:report        # structured JSON test results for agents; accepts a scope
npm run typecheck
npm run lint
npm run build              # dist/tweaks-for-degiro-<manifest version>.zip
npm run store-images       # store images in dist/store/; requires source screenshots
```

The main session uses the `run-tests` skill for tests. A forked review agent runs its relevant scoped test commands directly with Bash, as described in the `review` skill. The release skill runs the full test suite.

## Project map

- `extension/`: shipped extension. Source architecture and security requirements are in `.claude/rules/extension-architecture.md` and `.claude/rules/extension-security.md`.
- `tests/unit/`: static checks for the manifest, source safety, translations, and store publishing.
- `tests/integration/`, `tests/e2e/`, `tests/fixtures/`: DOM and browser behavior against local mocks. See `.claude/rules/test-fixtures.md`.
- `scripts/`: build, store publishing, store images, and structured test reporting.
- `.github/workflows/`: CI, release, and manual Chrome Web Store authentication check.

The manifest version lives only in `extension/manifest.json`; `package.json` has no version. CI runs `npm test` on pushes to `main` and pull requests.

## Workflow skills

Task-specific procedures live in `.claude/skills/`: `run-tests`, `review`, `update-docs`, `release`, and `bug-fix`. Use a skill when its task applies; do not load or apply its procedure to unrelated work. The `bug-fix` skill is for confirmed bugs that need a fix.
