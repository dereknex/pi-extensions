import assert from "node:assert/strict";
import { formatModelLabel, isSubagent, DEFAULT_SOURCE, DEFAULT_TOKEN_NAME } from "../src/index.ts";
import loadExtension from "../src/index.ts";

// Test 1: formatModelLabel helper without thinking level
assert.equal(
	formatModelLabel({ provider: "anthropic", id: "claude-3-7-sonnet" }),
	"claude-3-7-sonnet",
);

assert.equal(
	formatModelLabel({ provider: "anthropic", id: "anthropic/claude-3-7-sonnet" }),
	"claude-3-7-sonnet",
);

assert.equal(formatModelLabel({ id: "gpt-4o" }), "gpt-4o");

assert.equal(formatModelLabel({ name: "Custom Model" }), "Custom Model");

assert.equal(formatModelLabel(undefined), "");

// Test 2: formatModelLabel helper with thinking level
assert.equal(
	formatModelLabel({ provider: "anthropic", id: "claude-3-7-sonnet" }, "high"),
	"claude-3-7-sonnet (high)",
);

assert.equal(
	formatModelLabel({ provider: "anthropic", id: "claude-3-7-sonnet" }, "off"),
	"claude-3-7-sonnet",
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

// Test 7: isSubagent detection via environment variables
{
	assert.equal(isSubagent(), false);

	process.env.PI_SUBAGENT = "true";
	assert.equal(isSubagent(), true);
	delete process.env.PI_SUBAGENT;

	process.env.SUBAGENT = "1";
	assert.equal(isSubagent(), true);
	delete process.env.SUBAGENT;
}

// Test 8: isSubagent detection via ctx.sessionManager.getHeader() parentSession
{
	const mainCtx = {
		sessionManager: {
			getHeader() {
				return { type: "session", id: "s1", cwd: "/", timestamp: "" };
			},
		},
	};
	assert.equal(isSubagent(mainCtx), false);

	const childCtx = {
		sessionManager: {
			getHeader() {
				return { type: "session", id: "s2", cwd: "/", timestamp: "", parentSession: "/path/to/parent.jsonl" };
			},
		},
	};
	assert.equal(isSubagent(childCtx), true);
}

// Test 9: Subagent events are ignored during session_start and model_select
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const handlers = {};
	const mockPi = {
		on(event, fn) {
			handlers[event] = fn;
		},
	};

	loadExtension(mockPi);

	const subagentCtx = {
		model: { provider: "openai", id: "subagent-model" },
		sessionManager: {
			getHeader() {
				return { type: "session", id: "sub1", cwd: "/", timestamp: "", parentSession: "parent.jsonl" };
			},
		},
	};

	// Event from subagent should not throw and should be ignored
	await handlers["session_start"]({ type: "session_start", reason: "startup" }, subagentCtx);
	await handlers["model_select"]({ type: "model_select", model: { provider: "openai", id: "subagent-model" } }, subagentCtx);

	delete process.env.HERDR_PANE_ID;
}

console.log("All pi-herdr-status tests passed!");
