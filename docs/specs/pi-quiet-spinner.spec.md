# Spec: Quiet Spinner Package

**Task ID**: `pi-quiet-spinner`
**Owner**: user
**Status**: Candidate
**Design risk**: Medium
**Design risk rationale**: Adds one new published workspace package whose runtime effect is a process-wide patch of one method pair on a dependency prototype, plus one env-driven options contract. No persisted state, migration, security boundary, or existing module contract changes.
**Diagram decision**: not_required
**Diagram reason**: The design is one pure resolver plus one prototype patch with a small preset table and explicit invariants; there is no layered structure, state machine, data flow, or ordered multi-component interaction to clarify.

## Outcome

`quiet-spinner.ts` becomes a standalone published package, `packages/pi-quiet-spinner` (npm `pi-quiet-spinner`), so the CPU workaround for pi's full-transcript redraw is installed, versioned, documented, and released through the repository's normal Changesets flow instead of living as an untracked user-level file.

The package keeps today's behavior as its default and exposes one preset knob that binds animation style to refresh rate, so a slower frame interval still reads as motion. It continues to discover the same assumptions loudly: if the upstream runtime no longer exposes the method it patches, it fails at activation rather than silently doing nothing.

## Brainstorm Trace

| ID | Framing item | Coverage |
| --- | --- | --- |
| BR-REQ-1 | New package follows the documented workspace package layout | A3; Scope lists the exact new paths and the `check` / `test` / `pack:dry-run` scripts |
| BR-REQ-2 | Keep global patch semantics; never speed up an already slower loader | A2; Technical Design decision 3 (floor via `max`) |
| BR-REQ-3 | Three env variables, default preset `quiet` | A1; Technical Design decisions 1 and 2 |
| BR-REQ-4 | Style substitution must not change loader color semantics | A2; Technical Design decision 4 |
| BR-REQ-5 | Retain the exit plan for the upstream workaround | A3; Technical Design decision 9; README requirement |
| BR-REQ-6 | Repo compliance: Node 20 checks, changeset, root README row | A3; Scope names the root README and changeset paths |
| BR-DEC-1 | Style and refresh rate are one preset, not two orthogonal knobs | Technical Design decision 1 |
| BR-DEC-2 | Default `quiet`, preserving current behavior | A1; preset table |
| BR-DEC-3 | Configuration surface is environment variables only | Technical Design decision 2 |
| BR-DEC-4 | Fail loud when the patched method is gone | A2; Technical Design decision 5 |
| BR-DEC-5 | Package name `pi-quiet-spinner` | A3 (manifest contract) |
| BR-DEC-6 | Tests are runner-agnostic and never import the real TUI runtime | A1/A2/A3; Technical Design decision 7 |
| BR-DEC-7 | Style layer is presets plus a raw frames escape hatch (resolves BR-Q-1) | A1 (frames override case) |
| BR-DEC-8 | Retire the user-level source file only after the package is installed and verified (resolves BR-Q-2) | Technical Design decision 8; Scope non-goal |
| BR-OUT-1 | No per-loader or third-party extension API | Scope non-goals |
| BR-OUT-2 | No config-file or `settings.json` integration | Scope non-goals; Technical Design decision 2 |
| BR-OUT-3 | No built-in multi-glyph-set engine | Scope non-goals; BR-DEC-7 covers the escape hatch |
| BR-OUT-4 | No upstream `pi-tui` change | Scope non-goals |

No unresolved user decision remains; BR-Q-1 and BR-Q-2 are resolved by BR-DEC-7 and BR-DEC-8.

## Discovery Evidence

