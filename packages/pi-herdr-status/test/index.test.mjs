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

const {
	formatModelLabel,
	isSubagent,
	_setExecFileImplForTest,
	_waitForMetadataQueueForTest,
	DEFAULT_SOURCE,
	DEFAULT_TOKEN_NAME,
	reportAgentState,
	patchUI,
	default: loadExtension,
} = await import(pathToFileURL(compiledJsPath).href);

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
// Mocks mirror the real SessionManager shape: getSessionFile reads `this.sessionFile`,
// so detached calls (lost receiver) throw instead of silently returning a value.
{
	const mainCtx = {
		sessionManager: {
			sessionFile: "/sessions/s1.jsonl",
			getHeader() {
				return { type: "session", id: "s1", cwd: "/", timestamp: "" };
			},
			getSessionFile() {
				return this.sessionFile;
			},
		},
	};
	assert.equal(isSubagent(mainCtx), false);

	const childCtx = {
		sessionManager: {
			sessionFile: "/sessions/s2.jsonl",
			getHeader() {
				return { type: "session", id: "s2", cwd: "/", timestamp: "", parentSession: "/path/to/parent.jsonl" };
			},
			getSessionFile() {
				return this.sessionFile;
			},
		},
	};
	assert.equal(isSubagent(childCtx), true);
}

// Test 8b: isSubagent detects in-memory subagent sessions (no parentSession, no session file)
{
	const inMemorySubagentCtx = {
		sessionManager: {
			sessionFile: undefined,
			getHeader() {
				return { type: "session", id: "sub1", cwd: "/", timestamp: "" };
			},
			getSessionFile() {
				return this.sessionFile;
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
		const currentDelay = delay;
		delay += 30;
		setTimeout(() => {
			recorded.push(args);
			callback(null);
		}, currentDelay);
	});

	const { reportMetadata, clearMetadata } = await import(pathToFileURL(compiledJsPath).href);
	reportMetadata("claude-3-7-sonnet", "w1:p1");
	reportMetadata("gpt-4o", "w1:p1");
	clearMetadata("w1:p1");
	await _waitForMetadataQueueForTest();

	assert.equal(recorded.length, 3);
	assert.ok(recorded[0].join(" ").includes("model_info=claude-3-7-sonnet"));
	assert.ok(recorded[1].join(" ").includes("model_info=gpt-4o"));
	assert.ok(recorded[2].join(" ").includes("--clear-token"));

	_setExecFileImplForTest();
}

// Test 11: session_shutdown only clears metadata and updates state on real quit
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const handlers = {};
	loadExtension({
		on(event, fn) {
			handlers[event] = fn;
		},
	});

	const ctx = {
		sessionManager: {
			sessionFile: "/sessions/s1.jsonl",
			getHeader() {
				return { type: "session", id: "s1", cwd: "/", timestamp: "" };
			},
			getSessionFile() {
				return this.sessionFile;
			},
		},
	};

	await handlers.session_shutdown({ type: "session_shutdown", reason: "new" }, ctx);
	await handlers.session_shutdown({ type: "session_shutdown", reason: "resume" }, ctx);
	await handlers.session_shutdown({ type: "session_shutdown", reason: "reload" }, ctx);
	assert.equal(recorded.length, 0, "session switches must not clear metadata");

	await handlers.session_shutdown({ type: "session_shutdown", reason: "quit" }, ctx);
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 2, "quit must clear metadata and report idle state");
	assert.ok(recorded[0].join(" ").includes("--clear-token"));
	assert.ok(recorded[1].join(" ").includes("--agent pi --state idle"));

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
}

// Test 12: reportAgentState formats CLI arguments correctly
{
	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	reportAgentState("blocked", "Waiting for user: bash", undefined, "w1:p1");
	await _waitForMetadataQueueForTest();

	assert.equal(recorded.length, 1);
	const argStr = recorded[0].join(" ");
	assert.ok(argStr.includes("report-agent"));
	assert.ok(argStr.includes("--source pi-model"));
	assert.ok(argStr.includes("--agent pi"));
	assert.ok(argStr.includes("--state blocked"));
	assert.ok(argStr.includes("--message Waiting for user: bash"));
	assert.ok(argStr.includes("w1:p1"));

	_setExecFileImplForTest();
}

