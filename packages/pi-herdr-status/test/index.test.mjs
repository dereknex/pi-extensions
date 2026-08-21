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

/** Creates a mock Pi ExtensionAPI with event bus support. */
function createMockPi() {
	const handlers = {};
	const eventHandlers = {};
	return {
		handlers,
		eventHandlers,
		pi: {
			on(event, fn) {
				handlers[event] = fn;
			},
			events: {
				on(channel, fn) {
					eventHandlers[channel] = fn;
					return () => { delete eventHandlers[channel]; };
				},
				emit(channel, data) {
					if (eventHandlers[channel]) eventHandlers[channel](data);
				},
			},
		},
	};
}

// Test 4: Extension init when not in Herdr
{
	const originalSocket = process.env.HERDR_SOCKET_PATH;
	const originalPane = process.env.HERDR_PANE_ID;
	delete process.env.HERDR_SOCKET_PATH;
	delete process.env.HERDR_PANE_ID;

	const { pi: mockPi, handlers } = createMockPi();

	loadExtension(mockPi);
	assert.equal(Object.keys(handlers).length, 0);

	process.env.HERDR_SOCKET_PATH = originalSocket;
	process.env.HERDR_PANE_ID = originalPane;
}

// Test 5: Extension init when in Herdr
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const { pi: mockPi, handlers, eventHandlers } = createMockPi();
	mockPi.getThinkingLevel = () => "medium";

	loadExtension(mockPi);
	assert.ok(typeof handlers["session_start"] === "function");
	assert.ok(typeof handlers["model_select"] === "function");
	assert.ok(typeof handlers["thinking_level_select"] === "function");
	assert.ok(typeof handlers["session_shutdown"] === "function");
	assert.ok(typeof eventHandlers["immune-brain:user-attention.v1"] === "function");

	delete process.env.HERDR_PANE_ID;
}

// Test 6: session_start handler updates status using ctx.model and ctx.thinkingLevel
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const { pi: mockPi, handlers } = createMockPi();

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

	const { pi: mockPi, handlers } = createMockPi();

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

	const { pi: mockPi11, handlers } = createMockPi();
	loadExtension(mockPi11);

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

	const { pi: mockPi13, handlers } = createMockPi();
	loadExtension(mockPi13);

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

	const { pi: mockPi15, handlers } = createMockPi();
	loadExtension(mockPi15);

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

	const { pi: mockPi16, handlers } = createMockPi();
	loadExtension(mockPi16);

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

console.log("All original pi-herdr-status tests passed!");

// =============================================================================
// Immune-Brain user-attention tests
// =============================================================================

/** Emits an attention event through the mock Pi event bus. */
function emitAttention(pi, payload) {
	pi.events.emit("immune-brain:user-attention.v1", payload);
}

