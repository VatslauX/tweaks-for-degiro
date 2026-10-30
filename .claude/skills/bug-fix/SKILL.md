---
name: bug-fix
description: Use when a confirmed bug needs a code fix, such as a reproducible user report, review finding, or failing test. Coordinates a fresh sub-agent to find the root cause and implement a tested fix.
argument-hint: "[symptom and affected page or behavior]"
---

# Bug fix

Use a fresh sub-agent for the implementation. Give it:

- the concrete symptom and page/state where it occurs;
- relevant reproduction steps, review finding, or failing test;
- files or concurrent work it must not touch;
- the requirement that it find the root cause and add or update a test that fails without the fix;
- the real-site boundary, if relevant: read-only, never log in, never close tabs;
- the deliverable: cause, files changed, and scoped test results from `npm run --silent test:report -- <scope>`.

The sub-agent owns the fix and its focused tests. Do not delegate a speculative defect: first confirm the symptom or establish it through code tracing or a failing test. Do not commit or push as part of the bug fix.
