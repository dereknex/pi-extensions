// Acceptance A1: preset and override resolution.
import assert from "node:assert/strict";
import { assertThrowsNaming, loadSource } from "./_load-src.mjs";

const { module: source } = await loadSource();
const { resolveOptions } = source;

const QUICK = 30000;

// --- defaults -----------------------------------------------------------------
{
	const options = resolveOptions({});
	assert.ok(options, "an unset environment resolves to a patch, not null");
	assert.equal(options.intervalMs, 1000, "the default preset floors at 1000 ms");
	assert.equal(options.frames.length, 4, "the default preset uses four frames");
}
{
	assert.deepEqual(resolveOptions({ PI_QUIET_SPINNER: "" }), resolveOptions({}), "an empty preset is unset");
	assert.deepEqual(
		resolveOptions({ PI_QUIET_SPINNER: "   " }),
		resolveOptions({}),
		"a whitespace-only preset is unset",
	);
}

// --- presets ------------------------------------------------------------------
{
	const options = resolveOptions({ PI_QUIET_SPINNER: "still" });
	assert.ok(options);
	assert.equal(options.frames.length, 1, "still uses exactly one frame");
	assert.equal(options.intervalMs, 1000);
}
{
	const options = resolveOptions({ PI_QUIET_SPINNER: "calm" });
	assert.ok(options);
	assert.equal(options.frames.length, 8, "calm uses eight frames");
	assert.equal(options.intervalMs, 400, "calm runs at 400 ms");
}
assert.equal(resolveOptions({ PI_QUIET_SPINNER: "default" }), null, "default installs no patch");

// --- overrides win over the preset --------------------------------------------
{
	const options = resolveOptions({ PI_QUIET_SPINNER: "default", PI_QUIET_SPINNER_INTERVAL_MS: "500" });
	assert.ok(options, "an override makes `default` produce a patch");
	assert.equal(options.intervalMs, 500);
	assert.equal(options.frames, null, "an interval-only override keeps each loader's own frames");
}
{
	const options = resolveOptions({ PI_QUIET_SPINNER_INTERVAL_MS: "250" });
	assert.ok(options);
	assert.equal(options.intervalMs, 250, "the interval override wins over the preset");
	assert.equal(options.frames.length, 4, "the preset still supplies the frames");
}
{
	const options = resolveOptions({ PI_QUIET_SPINNER_FRAMES: "ab" });
	assert.ok(options);
	assert.deepEqual(options.frames, ["a", "b"], "the frames override wins over the preset");
	assert.equal(options.intervalMs, 1000, "the preset still supplies the interval");
}
{
	const options = resolveOptions({ PI_QUIET_SPINNER: "still", PI_QUIET_SPINNER_FRAMES: "⠋⠙" });
	assert.ok(options);
	assert.deepEqual(options.frames, ["⠋", "⠙"], "the frames override wins even over `still`");
}
{
	const options = resolveOptions({ PI_QUIET_SPINNER_FRAMES: "a𠮷b" });
	assert.ok(options);
	assert.equal(options.frames.length, 3, "frames are split by code point, not UTF-16 unit");
	assert.equal(options.frames[1], "𠮷");
}

// --- invalid configuration fails loudly ---------------------------------------
assertThrowsNaming(() => resolveOptions({ PI_QUIET_SPINNER: "fast" }), '"fast"');
assertThrowsNaming(() => resolveOptions({ PI_QUIET_SPINNER: "fast" }), "quiet");
assertThrowsNaming(() => resolveOptions({ PI_QUIET_SPINNER_INTERVAL_MS: "0" }), '"0"');
assertThrowsNaming(() => resolveOptions({ PI_QUIET_SPINNER_INTERVAL_MS: "abc" }), '"abc"');
assertThrowsNaming(() => resolveOptions({ PI_QUIET_SPINNER_INTERVAL_MS: "-5" }), '"-5"');
// Node clamps a timer delay outside 1..2147483647 to 1 ms, which would turn a
// slow-down request into a redraw storm.
assertThrowsNaming(() => resolveOptions({ PI_QUIET_SPINNER_INTERVAL_MS: "2147483648" }), '"2147483648"');
assertThrowsNaming(() => resolveOptions({ PI_QUIET_SPINNER_INTERVAL_MS: "9".repeat(400) }), "2147483647");
assert.equal(
	resolveOptions({ PI_QUIET_SPINNER_INTERVAL_MS: "2147483647" }).intervalMs,
	2147483647,
	"the largest usable timer delay is accepted",
);
assert.equal(resolveOptions({ PI_QUIET_SPINNER_INTERVAL_MS: "1" }).intervalMs, 1, "the smallest delay is accepted");
assertThrowsNaming(() => resolveOptions({ PI_QUIET_SPINNER_FRAMES: "" }), '""');
assertThrowsNaming(() => resolveOptions({ PI_QUIET_SPINNER_FRAMES: "   " }), '"   "');

console.log(`options.test.mjs: ok (${QUICK / 1000}s budget)`);
