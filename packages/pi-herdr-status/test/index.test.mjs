import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcTsPath = path.resolve(__dirname, "../src/index.ts");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-herdr-status-test-"));
const compiledJsPath = path.join(tempDir, "index.js");

const tsSource = fs.readFileSync(srcTsPath, "utf8");
const { outputText } = ts.transpileModule(tsSource, {
	compilerOptions: {
		module: ts.ModuleKind.ESNext,
		target: ts.ScriptTarget.ES2022,
	},
});
fs.writeFileSync(compiledJsPath, outputText, "utf8");

const { formatModelLabel, isSubagent, _setExecFileImplForTest, DEFAULT_SOURCE, DEFAULT_TOKEN_NAME, default: loadExtension } =
	await import(pathToFileURL(compiledJsPath).href);

fs.rmSync(tempDir, { recursive: true, force: true });

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
			getSessionFile() {
				return "/sessions/s1.jsonl";
			},
		},
	};
	assert.equal(isSubagent(mainCtx), false);

	const childCtx = {
		sessionManager: {
			getHeader() {
				return { type: "session", id: "s2", cwd: "/", timestamp: "", parentSession: "/path/to/parent.jsonl" };
			},
			getSessionFile() {
				return "/sessions/s2.jsonl";
			},
		},
	};
	assert.equal(isSubagent(childCtx), true);
}

// Test 8b: isSubagent detects in-memory subagent sessions (no parentSession, no session file)
{
	const inMemorySubagentCtx = {
		sessionManager: {
			getHeader() {
				return { type: "session", id: "sub1", cwd: "/", timestamp: "" };
			},
			getSessionFile() {
				return undefined;
			},
		},
	};
	assert.equal(isSubagent(inMemorySubagentCtx), true);
}

// Test 8c: isSubagent is defensive when sessionManager lacks getSessionFile
{
	const bareCtx = {
		sessionManager: {
			getHeader() {
				return { type: "session", id: "s3", cwd: "/", timestamp: "" };
			},
		},
	};
	assert.equal(isSubagent(bareCtx), true);
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

// Test 10: herdr CLI invocations are serialized FIFO
{
	const recorded = [];
	let delay = 0;
	_setExecFileImplForTest((command, args, callback) => {
		// First call completes slowly, second would overtake it without a queue.
		const d = delay;
		delay += 30;
		setTimeout(() => {
			recorded.push(args);
			callback(null);
		}, d);
	});

	const { reportMetadata, clearMetadata } = await import(pathToFileURL(compiledJsPath).href);
	reportMetadata("claude-3-7-sonnet", "w1:p1");
	reportMetadata("gpt-4o", "w1:p1");
	clearMetadata("w1:p1");
	await new Promise((resolve) => setTimeout(resolve, 150));

	assert.equal(recorded.length, 3);
	assert.ok(recorded[0].join(" ").includes("model_info=claude-3-7-sonnet"));
	assert.ok(recorded[1].join(" ").includes("model_info=gpt-4o"));
	assert.ok(recorded[2].join(" ").includes("--clear-token"));

	_setExecFileImplForTest();
}

// Test 11: session_shutdown only clears metadata on real quit
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const handlers = {};
	const mockPi = {
		on(event, fn) {
			handlers[event] = fn;
		},
	};

	loadExtension(mockPi);

	const ctx = {
		sessionManager: {
			getHeader() {
				return { type: "session", id: "s1", cwd: "/", timestamp: "" };
			},
			getSessionFile() {
				return "/sessions/s1.jsonl";
			},
		},
	};

	await handlers["session_shutdown"]({ type: "session_shutdown", reason: "new" }, ctx);
	await handlers["session_shutdown"]({ type: "session_shutdown", reason: "resume" }, ctx);
	await handlers["session_shutdown"]({ type: "session_shutdown", reason: "reload" }, ctx);
	assert.equal(recorded.length, 0, "session switches must not clear metadata");

	await handlers["session_shutdown"]({ type: "session_shutdown", reason: "quit" }, ctx);
	assert.equal(recorded.length, 1, "quit must clear metadata once");
	assert.ok(recorded[0].join(" ").includes("--clear-token"));

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
}

console.log("All pi-herdr-status tests passed!");
