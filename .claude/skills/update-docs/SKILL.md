---
name: update-docs
description: Use before every git commit in this repo (and when the user says "update docs"). Brings README, CHANGELOG, CLAUDE.md, PRIVACY and STORE_LISTING in line with the pending code changes.
model: sonnet
---

# Update docs before commit

Keep the Markdown docs of "Tweaks for DEGIRO (unofficial)" in sync with the code about to be committed.

## Steps

1. See what is changing: `git status --short`, `git diff --cached` and `git diff`. If only `.md` files changed, or nothing changed, skip this skill.
2. Read the changed source files where the diff alone doesn't show the behaviour.
3. Check each doc below against the change and edit only what has become wrong or incomplete. Leave unrelated wording alone.
4. Don't bump versions yourself. Tell the user which docs changed (one line each) and anything that needs their decision, e.g. a manifest version bump.
5. Stage the doc changes together with the code and continue with the commit.

## Docs and when they change

- **README.md**: user-facing. Feature descriptions, the Settings table (flag names and defaults must match `DG_DEFAULTS` in `extension/flags.js`), Installation, Privacy & safety, Notes & limitations. End-user information only: no files, commands, tests or release steps (those go in CLAUDE.md).
- **CHANGELOG.md**: add bullets for user-visible changes under the newest heading `## X.Y.Z — YYYY-MM-DD`.
  - If `extension/manifest.json` has a version newer than the top heading, create that heading with today's date.
  - If the version wasn't bumped and the top entry is already released, add the bullets under `## Unreleased` and flag that the version needs a bump.
  - Follow the existing style: short bullets, a **bold feature name** first, plain language. Leave out internal refactors unless they matter to users.
- **CLAUDE.md**: all developer and agent information. Update it when the layout, the `extension/` file table (one row per `extension/*.js`), releasing, commands, architecture (execution worlds, the flags bridge `DG_PAGE_FLAGS`, the orders endpoint), test fixtures or the security invariants in `tests/unit/` change. Keep it concise and don't copy README content into it.
- **PRIVACY.md**: update it, and its "Last updated" date, only if permissions, accessed data, network requests or storage change.
- **STORE_LISTING.md**: keep the summary (≤132 chars, same as the manifest `description`), the description bullets and the permission justifications in line with the features and `manifest.json`.

## Style

Plain, concise English matching the surrounding text. Use € / nl-NL number examples like the existing docs. Never imply DEGIRO affiliation; the name is always "Tweaks for DEGIRO (unofficial)".
