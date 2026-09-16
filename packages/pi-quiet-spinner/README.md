# pi-quiet-spinner

Floors the frame interval of every pi-tui spinner, so a long session stops burning a core on decorative redraws.

## Why

Pi redraws the whole TUI roughly 12 times per second while any spinner is on screen — the working-status indicator, the inline spinner of a running bash call, dialog loaders. Each redraw scans the entire transcript line array, not just the viewport, at roughly 0.8–1.2 µs per rendered line. A 90k-line session therefore spends most of a core merely waiting for a tool to finish; on a measured 54k-line session the difference was 58% → 8% of one core.

None of those loaders is configurable, so this package caps their frame interval globally. Rendering still happens on every real event; only the decorative tick slows down.

## Install

```bash
pi install npm:pi-quiet-spinner
```

## Presets

Style and refresh rate are one knob: a slower spinner needs a shorter animation cycle to still read as motion, so each preset pairs a frame list with an interval.

| `PI_QUIET_SPINNER` | Frames | Interval | Redraws | Use when |
| --- | --- | --- | --- | --- |
| `still` | 1 | — | 0/s | You want the maximum saving; the indicator stops moving and only the message text updates. |
| `quiet` | 4 | 1000 ms | 1/s | Default. Keeps a visible tick at a fraction of the redraws. |
| `calm` | 8 | 400 ms | 2.5/s | A middle ground for smaller sessions. |
| `default` | upstream | 80 ms | 12.5/s | Escape hatch: installs no patch at all. |

The frames used by `still`, `quiet` and `calm` are prefixes of the braille cycle pi already uses, so no new glyph vocabulary appears.

## Configuration

| Variable | Meaning |
| --- | --- |
| `PI_QUIET_SPINNER` | Preset name: `still`, `quiet`, `calm`, or `default`. Defaults to `quiet`. |
| `PI_QUIET_SPINNER_INTERVAL_MS` | Frame interval floor in milliseconds, an integer from 1 to 2147483647. Defaults to the preset's interval. |
| `PI_QUIET_SPINNER_FRAMES` | Frame list, split into code points. Defaults to the preset's frames. |

A preset supplies defaults and an explicit override always wins, including under `default`:

```bash
# Slower than the default preset, and no glyph motion at all.
PI_QUIET_SPINNER_FRAMES="⠋" PI_QUIET_SPINNER_INTERVAL_MS=2000 pi

# Keep pi's own frames but only 4 redraws per second.
PI_QUIET_SPINNER=default PI_QUIET_SPINNER_INTERVAL_MS=250 pi
```

An empty or whitespace-only value counts as unset for `PI_QUIET_SPINNER` and `PI_QUIET_SPINNER_INTERVAL_MS`. `PI_QUIET_SPINNER_FRAMES` is a content claim, so a value that yields no frames at all — `""` or `"   "` — is rejected instead of silently ignored, because it would render an invisible indicator.

Invalid configuration fails at activation with the offending value and the accepted values in the message. Pi logs the extension load error and carries on, so a broken configuration disables this package rather than the session.

The interval is always applied as a floor: `max(loaderIntervalMs, configuredIntervalMs)`. A loader that is already slower than the configured value keeps its own interval; this package never accelerates anything.

## Scope of the patch

The patch is process-wide: it affects every `Loader` in the process, including loaders owned by other extensions. That is the point — all of pi's spinners share the same redraw cost — but it is a global effect, so set `PI_QUIET_SPINNER=default` or uninstall the package to get the upstream behavior back.

The patch does not change how a loader decides to color its indicator. A loader that passed its own indicator keeps rendering it verbatim; a loader that did not keeps the theme-colored spinner path.

If `@earendil-works/pi-tui` no longer exposes the patched methods, activation fails with an error naming the missing method instead of silently doing nothing.

## EXIT PLAN

This is a workaround for an upstream cost, not a feature.

**Delete this package once upstream stops re-rendering the whole transcript per frame** (issues [earendil-works/pi#9549](https://github.com/earendil-works/pi/issues/9549) and [#6665](https://github.com/earendil-works/pi/issues/6665)).

Re-check by running `!sleep 60` in a large session and watching `ps -o time= -p <pid>`: if that no longer pegs a core, the workaround is obsolete and should be removed rather than kept as a permanent patch on a dependency's prototype.

## Development

```bash
npm test              # focused acceptance checks
npm run check         # type-check
npm run pack:dry-run  # verify the published file list
```

The tests transpile `src/index.ts` in memory with the runtime import replaced by a stub, so they run under plain Node (including CI's Node 20) and under `bun run` without loading the TUI runtime. They exercise the option resolver and the patch contract; they do not import the real `pi-tui`.

## License

MIT