// Test 17: Single attention open -> blocked, matching close -> unblocked
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const { pi: mockPi17, handlers } = createMockPi();
	loadExtension(mockPi17);

	const ctx = createMainSessionContext(createDialogUI().ui);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
	await _waitForMetadataQueueForTest();
	recorded.length = 0;

	emitAttention(mockPi17, { active: true, attention_id: "att-1", task_id: "t1", reason: "enrollment", label: "Approve enrollment" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 1);
	assert.equal(recorded[0][recorded[0].indexOf("--state") + 1], "blocked");
	assert.ok(recorded[0].join(" ").includes("Approve enrollment"));

	emitAttention(mockPi17, { active: false, attention_id: "att-1", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 2);
	assert.equal(recorded[1][recorded[1].indexOf("--state") + 1], "idle");

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
	console.log("Test 17 passed: single open/close");
}

// Test 18: Two concurrent attentions, closing one keeps blocked
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const { pi: mockPi18, handlers } = createMockPi();
	loadExtension(mockPi18);

	const ctx = createMainSessionContext(createDialogUI().ui);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
	await _waitForMetadataQueueForTest();
	recorded.length = 0;

	emitAttention(mockPi18, { active: true, attention_id: "att-a", task_id: "t1", reason: "enrollment" });
	emitAttention(mockPi18, { active: true, attention_id: "att-b", task_id: "t2", reason: "review_authorization" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 2);
	assert.ok(recorded.every((a) => a[a.indexOf("--state") + 1] === "blocked"));

	// Close one
	emitAttention(mockPi18, { active: false, attention_id: "att-a", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();
	// No unblock published because att-b still active
	assert.equal(recorded.length, 2, "closing one of two attentions must not unblock");

	// Close the other
	emitAttention(mockPi18, { active: false, attention_id: "att-b", task_id: "t2", reason: "review_authorization" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 3);
	assert.equal(recorded[2][recorded[2].indexOf("--state") + 1], "idle");

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
	console.log("Test 18 passed: two concurrent attentions");
}

// Test 19: Last close emits exactly one unblocked
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const { pi: mockPi19, handlers } = createMockPi();
	loadExtension(mockPi19);

	const ctx = createMainSessionContext(createDialogUI().ui);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
	await _waitForMetadataQueueForTest();
	recorded.length = 0;

	emitAttention(mockPi19, { active: true, attention_id: "att-x", task_id: "t1", reason: "enrollment" });
	emitAttention(mockPi19, { active: false, attention_id: "att-x", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();

	const stateChanges = recorded.map((a) => a[a.indexOf("--state") + 1]);
	assert.deepEqual(stateChanges, ["blocked", "idle"]);

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
	console.log("Test 19 passed: exactly one unblocked on last close");
}

// Test 20: Duplicate open, duplicate close, and unknown close are idempotent
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const { pi: mockPi20, handlers } = createMockPi();
	loadExtension(mockPi20);

	const ctx = createMainSessionContext(createDialogUI().ui);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
	await _waitForMetadataQueueForTest();
	recorded.length = 0;

	// Duplicate open
	emitAttention(mockPi20, { active: true, attention_id: "att-dup", task_id: "t1", reason: "enrollment" });
	emitAttention(mockPi20, { active: true, attention_id: "att-dup", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 1, "duplicate open must not double-publish");

	// Close once
	emitAttention(mockPi20, { active: false, attention_id: "att-dup", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 2);
	assert.equal(recorded[1][recorded[1].indexOf("--state") + 1], "idle");

	// Duplicate close
	emitAttention(mockPi20, { active: false, attention_id: "att-dup", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 2, "duplicate close must not publish again");

	// Unknown close
	emitAttention(mockPi20, { active: false, attention_id: "att-never-opened", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 2, "unknown close must be a no-op");

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
	console.log("Test 20 passed: idempotent duplicate/unknown events");
}

// Test 21: active:false without label still closes by attention_id
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const { pi: mockPi21, handlers } = createMockPi();
	loadExtension(mockPi21);

	const ctx = createMainSessionContext(createDialogUI().ui);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
	await _waitForMetadataQueueForTest();
	recorded.length = 0;

	emitAttention(mockPi21, { active: true, attention_id: "att-nolabel", task_id: "t1", reason: "enrollment", label: "Enroll now" });
	// Close without label field
	emitAttention(mockPi21, { active: false, attention_id: "att-nolabel", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 2);
	assert.equal(recorded[1][recorded[1].indexOf("--state") + 1], "idle");

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
	console.log("Test 21 passed: close without label works");
}

// Test 22: Malformed payloads do not change state and do not throw
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const { pi: mockPi22, handlers } = createMockPi();
	loadExtension(mockPi22);

	const ctx = createMainSessionContext(createDialogUI().ui);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
	await _waitForMetadataQueueForTest();
	recorded.length = 0;

	// All of these must be silently ignored
	emitAttention(mockPi22, null);
	emitAttention(mockPi22, undefined);
	emitAttention(mockPi22, 42);
	emitAttention(mockPi22, "string");
	emitAttention(mockPi22, { active: "yes", attention_id: "a1" }); // active not boolean
	emitAttention(mockPi22, { active: true }); // missing attention_id
	emitAttention(mockPi22, { active: true, attention_id: "" }); // empty attention_id
	emitAttention(mockPi22, { active: true, attention_id: 123, task_id: "t", reason: "enrollment" }); // attention_id not string
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 0, "malformed payloads must not produce state changes");

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
	console.log("Test 22 passed: malformed payloads ignored");
}

// Test 23: Shutdown clears unclosed attentions
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const { pi: mockPi23, handlers } = createMockPi();
	loadExtension(mockPi23);

	const ctx = createMainSessionContext(createDialogUI().ui);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
	await _waitForMetadataQueueForTest();
	recorded.length = 0;

	// Open two attentions, leave them open
	emitAttention(mockPi23, { active: true, attention_id: "att-leak-1", task_id: "t1", reason: "enrollment" });
	emitAttention(mockPi23, { active: true, attention_id: "att-leak-2", task_id: "t2", reason: "descriptor_waiver" });
	await _waitForMetadataQueueForTest();
	recorded.length = 0;

	await handlers.session_shutdown({ type: "session_shutdown", reason: "quit" }, ctx);
	await _waitForMetadataQueueForTest();

	// Should clear metadata + publish idle
	assert.ok(recorded.some((a) => a.join(" ").includes("--clear-token")));
	assert.ok(recorded.some((a) => a[a.indexOf("--state") + 1] === "idle"));

	// Verify attentions were cleaned: closing them should be no-ops
	const countBeforeClose = recorded.length;
	emitAttention(mockPi23, { active: false, attention_id: "att-leak-1", task_id: "t1", reason: "enrollment" });
	emitAttention(mockPi23, { active: false, attention_id: "att-leak-2", task_id: "t2", reason: "descriptor_waiver" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, countBeforeClose, "closing already-cleared attentions must be no-ops");

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
	console.log("Test 23 passed: shutdown clears unclosed attentions");
}

// Test 24: Attention unblock does not clear dialog-based blocked state
{
	process.env.HERDR_PANE_ID = "w1:p1";

	const recorded = [];
	_setExecFileImplForTest((command, args, callback) => {
		recorded.push(args);
		callback(null);
	});

	const { pi: mockPi24, handlers } = createMockPi();
	loadExtension(mockPi24);

	const { ui, confirmDialog } = createDialogUI();
	const ctx = createMainSessionContext(ui);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
	await _waitForMetadataQueueForTest();
	recorded.length = 0;

	// Open a UI dialog (other provider of blocked)
	const confirmPromise = ui.confirm("Confirm something");
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 1);
	assert.equal(recorded[0][recorded[0].indexOf("--state") + 1], "blocked");

	// Open and close an attention while dialog is still open
	emitAttention(mockPi24, { active: true, attention_id: "att-cross", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 2); // second blocked

	emitAttention(mockPi24, { active: false, attention_id: "att-cross", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();
	// Should NOT unblock because dialog is still open
	assert.equal(recorded.length, 2, "closing attention must not unblock while dialog is open");

	// Now close dialog
	confirmDialog.resolve(true);
	await confirmPromise;
	await _waitForMetadataQueueForTest();
	assert.equal(recorded.length, 3);
	assert.equal(recorded[2][recorded[2].indexOf("--state") + 1], "idle");

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
	console.log("Test 24 passed: attention does not clear dialog blocked");
}

// Test 25: Herdr publish failure does not throw to host
{
	process.env.HERDR_PANE_ID = "w1:p1";

	_setExecFileImplForTest((command, args, callback) => {
		callback(new Error("herdr not found"));
	});

	const { pi: mockPi25, handlers } = createMockPi();
	loadExtension(mockPi25);

	const ctx = createMainSessionContext(createDialogUI().ui);
	await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);

	// This must not throw
	emitAttention(mockPi25, { active: true, attention_id: "att-fail", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();

	emitAttention(mockPi25, { active: false, attention_id: "att-fail", task_id: "t1", reason: "enrollment" });
	await _waitForMetadataQueueForTest();

	_setExecFileImplForTest();
	delete process.env.HERDR_PANE_ID;
	console.log("Test 25 passed: herdr failure does not throw");
}

console.log("All pi-herdr-status tests (including Immune-Brain) passed!");