// Test 13: lifecycle events report against the stable pi agent identity
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const handlers = {};
	loadExtension({
		on(event, fn) {
			handlers[event] = fn;
		},
	});

	const ctx = {
		hasUI: false,
		model: { provider: "anthropic", id: "claude-3-7-sonnet" },
		sessionManager: {
			sessionFile: "/sessions/s1.jsonl",
			getHeader() {
				return { type: "session", id: "s1", cwd: "/", timestamp: "" };
			},
			getSessionFile() {
				return this.sessionFile;
			},
		},
	};

	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
	await _waitForMetadataQueueForTest();
	recorded.length = 0;

	await handlers.agent_start({ type: "agent_start" }, ctx);
	await handlers.tool_execution_start({ type: "tool_execution_start", toolName: "edit" }, ctx);
	await handlers.agent_settled({ type: "agent_settled" }, ctx);
	await _waitForMetadataQueueForTest();

	assert.deepEqual(recorded.map((args) => args[args.indexOf("--state") + 1]), ["working", "working", "idle"]);
	assert.ok(recorded.every((args) => args.join(" ").includes("--agent pi")));
	assert.equal(handlers.tool_call, undefined, "ordinary tool calls must not be reported as blocked");

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
}

// Test 14: patchUI preserves all dialog methods and closes on rejection
{
	const events = [];
	const ui = {
		async confirm() {
			return true;
		},
		async select(_title, options) {
			return options[0];
		},
		async input() {
			return "typed";
		},
		async editor() {
			throw new Error("cancelled");
		},
	};

	patchUI(ui, (title) => events.push(`open:${title}`), () => events.push("close"));
	patchUI(ui, () => events.push("patched twice"), () => events.push("patched twice"));

	assert.equal(await ui.confirm("Confirm", "message"), true);
	assert.equal(await ui.select("Select", ["first"]), "first");
	assert.equal(await ui.input("Input"), "typed");
	await assert.rejects(ui.editor("Editor"), /cancelled/);
	assert.deepEqual(events, [
		"open:Confirm", "close",
		"open:Select", "close",
		"open:Input", "close",
		"open:Editor", "close",
	]);
}

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function createDialogUI(confirmDialog = deferred(), inputDialog = deferred()) {
	return {
		confirmDialog,
		inputDialog,
		ui: {
			confirm() {
				return confirmDialog.promise;
			},
			async select(_title, options) {
				return options[0];
			},
			input() {
				return inputDialog.promise;
			},
			async editor(_title, prefill) {
				return prefill;
			},
		},
	};
}

function createMainSessionContext(ui, hasUI = true) {
	return {
		ui,
		hasUI,
		sessionManager: {
			sessionFile: "/sessions/s1.jsonl",
			getHeader() {
				return { type: "session", id: "s1", cwd: "/", timestamp: "" };
			},
			getSessionFile() {
				return this.sessionFile;
			},
		},
	};
}

// Test 15: dialogs remain blocked until the final overlapping dialog closes
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const handlers = {};
	loadExtension({
		on(event, fn) {
			handlers[event] = fn;
		},
	});

	const { ui, confirmDialog, inputDialog } = createDialogUI();
	const ctx = createMainSessionContext(ui);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);

	const confirmPromise = ui.confirm("Confirm action", "message");
	const inputPromise = ui.input("Enter value");
	await _waitForMetadataQueueForTest();
	assert.deepEqual(recorded.map((args) => args[args.indexOf("--state") + 1]), ["blocked", "blocked"]);
	assert.ok(recorded.every((args) => args.join(" ").includes("--agent pi")));

	await handlers.agent_start({ type: "agent_start" }, ctx);
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 2, "lifecycle changes must not overwrite an open dialog");

	confirmDialog.resolve(true);
	assert.equal(await confirmPromise, true);
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 2, "closing one dialog must keep the other blocked");

	inputDialog.resolve("value");
	assert.equal(await inputPromise, "value");
	await _waitForMetadataQueueForTest();
	assert.equal(recorded[2][recorded[2].indexOf("--state") + 1], "working");

	await handlers.agent_settled({ type: "agent_settled" }, ctx);
	await _waitForMetadataQueueForTest();
	assert.equal(recorded[3][recorded[3].indexOf("--state") + 1], "idle");

	const selectResult = await ui.select("Pick", ["one"]);
	assert.equal(selectResult, "one");
	await _waitForMetadataQueueForTest();
	assert.deepEqual(recorded.slice(-2).map((args) => args[args.indexOf("--state") + 1]), ["blocked", "idle"]);

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
}

// Test 16: non-interactive contexts do not patch no-op dialogs
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const handlers = {};
	loadExtension({
		on(event, fn) {
			handlers[event] = fn;
		},
	});

	const { ui, confirmDialog } = createDialogUI();
	const ctx = createMainSessionContext(ui, false);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
	const confirmPromise = ui.confirm("No UI", "message");
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 0);

	confirmDialog.resolve(false);
	assert.equal(await confirmPromise, false);
	assert.equal(recorded.length, 0);

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
}

console.log("All pi-herdr-status tests passed!");
