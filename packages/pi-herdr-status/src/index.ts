import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/**
 * FIFO queue for herdr CLI invocations. Concurrent `execFile` calls are separate
 * processes with no ordering guarantee, so a `clear-token` racing a later
 * `report-metadata` could land last and delete model_info. Serializing keeps
 * updates in the order they were issued.
 */
let metadataQueue: Promise<void> = Promise.resolve();

let execFileImpl: typeof execFile = execFile;

/**
 * Test hook: replace the herdr CLI exec function to observe invocations.
 * Resets the metadata queue so tests start from a clean slate.
 */
export function _setExecFileImplForTest(fn?: typeof execFile): void {
	execFileImpl = fn ?? execFile;
	metadataQueue = Promise.resolve();
}

/** Test hook: waits until all queued Herdr CLI invocations complete. */
export function _waitForMetadataQueueForTest(): Promise<void> {
	return metadataQueue;
}

/** Runs a herdr CLI invocation serially (FIFO). */
function runHerdrSerially(args: string[]): void {
	metadataQueue = metadataQueue.then(
		() =>
			new Promise<void>((resolve) => {
				execFileImpl("herdr", args, () => resolve());
			}),
	);
}

/**
 * ExtensionAPI type extension for getThinkingLevel if missing in base types.
 */
type ExtendedExtensionAPI = ExtensionAPI & {
	getThinkingLevel?: () => string;
};

/**
 * Default source namespace to prevent collisions with other Herdr plugins (e.g., gh-pr).
 */
export const DEFAULT_SOURCE = "pi-model";
export const DEFAULT_TOKEN_NAME = "model_info";

/**
 * Checks if the current context or process is running as a subagent.
 */
export function isSubagent(ctx?: ExtensionContext): boolean {
	if (
		process.env.PI_SUBAGENT === "true" ||
		process.env.PI_SUBAGENT === "1" ||
		process.env.PI_IS_SUBAGENT === "true" ||
		process.env.PI_IS_SUBAGENT === "1" ||
		process.env.SUBAGENT === "true" ||
		process.env.SUBAGENT === "1"
	) {
		return true;
	}

	if (ctx?.sessionManager) {
		const header = ctx.sessionManager.getHeader();
		if (header && "parentSession" in header && Boolean(header.parentSession)) {
			return true;
		}
		// pi-subagents creates subagent sessions in-memory by default, and those
		// have no parentSession in the header. The top-level persisted session
		// always has a session file, so its absence means we are not the main
		// session (or pi runs ephemeral, in which case reporting is skipped).
		// Call as a method: SessionManager#getSessionFile reads `this.sessionFile`,
		// so detaching it would lose the receiver and throw.
		if (
			typeof ctx.sessionManager.getSessionFile !== "function" ||
			!ctx.sessionManager.getSessionFile()
		) {
			return true;
		}
	}

	return false;
}

/**
 * Agent lifecycle state recognized by Herdr CLI.
 */
export type HerdrAgentState = "idle" | "working" | "blocked" | "unknown";

/**
 * Safely reports metadata token to Herdr sidebar agents panel via `herdr` CLI.
 */
export function reportMetadata(
	statusText: string,
	paneId?: string,
	tokenName = DEFAULT_TOKEN_NAME,
	source = DEFAULT_SOURCE,
): void {
	const args = ["pane", "report-metadata"];
	if (paneId) {
		args.push(paneId);
	}
	args.push("--source", source, "--token", `${tokenName}=${statusText}`);

	runHerdrSerially(args);
}

/**
 * Clears model_info token metadata from Herdr sidebar.
 */
export function clearMetadata(
	paneId?: string,
	tokenName = DEFAULT_TOKEN_NAME,
	source = DEFAULT_SOURCE,
): void {
	const args = ["pane", "report-metadata"];
	if (paneId) {
		args.push(paneId);
	}
	args.push("--source", source, "--clear-token", tokenName);

	runHerdrSerially(args);
}

/**
 * Reports agent lifecycle state (e.g. working, blocked/waiting confirmation, idle) to Herdr.
 */
export function reportAgentState(
	state: HerdrAgentState,
	message?: string,
	agentLabel = "pi",
	paneId?: string,
	source = DEFAULT_SOURCE,
): void {
	const args = ["pane", "report-agent", "--source", source, "--agent", agentLabel || "pi", "--state", state];
	if (message) {
		args.push("--message", message);
	}
	if (paneId) {
		args.push(paneId);
	}

	runHerdrSerially(args);
}

/** Extension UI contexts already intercepted by this module instance. */
const patchedUIs = new WeakSet<ExtensionUIContext>();

