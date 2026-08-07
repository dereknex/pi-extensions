# Node-only API Selection Test

## Task

Repair the provider API regression check so it runs in the repository's declared Node-only development and CI environment.

## Output Language

Human-readable Spec and Plan prose is English. File paths, commands, JSON keys, API names, and code identifiers remain literal.

## Summary

The API adapter behavior is correct, but its new `npm test` command requires an undeclared Bun executable. The repository declares Node `>=20`, documents `npm ci` followed by `npm test`, and configures CI with Node only. This slice makes the behavioral check runnable without Bun and ensures CI executes it.

## Origin

`imm-code-review` found that `package.json` and `test/api-selection.test.ts` require Bun while the supported and automated environment installs only Node. Running `npm test` with Bun removed from `PATH` reproduces exit 127: `bun: command not found`.

## Scope

### In scope

- Replace the Bun-dependent test runner and process API with a Node-compatible test path.
- Preserve behavioral coverage for omitted `api` and explicit `openai-responses` registration.
- Run `npm test` in `.github/workflows/check.yml`.
- Keep development instructions accurate.

### Out of scope

- Changing provider registration behavior.
- Adding Bun as a project prerequisite.
- Adding a new test framework or runtime dependency.
- Expanding test coverage beyond API adapter selection.
- Revising the already-recorded release semantics.

## Design-depth Classification

**Low risk.** This is contained test and CI wiring. It does not change the shipped provider runtime contract.

## Decisions

1. Node `>=20` remains the only declared runtime prerequisite.
2. Reuse installed TypeScript tooling or Node standard-library process APIs; add no dependency.
3. The test must still execute the extension entry point and observe `pi.registerProvider()` rather than inspect source text.
4. CI must run `npm test` after `npm ci`.
5. The Node-only portability check must be reproducible without relying on the developer's global Bun installation.

## Invariants

- The test asserts omitted `api` resolves to `openai-completions`.
- The test asserts explicit `openai-responses` is forwarded.
- Tests use temporary fake configuration and never access real user auth.
- `npm run check` and package dry-run continue to pass.

## Failure Behavior and Rollback

A missing Node-compatible execution path or a behavioral regression makes `npm test` exit non-zero and blocks CI. Rollback is limited to `package.json`, `test/api-selection.test.ts`, `.github/workflows/check.yml`, and any directly necessary README command adjustment.

## Acceptance Criteria

1. `npm test` passes when Bun is unavailable on `PATH`.
2. Both API selection scenarios still execute against the extension entry point.
3. CI runs `npm test` in its Node-only job.
4. `npm run check` passes.
5. `npm run pack:dry-run` passes.
6. No dependency is added.

## Test Scenarios

- Run `npm test` in the normal development shell.
- Run `npm test` with a PATH containing Node/npm but no Bun.
- Confirm an intentionally restored hard-coded API would make the explicit Responses assertion fail.
