// Acceptance A2: patch semantics.
import assert from "node:assert/strict";
import { assertThrowsNaming, loadSource } from "./_load-src.mjs";

// The activation wiring reads the process environment; keep this run deterministic.
delete process.env.PI_QUIET_SPINNER;
delete process.env.PI_QUIET_SPINNER_INTERVAL_MS;
delete process.env.PI_QUIET_SPINNER_FRAMES;

const { module: source, Loader } = await loadSource();
const { installQuietSpinner } = source;

const FLOOR_1000 = { frames: null, intervalMs: 1000 };

// --- the interval is a floor, never an accelerator -----------------------------
{
	class Probe extends Loader {}
	installQuietSpinner(Probe.prototype, FLOOR_1000);

	const slow = new Probe();
	slow.intervalMs = 2000;
	slow.restartAnimation();
	assert.equal(slow.intervalMs, 2000, "a loader already slower than the floor keeps its interval");

	const upstreamSpeed = new Probe();
	assert.equal(upstreamSpeed.intervalMs, 80, "the probe starts at the upstream interval");
	upstreamSpeed.restartAnimation();
	assert.equal(upstreamSpeed.intervalMs, 1000, "an upstream-speed loader is raised to the floor");

	const unusable = new Probe();
	unusable.intervalMs = undefined;
	unusable.restartAnimation();
	assert.equal(unusable.intervalMs, 1000, "an unusable interval falls back to the floor, not to NaN");

	slow.stop();
	upstreamSpeed.stop();
	unusable.stop();
}

// --- the frame override applies without touching the color decision ------------
{
	class Probe extends Loader {}
	installQuietSpinner(Probe.prototype, { frames: ["⠋", "⠙", "⠹", "⠸"], intervalMs: 1000 });

	const loader = new Probe();
	loader.setIndicator();
	assert.equal(loader.renderIndicatorVerbatim, false, "an indicator-less loader keeps the colored path");
	assert.deepEqual(loader.frames, ["⠋", "⠙", "⠹", "⠸"], "the frame override replaces the loader's frames");
	assert.equal(loader.intervalMs, 1000, "the floor applies to the loader's own interval");
	assert.notEqual(loader.intervalId, null, "a multi-frame override leaves the animation armed");
	loader.stop();
}
{
	class Probe extends Loader {}
	installQuietSpinner(Probe.prototype, { frames: ["⠿"], intervalMs: 1000 });

	const loader = new Probe();
	loader.setIndicator();
	assert.deepEqual(loader.frames, ["⠿"], "a single-frame override is applied");
	assert.equal(loader.intervalId, null, "a single-frame override stops the timer instead of ticking on it");
}
{
	class Probe extends Loader {}
	installQuietSpinner(Probe.prototype, { frames: ["x", "y"], intervalMs: 1000 });

	const loader = new Probe();
	loader.setIndicator({ frames: ["a", "b", "c"], intervalMs: 120 });
	assert.equal(loader.renderIndicatorVerbatim, true, "an explicit indicator keeps rendering verbatim");
	assert.deepEqual(loader.frames, ["x", "y"], "the frame override still applies to an explicit indicator");
	assert.equal(loader.intervalMs, 1000, "the floor still applies to an explicit interval");
	loader.stop();
}
{
	class Probe extends Loader {}
	installQuietSpinner(Probe.prototype, FLOOR_1000);

	const loader = new Probe();
	loader.setIndicator({ frames: ["a", "b", "c"], intervalMs: 120 });
	assert.deepEqual(loader.frames, ["a", "b", "c"], "without a frame override the caller's frames are kept");
	assert.equal(loader.renderIndicatorVerbatim, true);
	assert.equal(loader.intervalMs, 1000);
	loader.stop();
}

// --- installing twice neither stacks wrappers nor changes behavior -------------
{
	class Probe extends Loader {}
	const original = Probe.prototype.restartAnimation;
	let wrapperCalls = 0;
	Probe.prototype.restartAnimation = function (...args) {
		wrapperCalls += 1;
		return original.apply(this, args);
	};

	installQuietSpinner(Probe.prototype, FLOOR_1000);
	installQuietSpinner(Probe.prototype, { frames: null, intervalMs: 50 });

	const loader = new Probe();
	loader.restartAnimation();
	assert.equal(wrapperCalls, 1, "a second install does not stack a second wrapper");
	assert.equal(loader.intervalMs, 1000, "a second install does not replace the first floor");
	loader.stop();
}

// --- a missing patched method fails at activation -------------------------------
assertThrowsNaming(
	() => installQuietSpinner({ setIndicator() {} }, FLOOR_1000),
	"restartAnimation",
);
assertThrowsNaming(
	() => installQuietSpinner({ restartAnimation() {} }, FLOOR_1000),
	"setIndicator",
);

// --- the extension entry installs the resolved options on the Loader prototype ---
{
	const before = new Loader();
	assert.equal(before.intervalMs, 80, "the stub starts at the upstream interval");

	source.default({});

	const loader = new Loader();
	loader.setIndicator();
	assert.equal(loader.intervalMs, 1000, "the entry installs the default preset floor");
	assert.equal(loader.frames.length, 4, "the entry installs the default preset frames");
	loader.stop();
}

console.log("patch.test.mjs: ok");
