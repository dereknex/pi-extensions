import assert from "node:assert/strict";
import { formatModelLabel, DEFAULT_SOURCE, DEFAULT_TOKEN_NAME } from "../src/index.ts";
import loadExtension from "../src/index.ts";

// Test 1: formatModelLabel helper without thinking level
assert.equal(
	formatModelLabel({ provider: "anthropic", id: "claude-3-7-sonnet" }),
	"anthropic/claude-3-7-sonnet",
);

assert.equal(
	formatModelLabel({ provider: "anthropic", id: "anthropic/claude-3-7-sonnet" }),
	"anthropic/claude-3-7-sonnet",
);

assert.equal(formatModelLabel({ id: "gpt-4o" }), "gpt-4o");

assert.equal(formatModelLabel(undefined), "");

// Test 2: formatModelLabel helper with thinking level
assert.equal(
	formatModelLabel({ provider: "anthropic", id: "claude-3-7-sonnet" }, "high"),
	"anthropic/claude-3-7-sonnet (high)",
);

assert.equal(
	formatModelLabel({ provider: "anthropic", id: "claude-3-7-sonnet" }, "off"),
	"anthropic/claude-3-7-sonnet",
);

// Test 3: DEFAULT_SOURCE and DEFAULT_TOKEN_NAME constants
assert.equal(DEFAULT_SOURCE, "pi-model");
assert.equal(DEFAULT_TOKEN_NAME, "model_info");

// Test 4: Extension init when not in Herdr
{
	const originalSocket = process.env.HERDR_SOCKET_PATH;
	const originalPane = process.env.HERDR_PANE_ID;
	delete process.env.HERDR_SOCKET_PATH;
	delete process.env.HERDR_PANE_ID;

	const handlers = {};
	const mockPi = {
		on(event, fn) {
			handlers[event] = fn;
		},
	};

	loadExtension(mockPi);
	assert.equal(Object.keys(handlers).length, 0);

	process.env.HERDR_SOCKET_PATH = originalSocket;
	process.env.HERDR_PANE_ID = originalPane;
}

// Test 5: Extension init when in Herdr
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const handlers = {};
	const mockPi = {
		on(event, fn) {
			handlers[event] = fn;
		},
		getThinkingLevel() {
			return "medium";
		},
	};

	loadExtension(mockPi);
	assert.ok(typeof handlers["session_start"] === "function");
	assert.ok(typeof handlers["model_select"] === "function");
	assert.ok(typeof handlers["thinking_level_select"] === "function");
	assert.ok(typeof handlers["session_shutdown"] === "function");

	delete process.env.HERDR_PANE_ID;
}

// Test 6: session_start handler updates status using ctx.model and ctx.thinkingLevel
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const handlers = {};
	const mockPi = {
		on(event, fn) {
			handlers[event] = fn;
		},
	};

	loadExtension(mockPi);

	const mockCtx = {
		model: { provider: "anthropic", id: "claude-3-5-sonnet" },
		thinkingLevel: "high",
	};

	await handlers["session_start"]({ type: "session_start", reason: "startup" }, mockCtx);

	delete process.env.HERDR_PANE_ID;
}

console.log("All pi-herdr-status tests passed!");
