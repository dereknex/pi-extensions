// Acceptance A1: `quiet-spinner` settings resolution.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertThrowsNaming, loadSource } from "./_load-src.mjs";

const { module: source } = await loadSource();
const { resolveOptions, loadConfig } = source;

const QUICK = 30000;

// --- defaults -----------------------------------------------------------------
{
	const options = resolveOptions();
	assert.ok(options, "an absent settings block resolves to a patch, not null");
	assert.equal(options.intervalMs, 1000, "the default preset floors at 1000 ms");
	assert.equal(options.frames.length, 4, "the default preset uses four frames");
}
assert.deepEqual(resolveOptions({}), resolveOptions(), "an empty settings block matches the default");

// --- presets ------------------------------------------------------------------
{
	const options = resolveOptions({ preset: "still" });
	assert.ok(options);
	assert.equal(options.frames.length, 1, "still uses exactly one frame");
	assert.equal(options.intervalMs, 1000);
}
{
	const options = resolveOptions({ preset: "calm" });
	assert.ok(options);
	assert.equal(options.frames.length, 8, "calm uses eight frames");
	assert.equal(options.intervalMs, 400, "calm runs at 400 ms");
}
assert.equal(resolveOptions({ preset: "default" }), null, "default installs no patch");

// --- overrides win over the preset --------------------------------------------
{
	const options = resolveOptions({ preset: "default", intervalMs: 500 });
	assert.ok(options, "an override makes `default` produce a patch");
	assert.equal(options.intervalMs, 500);
	assert.equal(options.frames, null, "an interval-only override keeps each loader's own frames");
}
{
	const options = resolveOptions({ intervalMs: 250 });
	assert.ok(options);
	assert.equal(options.intervalMs, 250, "the interval override wins over the preset");
	assert.equal(options.frames.length, 4, "the preset still supplies the frames");
}
{
	const options = resolveOptions({ frames: ["a", "b"] });
	assert.ok(options);
	assert.deepEqual(options.frames, ["a", "b"], "the frames override wins over the preset");
	assert.equal(options.intervalMs, 1000, "the preset still supplies the interval");
}
{
	const options = resolveOptions({ preset: "still", frames: ["⠋", "⠙"] });
	assert.ok(options);
	assert.deepEqual(options.frames, ["⠋", "⠙"], "the frames override wins even over `still`");
}
{
	const options = resolveOptions({ frames: ["a", "𠮷", "b"] });
	assert.ok(options);
	assert.equal(options.frames.length, 3, "each array entry is one frame");
	assert.equal(options.frames[1], "𠮷");
}

// --- invalid configuration fails loudly ---------------------------------------
assertThrowsNaming(() => resolveOptions({ preset: "fast" }), '"fast"');
assertThrowsNaming(() => resolveOptions({ preset: "fast" }), "quiet");
assertThrowsNaming(() => resolveOptions({ preset: 4 }), "4");
assertThrowsNaming(() => resolveOptions({ intervalMs: 0 }), "0");
assertThrowsNaming(() => resolveOptions({ intervalMs: "abc" }), '"abc"');
assertThrowsNaming(() => resolveOptions({ intervalMs: -5 }), "-5");
assertThrowsNaming(() => resolveOptions({ intervalMs: 1.5 }), "1.5");
// Node clamps a timer delay outside 1..2147483647 to 1 ms, which would turn a
// slow-down request into a redraw storm.
assertThrowsNaming(() => resolveOptions({ intervalMs: 2147483648 }), "2147483648");
assert.equal(
	resolveOptions({ intervalMs: 2147483647 }).intervalMs,
	2147483647,
	"the largest usable timer delay is accepted",
);
assert.equal(resolveOptions({ intervalMs: 1 }).intervalMs, 1, "the smallest delay is accepted");
assertThrowsNaming(() => resolveOptions({ frames: [] }), "frames");
assertThrowsNaming(() => resolveOptions({ frames: ["", "a"] }), "frames");
assertThrowsNaming(() => resolveOptions({ frames: ["   "] }), "frames");
assertThrowsNaming(() => resolveOptions({ frames: "ab" }), '"ab"');
assertThrowsNaming(() => resolveOptions({ intervallMs: 500 }), "intervallMs");
assertThrowsNaming(() => resolveOptions(null), "settings object");
assertThrowsNaming(() => resolveOptions([]), "settings object");

// --- settings files: the project block overrides the global one -----------------
function sandbox(globalSettings, projectSettings) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-quiet-spinner-"));
	const home = path.join(root, "home");
	const cwd = path.join(root, "project");
	fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
	fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	if (globalSettings !== undefined)
		fs.writeFileSync(path.join(home, ".pi", "agent", "settings.json"), JSON.stringify(globalSettings));
	if (projectSettings !== undefined)
		fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify(projectSettings));
	return { root, home, cwd };
}

const dirs = [];
try {
	{
		const { root, home, cwd } = sandbox({ "quiet-spinner": { preset: "calm" } });
		dirs.push(root);
		const options = resolveOptions(loadConfig(cwd, home));
		assert.ok(options);
		assert.equal(options.frames.length, 8, "the global block supplies the preset frames");
		assert.equal(options.intervalMs, 400, "the global block supplies the preset interval");
	}
	{
		const { root, home, cwd } = sandbox({ "quiet-spinner": { preset: "calm" } }, { "quiet-spinner": { preset: "still" } });
		dirs.push(root);
		const options = resolveOptions(loadConfig(cwd, home));
		assert.ok(options);
		assert.equal(options.frames.length, 1, "the project block overrides the global preset");
	}
	{
		const { root, home, cwd } = sandbox(
			{ "quiet-spinner": { preset: "calm", intervalMs: 700 } },
			{ "quiet-spinner": { intervalMs: 250 } },
		);
		dirs.push(root);
		const options = resolveOptions(loadConfig(cwd, home));
		assert.ok(options);
		assert.equal(options.frames.length, 8, "a project override keeps the global preset's other keys");
		assert.equal(options.intervalMs, 250, "the project key overrides the global key");
	}
	{
		const { root, home, cwd } = sandbox({ "minimal-footer": { showCwd: false } });
		dirs.push(root);
		assert.deepEqual(resolveOptions(loadConfig(cwd, home)), resolveOptions(), "unrelated settings are ignored");
	}
	{
		const { root, home, cwd } = sandbox();
		dirs.push(root);
		assert.deepEqual(resolveOptions(loadConfig(cwd, home)), resolveOptions(), "missing files use defaults");
	}
	{
		const { root, home, cwd } = sandbox({ "quiet-spinner": "calm" });
		dirs.push(root);
		assertThrowsNaming(() => resolveOptions(loadConfig(cwd, home)), "settings object");
	}
	{
		const { root, home, cwd } = sandbox();
		dirs.push(root);
		fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), "{ not json");
		assertThrowsNaming(() => resolveOptions(loadConfig(cwd, home)), "cannot parse");
	}
} finally {
	for (const root of dirs) fs.rmSync(root, { recursive: true, force: true });
}

console.log(`options.test.mjs: ok (${QUICK / 1000}s budget)`);