/** Intercepts dialogs so callers can track when user interaction starts and ends. */
export function patchUI(
	ui: ExtensionUIContext,
	onDialogOpen: (title: string) => void,
	onDialogClose: () => void,
): void {
	if (patchedUIs.has(ui)) return;
	patchedUIs.add(ui);

	const wrapDialog = <TArgs extends unknown[], TResult>(
		dialog: (...args: TArgs) => Promise<TResult>,
	) => async (...args: TArgs): Promise<TResult> => {
		const title = typeof args[0] === "string" ? args[0] : "";
		onDialogOpen(title);
		try {
			return await dialog(...args);
		} finally {
			onDialogClose();
		}
	};

	ui.confirm = wrapDialog(ui.confirm.bind(ui));
	ui.select = wrapDialog(ui.select.bind(ui));
	ui.input = wrapDialog(ui.input.bind(ui));
	ui.editor = wrapDialog(ui.editor.bind(ui));
}

/**
 * Formats a model object and optional thinking level into a concise display label.
 * Provider prefix is stripped when present.
 * Example: "claude-3-7-sonnet (high)" or "claude-3-7-sonnet"
 */
export function formatModelLabel(
	model?: {
		provider?: string;
		id?: string;
		name?: string;
	},
	thinkingLevel?: string,
): string {
	if (!model) return "";
	let baseLabel = "";
	if (model.id) {
		// Strip "provider/" prefix when the id embeds it
		baseLabel = model.provider && model.id.startsWith(`${model.provider}/`)
			? model.id.slice(model.provider.length + 1)
			: model.id;
	} else {
		baseLabel = model.name || "";
	}

	if (!baseLabel) return "";

	if (thinkingLevel && thinkingLevel !== "off") {
		return `${baseLabel} (${thinkingLevel})`;
	}
	return baseLabel;
}

export default function (pi: ExtensionAPI): void {
	const extPi = pi as ExtendedExtensionAPI;
	const socketPath = process.env.HERDR_SOCKET_PATH;
	const paneId = process.env.HERDR_PANE_ID;

	// Exit early if not running inside Herdr or running as a subagent process
	if ((!socketPath && !paneId) || isSubagent()) {
		return;
	}

	let currentModel: { provider?: string; id?: string; name?: string } | undefined;
	let currentThinkingLevel: string | undefined;
	let lifecycleState: HerdrAgentState = "idle";
	let activeDialogs = 0;

	const publishState = (state: HerdrAgentState, message?: string) => {
		reportAgentState(state, message, "pi", paneId);
	};

	const setLifecycleState = (state: HerdrAgentState) => {
		lifecycleState = state;
		if (activeDialogs === 0) publishState(state);
	};

	const onDialogOpen = (title: string) => {
		activeDialogs += 1;
		publishState("blocked", title ? `Waiting for user: ${title}` : "Waiting for user");
	};

	const onDialogClose = () => {
		activeDialogs -= 1;
		if (activeDialogs === 0) publishState(lifecycleState);
	};

	const updateStatus = () => {
		const label = formatModelLabel(currentModel, currentThinkingLevel);
		if (label) {
			reportMetadata(label, paneId);
		}
	};

	const ensurePatched = (ctx?: ExtensionContext) => {
		if (ctx?.hasUI && !isSubagent(ctx)) {
			patchUI(ctx.ui, onDialogOpen, onDialogClose);
		}
	};

	// Listen for session start (notifies default model on pi startup / reload / resume)
	pi.on("session_start", async (_event, ctx) => {
		if (isSubagent(ctx)) return;
		ensurePatched(ctx);
		if (ctx.model) {
			currentModel = ctx.model;
		}
		if (ctx.thinkingLevel !== undefined) {
			currentThinkingLevel = ctx.thinkingLevel;
		} else if (typeof extPi.getThinkingLevel === "function") {
			currentThinkingLevel = extPi.getThinkingLevel();
		}
		updateStatus();
	});

	// Listen for model selection (fires on model switch)
	pi.on("model_select", async (event, ctx) => {
		if (isSubagent(ctx)) return;
		ensurePatched(ctx);
		currentModel = event.model;
		if (ctx?.thinkingLevel !== undefined) {
			currentThinkingLevel = ctx.thinkingLevel;
		} else if (typeof extPi.getThinkingLevel === "function") {
			currentThinkingLevel = extPi.getThinkingLevel();
		}
		updateStatus();
	});

	// Listen for thinking level changes
	pi.on("thinking_level_select", async (event, ctx) => {
		if (isSubagent(ctx)) return;
		ensurePatched(ctx);
		currentThinkingLevel = event.level;
		updateStatus();
	});

	// Listen for agent lifecycle events for state updates
	pi.on("agent_start", async (_event, ctx) => {
		if (isSubagent(ctx)) return;
		ensurePatched(ctx);
		setLifecycleState("working");
	});

	pi.on("tool_execution_start", async (_event, ctx) => {
		if (isSubagent(ctx)) return;
		ensurePatched(ctx);
		setLifecycleState("working");
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (isSubagent(ctx)) return;
		ensurePatched(ctx);
		setLifecycleState("idle");
	});

	// Clean up metadata only on a real quit. Session switches (new/resume/fork/reload)
	// are immediately followed by session_start, whose report would race with a clear
	// here and could leave model_info deleted.
	pi.on("session_shutdown", async (event, ctx) => {
		if (isSubagent(ctx)) return;
		if (event.reason !== "quit") return;
		clearMetadata(paneId);
		publishState("idle");
	});
}
