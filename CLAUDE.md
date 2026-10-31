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

## Shell command scope

- Run shell commands with the repository as the working directory. Use repository-relative paths and keep command inputs, outputs, and file changes inside this repository.
- Do not use absolute paths, `..` path traversal, or commands that read or write outside the repository. Do not change to another directory as part of a command.
- Keep commands transparent to Claude Code's permission checker: avoid heredocs, `python -`/`node -` stdin scripts, `eval`, and opaque encoded or dynamically generated shell code. For project file edits, use Claude Code's file editing tools or a project-local script with a clear path; then run the relevant project command separately.
- Prefer the documented npm scripts for checks. If Claude Code blocks a command because it cannot inspect its effects, restructure it as a direct, repository-scoped command rather than trying to bypass the permission check.

The main session uses the `run-tests` skill for tests. A forked review agent runs its relevant scoped test commands directly with Bash, as described in the `review` skill. The release skill runs the full test suite.

## Project map

- `extension/`: shipped extension. Source architecture and security requirements are in `.claude/rules/extension-architecture.md` and `.claude/rules/extension-security.md`.
- `tests/unit/`: static checks for the manifest, source safety, translations, and store publishing, plus the
  logic that needs no page: the alarm rules, the settings sanitizer (`flags.js` in a `vm` sandbox) and the
  helpers of `common.js` (JSDOM globals before the require; see `tests/unit/common-dom.test.js`).
- `tests/integration/`, `tests/e2e/`, `tests/fixtures/`: DOM and browser behavior against local mocks. See `.claude/rules/test-fixtures.md`.
- `scripts/`: build, store publishing, store images, and structured test reporting.
- `.github/workflows/`: CI, release, and manual Chrome Web Store authentication check.

The manifest version lives only in `extension/manifest.json`; `package.json` has no version. CI runs `npm test` on pushes to `main` and pull requests.

## Workflow skills

Task-specific procedures live in `.claude/skills/`: `run-tests`, `review`, `update-docs`, `release`, and `bug-fix`. Use a skill when its task applies; do not load or apply its procedure to unrelated work. The `bug-fix` skill is for confirmed bugs that need a fix.
