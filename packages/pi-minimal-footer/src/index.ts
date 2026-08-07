/**
 * Minimal Footer — shows only what matters.
 *
 * Migrated from the global extension `~/.pi/agent/extensions/minimal-footer.ts`
 * into the pi-extensions monorepo as the `pi-minimal-footer` package.
 *
 * Left:  ~/path/to/project git:branch± • model (thinking) • goal
 * Right: [####.........] 40% (128K)
 {
      "minimal-footer": {
        "showCwd": true,
        "showGit": true,
        "showModel": true,
        "showThinking": true,
        "showTps": true,
        "showTtft": true,
        "showCacheStats": true,
        "showQuota": true,
        "showGoal": true,
        "showContextBar": true,
        "showContextPercent": true,
        "showContextWindowSize": true,
        "extensionStatuses": true,
        "hiddenExtensionStatuses": ["debug-info"]
      }
    }
 */

import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Upstream ExtensionAPI types do not declare `cwd` yet (it exists only as the
// closure default working directory for `pi.exec()`). Declare it locally so
// `pi.cwd` usages type-check; at runtime it is undefined and exec falls back
// to the extension's own cwd, which is the behavior this footer relies on.
type FooterExtensionAPI = ExtensionAPI & { cwd?: string };

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type RgbColor = { r: number; g: number; b: number };

type ModelWithThinking = {
	id?: string;
	provider?: string;
	reasoning?: boolean;
	contextWindow?: number;
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
};

const THINKING_LEVELS: ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

const EFFORT_COLOR_STOPS: RgbColor[] = [
	{ r: 142, g: 142, b: 147 }, // gray
	{ r: 52, g: 199, b: 89 }, // green
	{ r: 255, g: 214, b: 10 }, // yellow
	{ r: 255, g: 159, b: 10 }, // orange
	{ r: 255, g: 69, b: 58 }, // red
];

const CONTEXT_COLOR_STOPS: RgbColor[] = [
	{ r: 52, g: 199, b: 89 }, // green
	{ r: 255, g: 214, b: 10 }, // yellow
	{ r: 255, g: 159, b: 10 }, // orange
	{ r: 255, g: 69, b: 58 }, // red
];

const PROVIDER_COLORS: Record<string, RgbColor> = {
	anthropic: { r: 191, g: 90, b: 242 },
	openai: { r: 52, g: 199, b: 89 },
	google: { r: 66, g: 133, b: 244 },
	gemini: { r: 66, g: 133, b: 244 },
	github: { r: 175, g: 82, b: 222 },
	copilot: { r: 175, g: 82, b: 222 },
	openrouter: { r: 255, g: 159, b: 10 },
	ollama: { r: 142, g: 142, b: 147 },
	local: { r: 142, g: 142, b: 147 },
};

interface FooterSettings {
	showCwd?: boolean;
	showGit?: boolean;
	showModel?: boolean;
	showThinking?: boolean;
	showTps?: boolean;
	showTtft?: boolean;
	showCacheStats?: boolean;
	showQuota?: boolean;
	showGoal?: boolean;
	showContextBar?: boolean;
	showContextPercent?: boolean;
	showContextWindowSize?: boolean;
	/**
	 * Controls generic extension statuses from ctx.ui.setStatus().
	 * - true / omitted: show all unclaimed extension statuses
	 * - false: hide all unclaimed extension statuses
	 * - string[]: show only matching status keys
	 */
	extensionStatuses?: boolean | string[];
	/** Hide matching status keys even when extensionStatuses is true. */
	hiddenExtensionStatuses?: string[];
}

function getFooterSettings(cwd: string): FooterSettings {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const globalPath = join(home, CONFIG_DIR_NAME, "agent", "settings.json");
	const projectPath = join(cwd, CONFIG_DIR_NAME, "settings.json");
	let settings: FooterSettings = {
		showCwd: true,
		showGit: true,
		showModel: true,
		showThinking: true,
		showTps: true,
		showTtft: true,
		showCacheStats: true,
		showQuota: true,
		showGoal: true,
		showContextBar: true,
		showContextPercent: true,
		showContextWindowSize: true,
		extensionStatuses: true,
	};

	try {
		if (existsSync(globalPath)) {
			const globalData = JSON.parse(readFileSync(globalPath, "utf8"));
			if (globalData["minimal-footer"]) {
				settings = { ...settings, ...globalData["minimal-footer"] };
			}
		}
	} catch {}

	try {
		if (existsSync(projectPath)) {
			const projectData = JSON.parse(readFileSync(projectPath, "utf8"));
			if (projectData["minimal-footer"]) {
				settings = { ...settings, ...projectData["minimal-footer"] };
			}
		}
	} catch {}

	return settings;
}

export default function (pi: FooterExtensionAPI) {
	let tuiRef: { requestRender(): void } | null = null;
	let thinkingLevel: string = "off";
	let currentModel: ModelWithThinking | undefined;
	let modelId: string | undefined;
	let contextWindow: number | undefined;
	let isDirty = false;
	let sessionAbortController: AbortController | null = null;

	// Real-time performance & cache metrics
	let startTime: number | null = null;
	let firstTokenTime: number | null = null;
	let lastTtft: number | null = null;
	let lastTps: number | null = null;
	let lastCacheHitRate: number | null = null;
	let lastCacheReadTokens: number | null = null;

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") {
			startTime = Date.now();
			firstTokenTime = null;
		}
	});

	pi.on("message_update", (event) => {
		if (event.message.role === "assistant" && startTime && !firstTokenTime) {
			firstTokenTime = Date.now();
			lastTtft = (firstTokenTime - startTime) / 1000;
			tuiRef?.requestRender();
		}
	});

	// Keep values fresh so renders pick up changes immediately
	pi.on("model_select", async (event, _ctx) => {
		currentModel = event.model as ModelWithThinking;
		modelId = event.model.id;
		contextWindow = event.model.contextWindow;
		tuiRef?.requestRender();
	});

	pi.on("thinking_level_select", async (event, _ctx) => {
		thinkingLevel = event.level;
		tuiRef?.requestRender();
	});

	async function refreshDirty() {
		const controller = sessionAbortController;
		if (!controller || controller.signal.aborted) return;

		const result = await pi
			.exec("git", ["status", "--porcelain", "--untracked-files=no"], {
				cwd: pi.cwd,
				signal: controller.signal,
			})
			.catch(() => undefined);

		if (controller !== sessionAbortController || controller.signal.aborted)
			return;

		const dirty = result?.code === 0 && result.stdout.trim().length > 0;
		if (dirty !== isDirty) {
			isDirty = dirty;
			tuiRef?.requestRender();
		}
	}

	pi.on("turn_end", (event) => {
		void refreshDirty();
		if (event.message?.role === "assistant" && event.message.usage) {
			const usage = event.message.usage;
			const endTime = Date.now();
			const durationSec = startTime ? (endTime - startTime) / 1000 : 0;

			if (durationSec > 0 && usage.output) {
				lastTps = usage.output / durationSec;
			}
			const cacheRead =
				(usage as any).cacheRead ?? (usage as any).cacheReadTokens ?? 0;
			const input = usage.input ?? 0;
			const totalInput = input + cacheRead;

			if (totalInput > 0) {
				lastCacheHitRate = Math.round((cacheRead / totalInput) * 100);
				lastCacheReadTokens = cacheRead;
			}
			tuiRef?.requestRender();
		}
	});

	function formatContextWindow(n: number | undefined): string {
		if (!n) return "";
		if (n >= 1_000_000)
			return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
		return `${n}`;
	}

	function middleTruncatePath(path: string, maxWidth = 42): string {
		if (visibleWidth(path) <= maxWidth) return path;

		const parts = path.split("/").filter(Boolean);
		const isHomePath = path.startsWith("~/");
		const isAbsolutePath = path.startsWith("/");
		const first = parts[0] === "~" ? parts[1] : parts[0];
		const last = parts[parts.length - 1];

		if (!first || !last) return truncateToWidth(path, maxWidth);

		const prefix = isHomePath
			? `~/${first}`
			: isAbsolutePath
				? `/${first}`
				: first;
		const shortened = `${prefix}/.../${last}`;

		return visibleWidth(shortened) <= maxWidth
			? shortened
			: truncateToWidth(shortened, maxWidth);
	}

	function getCurrentDirectory(contextCwd: string): string {
		const home = process.env.HOME || process.env.USERPROFILE;
		const candidates = [
			pi.cwd,
			contextCwd,
			process.env.PWD,
			process.cwd(),
		].filter(
			(candidate): candidate is string =>
				typeof candidate === "string" && candidate.length > 0,
		);

		return (
			candidates.find((candidate) => !home || candidate !== home) ??
			candidates[0] ??
			contextCwd
		);
	}

	function formatDirectory(path: string): string {
		const home = process.env.HOME || process.env.USERPROFILE;
		let cwd = path;
		if (home && cwd.startsWith(home)) {
			cwd = "~" + cwd.slice(home.length);
		}
		return middleTruncatePath(cwd);
	}

	type ExtensionStatusEntry = { key: string; value: string };

	function getExtensionStatusEntries(
		statuses: unknown,
	): ExtensionStatusEntry[] {
		if (statuses instanceof Map) {
			return Array.from(statuses.entries())
				.filter(
					(entry): entry is [string, string] =>
						typeof entry[0] === "string" && typeof entry[1] === "string",
				)
				.map(([key, value]) => ({ key, value }));
		}
		if (Array.isArray(statuses)) {
			return statuses
				.filter((status): status is string => typeof status === "string")
				.map((value, index) => ({ key: String(index), value }));
		}
		return [];
	}

	function normalizeStatusToken(value: string | undefined): string {
		return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
	}

	function statusKeyMatches(
		key: string,
		candidates: string[] | undefined,
	): boolean {
		if (!candidates || candidates.length === 0) return false;
		const normalizedKey = normalizeStatusToken(key);
		return candidates.some((candidate) => {
			const normalizedCandidate = normalizeStatusToken(candidate);
			return (
				normalizedCandidate.length > 0 &&
				(normalizedKey === normalizedCandidate ||
					normalizedKey.startsWith(normalizedCandidate) ||
					normalizedCandidate.startsWith(normalizedKey))
			);
		});
	}

	function shouldShowExtensionStatus(
		key: string,
		settings: FooterSettings,
	): boolean {
		if (statusKeyMatches(key, settings.hiddenExtensionStatuses)) return false;
		const selection = settings.extensionStatuses;
		if (selection === false) return false;
		if (Array.isArray(selection)) return statusKeyMatches(key, selection);
		return true;
	}

	function isQuotaStatusKey(key: string): boolean {
		return /(^|[-_:./])(quota|usage|billing|limit)([-_:./]|$)/i.test(key);
	}

	function isProviderQuotaStatusKey(
		key: string,
		provider: string | undefined,
	): boolean {
		if (!provider || !isQuotaStatusKey(key)) return false;
		const normalizedKey = normalizeStatusToken(key);
		const normalizedProvider = normalizeStatusToken(provider);
		return (
			normalizedProvider.length > 0 &&
			normalizedKey.includes(normalizedProvider)
		);
	}

	function pickQuotaStatus(
		statuses: ExtensionStatusEntry[],
		provider: string | undefined,
	): string | undefined {
		// Preferred convention for multiple providers:
		//   quota:<provider>, quota/<provider>, quota.<provider>, <provider>:quota, <provider>-quota, etc.
		// This lets several quota extensions coexist while minimal-footer shows the active provider only.
		const providerSpecific = statuses.find(({ key }) =>
			isProviderQuotaStatusKey(key, provider),
		)?.value;
		if (providerSpecific) return providerSpecific;

		// Canonical fixed key for an external coordinator that dynamically publishes only the active quota.
		const activeQuota = statuses.find(({ key }) => key === "quota")?.value;
		if (activeQuota) return activeQuota;

		// Backward compatibility for the current sub2api quota extension.
		const legacySub2apiQuota = statuses.find(
			({ key }) => key === "sub2api-quota",
		)?.value;
		if (legacySub2apiQuota) return legacySub2apiQuota;

		// Last-resort key/value fallback for older or third-party extensions.
		return (
			statuses.find(({ key }) => isQuotaStatusKey(key))?.value ??
			statuses.find(({ value }) => /用量|额度|余额/i.test(value))?.value
		);
	}

	function isThinkingLevel(value: string): value is ThinkingLevel {
		return THINKING_LEVELS.includes(value as ThinkingLevel);
	}

	function getSupportedThinkingLevels(
		model: ModelWithThinking | undefined,
	): ThinkingLevel[] {
		if (!model || model.reasoning === false) return ["off"];

		const map = model.thinkingLevelMap;
		if (!map) {
			return model.reasoning === true
				? ["low", "medium", "high", "xhigh"]
				: ["off"];
		}

		const supported = THINKING_LEVELS.filter((level) => map[level] !== null);
		return supported.length > 0 ? supported : ["off"];
	}

	function interpolateColor(
		position: number,
		stops: RgbColor[] = EFFORT_COLOR_STOPS,
	): RgbColor {
		const safeStops = stops.length > 0 ? stops : EFFORT_COLOR_STOPS;
		const clamped = Math.max(0, Math.min(1, position));
		const scaled = clamped * (safeStops.length - 1);
		const leftIndex = Math.floor(scaled);
		const rightIndex = Math.min(safeStops.length - 1, leftIndex + 1);
		const mix = scaled - leftIndex;
		const left = safeStops[leftIndex];
		const right = safeStops[rightIndex];

		return {
			r: Math.round(left.r + (right.r - left.r) * mix),
			g: Math.round(left.g + (right.g - left.g) * mix),
			b: Math.round(left.b + (right.b - left.b) * mix),
		};
	}

	function colorRgb(text: string, { r, g, b }: RgbColor): string {
		return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
	}

	function colorThinkingLabel(
		level: string,
		label: string,
		model: ModelWithThinking | undefined,
	): string {
		if (!isThinkingLevel(level)) return label;

		const supported = getSupportedThinkingLevels(model);
		const supportedIndex = supported.indexOf(level);
		const fallbackIndex = THINKING_LEVELS.indexOf(level);
		const position =
			supportedIndex >= 0
				? supported.length <= 1
					? 0
					: supportedIndex / (supported.length - 1)
				: fallbackIndex / (THINKING_LEVELS.length - 1);

		return colorRgb(label, interpolateColor(position));
	}

	function getProviderColor(
		provider: string | undefined,
	): RgbColor | undefined {
		if (!provider) return undefined;
		const normalized = provider.toLowerCase();
		return PROVIDER_COLORS[normalized];
	}

	pi.on("session_start", async (_event, ctx) => {
		sessionAbortController?.abort();
		sessionAbortController = new AbortController();
		currentModel = ctx.model as ModelWithThinking | undefined;
		modelId = ctx.model?.id;
		contextWindow = ctx.model?.contextWindow;
		thinkingLevel = pi.getThinkingLevel();
		void refreshDirty();

		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef = tui;
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose() {
					unsub();
					tuiRef = null;
				},
				invalidate() {
					void refreshDirty();
				},
				render(width: number): string[] {
					const footerSettings = getFooterSettings(ctx.cwd);

					// ── Current directory (with ~ for home) ──
					const cwd = formatDirectory(getCurrentDirectory(ctx.cwd));

					// ── Git branch + dirty marker ──
					const branch = footerData.getGitBranch();
					const dirtyMarker = branch && isDirty ? "±" : "";
					const branchStr = branch ? `git:${branch}${dirtyMarker}` : "";
					const branchColor: "warning" | "success" = isDirty
						? "warning"
						: "success";

					// ── Model + dynamically colored thinking effort ──
					const activeModel =
						currentModel || (ctx.model as ModelWithThinking | undefined);
					const model = modelId || activeModel?.id || ctx.model?.id || "none";
					const provider = activeModel?.provider;
					const supportedThinkingLevels =
						getSupportedThinkingLevels(activeModel);
					const showThinkingLabel =
						(thinkingLevel !== "off" || supportedThinkingLevels.length > 1) &&
						footerSettings.showThinking !== false;
					const thinkLabel = showThinkingLabel
						? colorThinkingLabel(
								thinkingLevel,
								` (${thinkingLevel})`,
								activeModel,
							)
						: "";
					const providerColor = getProviderColor(provider);
					const modelStr =
						provider && !model.includes("/")
							? (providerColor
									? colorRgb(provider, providerColor)
									: theme.fg("muted", provider)) +
								theme.fg("dim", "/") +
								theme.fg("accent", model)
							: theme.fg("accent", model);

					// ── Real-time Performance & Cache Stats ──
					const tpsStr =
						footerSettings.showTps !== false && lastTps !== null
							? theme.fg("muted", `${lastTps.toFixed(1)} t/s`)
							: "";
					const ttftStr =
						footerSettings.showTtft !== false && lastTtft !== null
							? theme.fg("muted", `${lastTtft.toFixed(2)}s ttft`)
							: "";
					const cacheStr =
						footerSettings.showCacheStats !== false && lastCacheHitRate !== null
							? theme.fg("muted", `cache:${lastCacheHitRate}%`)
							: "";

					// ── Optional extension indicators ──
					const statuses = getExtensionStatusEntries(
						footerData.getExtensionStatuses?.(),
					);
					const goalEntry = statuses.find(
						({ key, value }) => /goal/i.test(key) || /goal/i.test(value),
					);
					const goalStatus = goalEntry?.value;
					const quotaStatus = pickQuotaStatus(statuses, provider);

					const otherStrs = statuses
						.filter((entry) => {
							if (entry === goalEntry) return false;
							if (entry.value === quotaStatus) return false;
							if (
								isQuotaStatusKey(entry.key) ||
								entry.key === "quota" ||
								entry.key === "sub2api-quota"
							)
								return false;
							return shouldShowExtensionStatus(entry.key, footerSettings);
						})
						.map((entry) => theme.fg("muted", entry.value));

					const goalStr =
						footerSettings.showGoal !== false && goalStatus
							? theme.fg("warning", goalStatus)
							: "";
					const quotaStr =
						footerSettings.showQuota !== false && quotaStatus
							? theme.fg("success", quotaStatus)
							: "";

					const lastSlash = cwd.lastIndexOf("/");
					const pathPrefix = lastSlash >= 0 ? cwd.slice(0, lastSlash + 1) : "";
					const projectName = lastSlash >= 0 ? cwd.slice(lastSlash + 1) : cwd;
					const pathStr = projectName
						? theme.fg("dim", pathPrefix) +
							theme.fg("accent", theme.bold(projectName))
						: theme.fg("dim", cwd);

					const leftParts = [
						footerSettings.showCwd !== false ? pathStr : "",
						footerSettings.showGit !== false && branchStr
							? theme.fg(branchColor, branchStr)
							: "",
						footerSettings.showModel !== false ? modelStr + thinkLabel : "",
						tpsStr,
						ttftStr,
						cacheStr,
						quotaStr,
						goalStr,
						...otherStrs,
					].filter(Boolean);
					const left = leftParts.join(theme.fg("dim", " • "));

					// ── Context bar ──
					const usage = ctx.getContextUsage();
					const pct = usage?.percent ?? 0;
					const pctStr =
						footerSettings.showContextPercent !== false &&
						usage?.percent !== null
							? `${Math.round(pct)}%`
							: "";

					const ctxRgb = interpolateColor(pct / 100, CONTEXT_COLOR_STOPS);

					const BLOCKS = 10;
					const filled = Math.max(
						0,
						Math.min(BLOCKS, Math.round((pct / 100) * BLOCKS)),
					);
					const bar =
						colorRgb("#".repeat(filled), ctxRgb) +
						theme.fg("dim", ".".repeat(BLOCKS - filled));
					const ctxWinStr =
						footerSettings.showContextWindowSize !== false && contextWindow
							? `(${formatContextWindow(contextWindow)})`
							: "";

					const rightParts: string[] = [];
					if (footerSettings.showContextBar !== false) {
						rightParts.push(colorRgb("[", ctxRgb) + bar + colorRgb("]", ctxRgb));
					}
					if (pctStr) {
						rightParts.push(colorRgb(pctStr, ctxRgb));
					}
					if (ctxWinStr) {
						rightParts.push(
							pct >= 75
								? colorRgb(ctxWinStr, ctxRgb)
								: theme.fg("dim", ctxWinStr),
						);
					}
					const right = rightParts.join(" ");

					// ── Layout: single row if it fits, else split into two ──
					const leftW = visibleWidth(left);
					const rightW = visibleWidth(right);

					if (leftW + rightW <= width) {
						// Single row: left … right
						const pad = " ".repeat(width - leftW - rightW);
						return [truncateToWidth(left + pad + right, width)];
					}

					// Two rows: left on top, context bar left-aligned below
					return [truncateToWidth(left, width), truncateToWidth(right, width)];
				},
			};
		});
	});

	pi.on("session_shutdown", () => {
		sessionAbortController?.abort();
		sessionAbortController = null;
		tuiRef = null;
	});
}
