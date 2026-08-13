import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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
	}

	return false;
}

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

	execFile("herdr", args, () => {
		// Silently handle execution results (e.g. non-zero exit when not in herdr)
	});
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

	execFile("herdr", args, () => {
		// Silently handle execution results
	});
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

	const updateStatus = () => {
		const label = formatModelLabel(currentModel, currentThinkingLevel);
		if (label) {
			reportMetadata(label, paneId);
		}
	};

	// Listen for session start (notifies default model on pi startup / reload / resume)
	pi.on("session_start", async (_event, ctx) => {
		if (isSubagent(ctx)) return;
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
		currentThinkingLevel = event.level;
		updateStatus();
	});

	// Clean up metadata when session shuts down
	pi.on("session_shutdown", async (_event, ctx) => {
		if (isSubagent(ctx)) return;
		clearMetadata(paneId);
	});
}
