# Node-only API Selection Test Plan

- Summary: The API selection regression check runs in the declared Node-only environment.

## Task

- Spec: docs/specs/node-only-api-selection-test.md
- Origin: imm-code-review finding after completed configurable-provider-api Plan
- Output language: English prose with literal code identifiers and commands preserved

## Research

- `package.json` declares Node `>=20` but invokes `bun` from `npm test`.
- `test/api-selection.test.ts` uses `Bun.spawnSync` and imports TypeScript directly through Bun.
- `.github/workflows/check.yml` installs only Node 20 and currently skips `npm test`.
- Removing Bun from `PATH` reproduces `npm test` exit 127.
- Existing TypeScript tooling and Node standard-library process APIs are sufficient; no new dependency is required.

## Decisions

- Keep Node `>=20` as the supported development baseline.
- Replace Bun-specific execution without weakening the behavioral registration assertions.
- Add `npm test` to the existing CI job.
- Do not change provider runtime code or API semantics in this repair slice.

## Assumptions

- `npm ci` installs the existing TypeScript dev dependency before tests run.
- CI uses the committed `package-lock.json` and Node 20 as currently configured.

## Output Language

The Spec and Plan use English human-readable prose. File paths, shell commands, JSON keys, API names, and code identifiers remain literal.

## Devil's Advocate Audit

### Rollback resilience

The repair touches only test execution and CI wiring. If interrupted, the shipped extension remains unchanged. Rollback restores the prior test script, test file, and CI step as one coherent set.

### Verification vanity

A normal successful `npm test` is insufficient because the developer machine may provide Bun globally. Verification therefore includes a Node/npm-only `PATH` run. The test must continue observing the actual value passed to `pi.registerProvider()` so a restored hard-coded API fails.

### Spec dilution detection

The review finding requires both portability and CI enforcement. The Step covers Node-only execution, both behavioral scenarios, and CI execution; none is reduced to documentation-only proof.

## Steps

### Step 1

- Step ID: U1
- Result: API selection regression coverage is enforced in Node-only development
- Verification: `npm test && npm run check && npm run pack:dry-run` plus `npm test` with Bun unavailable on `PATH`
- Test scenarios: omitted api registers openai-completions; explicit openai-responses is forwarded; Node-only PATH passes; CI invokes npm test
- Discovery cache: package.json (test command and Node contract); test/api-selection.test.ts (behavioral regression check); .github/workflows/check.yml (Node-only CI enforcement); README.md (documented development command)
- Depends on: none

Implementation boundary:

- Replace Bun-specific test runner and process APIs using existing Node and TypeScript tooling only.
- Preserve subprocess isolation or an equivalent mechanism that reloads `os.homedir()` under each temporary HOME.
- Add `npm test` to the existing CI check job.
- Adjust README development instructions only if the final command differs.

Failure behavior:

- Any missing runtime executable, failed API assertion, TypeScript error, or packaging error blocks closure.

Security considerations:

- Continue using temporary fake `models.json` and `auth.json`; never read or print real credentials.

## Verification Approach

The primary evidence is the behavioral test running under a PATH without Bun. The normal test command proves developer usability, TypeScript checking catches contract drift, and package dry-run guards release contents.