- `packages/README.md` defines the package layout, the required script names, the Changesets release flow, and the `files` / `pi.extensions` / peer-dependency conventions this package must follow.
- `packages/pi-minimal-statusbar/package.json` and `packages/pi-sub2api-provider/package.json` are the reference manifests for name, `engines`, `publishConfig`, `pi.extensions`, `files`, and dev dependencies.
- `packages/pi-minimal-statusbar/test/index.test.mjs` is the test prior art: it reads `src/index.ts`, strips the runtime package imports, transpiles in-memory with the `typescript` dev dependency into a package-local `.test-dist`, imports the result, and removes the directory afterwards. This exists because importing the real runtime packages on CI's Node 20 fails, so the tested logic is kept in pure functions.
- `node_modules/@earendil-works/pi-tui/dist/components/loader.js` and `loader.d.ts` define the patched surface: `frames`, `intervalMs` (default 80 ms, ten braille frames), `setIndicator(indicator)`, `restartAnimation()`, and `renderIndicatorVerbatim`. Two upstream behaviors shape the design: `restartAnimation()` stops the timer and returns early when `frames.length <= 1`, and `setIndicator` sets `renderIndicatorVerbatim = indicator !== undefined`, which selects a path that bypasses the theme color function.
- `node_modules/@earendil-works/pi-tui/dist/components/cancellable-loader.d.ts` shows the interactive loader is a `Loader` subclass, so a prototype-level patch covers it without a second integration point.
- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` (extension error handling) confirms a failed extension load is logged while the agent continues, so failing loudly at activation disables only this package.
- `node_modules/@earendil-works/pi-coding-agent/docs/settings.md` records no per-extension settings namespace, which is why BR-DEC-3 chose environment variables. The user-level convention matches: `~/.pi/agent/extensions/rtk.ts` reads `RTK_DISABLED` and `herdr-agent-state.ts` reads `HERDR_*`.
- `.github/workflows/check.yml` runs `npm test`, `npm run check`, and `npm run pack:dry-run` on Node 20, so the package's own test script must run under Node.
- Verification probe (run in this workspace): `bun run <file>` rejects a `node:test` script with "Cannot use test outside of the test runner", while a plain `node:assert` script exits 0 under both `node` and `bun run`. Acceptance test files are therefore plain assertion scripts.
- Verification probe: `import * as ts from "typescript"` plus `ts.transpileModule` succeeds under both `node` and `bun run` when executed inside the workspace, so the transpile-based seam is portable across the Node CI runner and the managed QA runner.

### Prior Decisions

- `.imm/memory/current_iteration.json` and `HANDOFF.md` are leftovers from an earlier completed task and hold no live authority for this work.
- The user-level source file `~/.pi/agent/extensions/quiet-spinner.ts` is the migration source. Its header records the measured problem (58% to 8% of one core on a 54k-line session) and the exit plan against the upstream redraw issue, both of which this Spec preserves.

## Technical Design

**Design views**: The component/interface view is selected: the extension-to-`Loader` patch boundary and the environment-to-options resolution boundary are the whole design and carry the failure behavior. Architecture layers are omitted (one package, no internal layering), data flow is omitted (nothing is persisted or transformed), state transitions are omitted (timer arm/disarm stays owned by `pi-tui`), and temporal sequence is omitted (no ordered multi-component interaction).

### Decisions

1. Style and refresh rate are bound into one preset rather than exposed as two independent knobs, because redraw cost scales with frames per second while the visual quality of a slow spinner depends on the cycle length. Presets: `still` (one frame, no timer), `quiet` (four frames, 1000 ms, default), `calm` (eight frames, 400 ms), `default` (no patch; upstream 80 ms and ten frames). The frames for the animated presets are prefixes of the upstream braille cycle, so no new glyph vocabulary is introduced.
2. Configuration is read from the process environment at activation: `PI_QUIET_SPINNER` selects a preset, `PI_QUIET_SPINNER_INTERVAL_MS` and `PI_QUIET_SPINNER_FRAMES` override the preset's interval and frame list. A preset supplies defaults and an explicit override always wins, including with `default`. Empty or whitespace-only values count as unset. No file, `settings.json`, or CLI flag surface is added.
3. The interval is always applied as a floor: `max(loaderIntervalMs, configuredIntervalMs)`. A loader that is already slower than the configured value keeps its own interval.
4. Style substitution mutates the loader's frame list after the original `setIndicator` has run; the package never calls `setIndicator` itself and never writes `renderIndicatorVerbatim`. Loaders that passed no explicit indicator therefore keep the theme-colored rendering path, and the frame override is applied without changing that selection.
5. A missing or non-function patched method fails at activation with an error naming the missing method and the package, so the workaround cannot silently become a no-op. This is safe because a failed extension load is logged and the host continues.
6. The patch is installed on activation rather than at module import, and installation is idempotent, so a double install (for example while the user-level source file still exists) neither stacks wrappers nor changes behavior.
7. The test seam is one focused plain-assertion script per acceptance, each transpiling a copy of the package source with the runtime import stubbed, under a package-local `.test-dist` that the script removes afterwards. This keeps the package's own test runnable under the Node CI runner and the managed QA runner, and keeps runtime package imports out of the test process.
8. Retirement ordering: the package is the single implementation, and the user-level source file is deleted only after the package is installed and observed working. Both files patch the same method with the same floor, so the overlap window is behaviorally idempotent. The deletion is a user-owned environment step, not an editable repository path.
9. The exit plan is retained in the package documentation and source: the workaround is obsolete once upstream stops re-rendering the whole transcript per frame, with the re-check procedure recorded next to it.

### Boundaries And Compatibility

- Public interface: the npm package name and version, the `pi.extensions` entry, the four preset names, the three environment variable names, and the documented failure behavior. Nothing else is a promised surface.
- Mutation envelope: the package is additive. The only existing files touched are the root README package table and a new changeset.
- Shared-runtime effect: the patch is process-wide, so every `Loader` and `Loader` subclass in the same pi process is affected, including loaders owned by other extensions and dialogs. This is the intended behavior and is documented, along with how to disable it (`default`, or unsetting the variables).
- Failure behavior: an unknown preset, a non-positive or non-integer interval, or an empty frame list fails at activation with the offending value and the accepted values in the message. Nothing is silently ignored or partially applied.
- Compatibility: no migration is needed; the package is new and reading environment variables is additive. Removing the package or the variables restores upstream behavior.
- Interruption recovery: the change is file-additive, so an interrupted implementation leaves an untracked package directory that is either completed or deleted; no repository state is half-migrated.
- Rollback path: delete `packages/pi-quiet-spinner` and the changeset entry, and revert the root README table row. No state or migration to unwind.

## Acceptance And Verification

| ID | Required evidence | Focused descriptor |
| --- | --- | --- |
| A1 | Preset and override resolution: `quiet` is the default, each preset yields its documented frame count and interval, `default` yields no patch, explicit interval and frames overrides win over the preset, an empty frame list is rejected, and unknown preset / invalid interval values fail with the offending value. | `bun run packages/pi-quiet-spinner/test/options.test.mjs` |
| A2 | Patch semantics: an already slower loader keeps its interval, a default loader is floored, the frame override is applied to a loader that passed no explicit indicator while its verbatim-rendering flag stays unchanged, a second install does not stack or change behavior, and a prototype missing the patched method fails at activation. | `bun run packages/pi-quiet-spinner/test/patch.test.mjs` |
| A3 | Package contract: the manifest declares the package name `pi-quiet-spinner`, the `pi.extensions` entry, the `check` / `test` / `pack:dry-run` scripts, the published `files` list, `publishConfig`, and the Node engine floor; the README documents every preset, every environment variable, the shared-runtime effect, and the exit plan; a changeset and the root README entry exist. | `bun run packages/pi-quiet-spinner/test/package.test.mjs` |

Each acceptance is exercised by asserting on exports of the transpiled source copy or on the package's own manifest and documentation; no acceptance depends on a network call, package installation, or the full workspace suite. Deterministic QA runs these descriptors after implementation; the full `npm test`, `npm run check`, and `npm run pack:dry-run` runs remain the repository-level regression the implementation must also pass.

## Scope

Editable paths: the new `packages/pi-quiet-spinner` tree (`package.json`, `tsconfig.json`, `src/index.ts`, `test/_load-src.mjs`, `test/options.test.mjs`, `test/patch.test.mjs`, `test/package.test.mjs`, `README.md`, `CHANGELOG.md`, `LICENSE`), the root `README.md` package table, and one new `.changeset` entry. This Spec's active path is recorded for artifact freezing.

### Non-goals

- No API for other extensions or for individual loaders; the patch stays process-wide (BR-OUT-1).
- No configuration file and no `settings.json` integration (BR-OUT-2).
- No built-in library of alternative glyph sets beyond the single raw frames override (BR-OUT-3).
- No change to `@earendil-works/pi-tui`; the workaround stays a patch on our side until upstream retires it (BR-OUT-4).
- Deleting the user-level source file is not an editable repository path and is not part of the implementation diff (BR-DEC-8).

## Devil's Advocate Audit

- **Rollback resilience**: The change adds files and one README row; there is no persisted state, migration, or schema to unwind. A partial implementation is an incomplete package directory, and the safest recovery is deleting it or finishing the focused tests. Nothing in the change alters `pi-tui` or the host on disk, so reverting the commit restores the previous behavior exactly.
- **Verification vanity**: The acceptance tests assert the resolved option values and the observable interaction with a stubbed prototype, including the negative cases (no acceleration of a slower loader, invalid input failing, missing method failing) and the non-regression case that the verbatim-rendering flag is untouched. A test that only asserted "the floor is 1000" would pass while breaking a user who set a custom interval or an explicit indicator, so those cases are required. The tests deliberately do not import the real runtime package, so they prove our contract, not upstream rendering; the honest claim is limited to what the stub can see.
- **Spec dilution detection**: The confirmed requirements stay intact: the default remains the current behavior, the floor never accelerates, the failure is loud, the exit plan survives, and no preset is silently dropped. A minimal-but-wrong implementation that hardcodes one preset, silently falls back on an unknown value, or replaces the frame list for loaders that passed an explicit indicator would violate decisions 3, 4, and 5 and must fail A1 or A2.
