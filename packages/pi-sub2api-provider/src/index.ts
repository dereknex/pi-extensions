import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * 判断错误是否值得重试（网络/超时类瞬时故障）。
 * 业务错误（4xx）不重试。
 */
function isRetryableError(e: unknown): boolean {
	if (e instanceof DOMException) {
		const name = e.name;
		return (
			name === "TimeoutError" ||
			name === "AbortError" ||
			name === "NetworkError"
		);
	}
	if (e instanceof Error) {
		const msg = e.message.toLowerCase();
		return (
			msg.includes("aborted") ||
			msg.includes("timeout") ||
			msg.includes("econnreset") ||
			msg.includes("econnrefused") ||
			msg.includes("enotfound") ||
			msg.includes("socket hang up") ||
			msg.includes("fetch failed") ||
			msg.includes("undici")
		);
	}
	return false;
}

/**
 * 带重试与指数退避的 fetch 包装。
 *
 * sub2api usage 端点偶尔会超时（undici 在重试耗尽后抛
 * "Aborted after 1 retry attempt"）。这里主动重试，并把
 * 最终错误吃掉返回 null，避免异常逃逸到扩展顶层导致 pi 崩溃。
 */
async function fetchWithRetry(
	url: string,
	init: RequestInit & { timeoutMs?: number } = {},
	retries = 2,
): Promise<Response | null> {
	const { timeoutMs = 5000, ...rest } = init;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fetch(url, {
				...rest,
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (e) {
			// 业务错误（非网络类）不重试，直接返回 null
			if (!isRetryableError(e)) break;
			if (attempt < retries) {
				const delay = Math.min(1000 * 2 ** attempt, 4000);
				await new Promise((r) => setTimeout(r, delay));
			}
		}
	}
	return null;
}

interface ModelCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	tiers?: Array<{
		inputTokensAbove: number;
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	}>;
}

interface ProviderModelConfig {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: Array<"text" | "image">;
	cost?: ModelCost;
	contextWindow?: number;
	maxTokens?: number;
	thinkingLevelMap?: ThinkingLevelMap;
}

/**
 * pi thinking 等级 -> provider 请求中的 reasoning_effort 取值映射。
 * 值为 null 表示该等级在该模型上不可用（pi 会从选择器中隐藏）。
 */
type ThinkingLevelMap = {
	off?: string | null;
	minimal?: string | null;
	low?: string | null;
	medium?: string | null;
	high?: string | null;
	xhigh?: string | null;
	max?: string | null;
};

/**
 * sub2api 默认 thinking 等级映射。
 *
 * 上游 /models 不返回 variants 信息，sub2api 文档示例里 reasoning 模型支持
 * low / medium / high / xhigh 四档（如 gpt-5.5）。
 * - off:    上游无对应档位，设为 null 会阻止发送 reasoning_effort；
 * - minimal: 上游无 minimal，就近映射到 low；
 * - low/medium/high/xhigh: 直接透传给上游。
 */
const DEFAULT_THINKING_LEVEL_MAP: ThinkingLevelMap = {
	off: null,
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

/**
 * sub2api 文档示例中各模型的默认 context / output 上限。
 * 上游 /models 不返回这些字段时回退使用。
 * key 为模型 id（小写）。
 */
const DEFAULT_MODEL_METADATA: Record<
	string,
	{
		contextWindow: number;
		maxTokens: number;
		input?: Array<"text" | "image">;
		reasoning?: boolean;
		thinkingLevelMap?: ThinkingLevelMap;
		cost?: ModelCost;
	}
> = {
	"gpt-5.5": { contextWindow: 272000, maxTokens: 16384 },
	"gpt-5.4": { contextWindow: 400000, maxTokens: 128000 },
	"gpt-5.4-mini": { contextWindow: 200000, maxTokens: 128000 },
	// The upstream /models endpoint only exposes IDs. Default to Pi's 272K
	// short-context tier; users can opt into a larger window in models.json.
	"gpt-5.6-luna": {
		contextWindow: 272000,
		maxTokens: 128000,
		input: ["text", "image"],
		reasoning: true,
		thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
		cost: {
			input: 1,
			output: 6,
			cacheRead: 0.1,
			cacheWrite: 1.25,
			tiers: [
				{
					inputTokensAbove: 272000,
					input: 2,
					output: 9,
					cacheRead: 0.2,
					cacheWrite: 2.5,
				},
			],
		},
	},
	"gpt-5.6-sol": {
		contextWindow: 272000,
		maxTokens: 128000,
		input: ["text", "image"],
		reasoning: true,
		thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
		cost: {
			input: 5,
			output: 30,
			cacheRead: 0.5,
			cacheWrite: 6.25,
			tiers: [
				{
					inputTokensAbove: 272000,
					input: 10,
					output: 45,
					cacheRead: 1,
					cacheWrite: 12.5,
				},
			],
		},
	},
	"gpt-5.6-terra": {
		contextWindow: 272000,
		maxTokens: 128000,
		input: ["text", "image"],
		reasoning: true,
		thinkingLevelMap: { minimal: "low", xhigh: "xhigh", max: "max" },
		cost: {
			input: 2.5,
			output: 15,
			cacheRead: 0.25,
			cacheWrite: 3.125,
			tiers: [
				{
					inputTokensAbove: 272000,
					input: 5,
					output: 22.5,
					cacheRead: 0.5,
					cacheWrite: 6.25,
				},
			],
		},
	},
};

function getDefaultMetadata(id: string) {
	return (
		DEFAULT_MODEL_METADATA[id.toLowerCase()] ?? {
			contextWindow: 128000,
			maxTokens: 16384,
		}
	);
}

function normalizePositiveInteger(value: unknown): number | undefined {
	let parsed: number;
	if (typeof value === "number") {
		parsed = value;
	} else if (typeof value === "string") {
		parsed = Number(value);
	} else {
		parsed = NaN;
	}
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return Math.floor(parsed);
}

function pickRemoteContextWindow(model: any): number | undefined {
	return normalizePositiveInteger(
		model.context_window ??
			model.contextWindow ??
			model.context_length ??
			model.max_context_tokens ??
			model.limit?.context ??
			model.limits?.context,
	);
}

function pickRemoteMaxTokens(model: any): number | undefined {
	return normalizePositiveInteger(
		model.max_tokens ??
			model.maxTokens ??
			model.max_output_tokens ??
			model.max_completion_tokens ??
			model.limit?.output ??
			model.limits?.output,
	);
}

interface ProviderConfig {
	baseUrl: string;
	api?: string;
	models?: ProviderModelConfig[];
}

interface ModelsConfig {
	providers?: Record<string, ProviderConfig>;
}

interface AuthEntry {
	type: string;
	key?: string;
	access?: string;
	refresh?: string;
}

type AuthConfig = Record<string, AuthEntry>;

interface RateLimit {
	limit: number;
	remaining: number;
	used: number;
	window: string;
	reset_at: string;
}

interface DailyUsage {
	date: string;
	requests: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	total_tokens: number;
	cost: number;
	actual_cost: number;
}

interface QuotaInfo {
	baseUrl: string;
	apiKey: string;
	rateLimits: RateLimit[];
	dailyUsage: DailyUsage[];
	todayCost: number;
	totalCost: number;
	status: string;
	mode: string;
	lastUpdated: number;
}

const quotaProviders = new Map<string, QuotaInfo>();

interface LazyProviderState {
	baseUrl: string;
	modelsBase: string;
	apiKey: string;
	providerVal: ProviderConfig;
	usageUrl?: string | null;
	quotaProbePromise?: Promise<boolean>;
	modelsLoadPromise?: Promise<void>;
	modelsLoaded: boolean;
	/** Last successfully fetched models — used as fallback when upstream is temporarily unavailable. */
	cachedModels?: any[];
}

const lazyProviders = new Map<string, LazyProviderState>();

function getModelsBase(baseUrl: string): string {
	return baseUrl.endsWith("/v1")
		? baseUrl
		: `${baseUrl.replace(/\/+$/, "")}/v1`;
}

function buildRegisteredModels(
	providerVal: ProviderConfig,
	fetchedModels?: any[],
): any[] {
	const configuredModels = new Map(
		(providerVal.models || []).map((model) => [model.id.toLowerCase(), model]),
	);
	return (fetchedModels || providerVal.models || []).map((m: any) => {
		const id = m.id;
		const configured = configuredModels.get(id.toLowerCase());
		const normalizedId = id.toLowerCase().replace(/[^a-z0-9]/g, "");
		const defaultMetadata = getDefaultMetadata(id);
		const remoteContextWindow = pickRemoteContextWindow(m);
		const remoteMaxTokens = pickRemoteMaxTokens(m);
		const isReasoning =
			configured?.reasoning ??
			defaultMetadata.reasoning ??
			(normalizedId.includes("o1") ||
				normalizedId.includes("o3") ||
				normalizedId.includes("reasoning") ||
				normalizedId.includes("gpt5") ||
				normalizedId.includes("gpt55"));
		return {
			...configured,
			id,
			name: m.display_name || m.name || configured?.name || id,
			reasoning: isReasoning,
			input: configured?.input ?? defaultMetadata.input ?? ["text" as const],
			cost: configured?.cost ??
				defaultMetadata.cost ?? {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
			contextWindow:
				remoteContextWindow ??
				configured?.contextWindow ??
				defaultMetadata.contextWindow,
			maxTokens:
				remoteMaxTokens ?? configured?.maxTokens ?? defaultMetadata.maxTokens,
			// 仅 reasoning 模型挂 thinkingLevelMap；非 reasoning 模型留空避免显示思考等级选择器。
			thinkingLevelMap: isReasoning
				? (configured?.thinkingLevelMap ??
					defaultMetadata.thinkingLevelMap ??
					DEFAULT_THINKING_LEVEL_MAP)
				: undefined,
		};
	});
}

function registerProviderModels(
	pi: ExtensionAPI,
	providerId: string,
	state: Pick<LazyProviderState, "modelsBase" | "apiKey" | "providerVal">,
	fetchedModels?: any[],
): boolean {
	const models = buildRegisteredModels(state.providerVal, fetchedModels);
	if (!models.length) return false;
	pi.registerProvider(providerId, {
		name: providerId,
		baseUrl: state.modelsBase,
		apiKey: state.apiKey,
		authHeader: true,
		api: state.providerVal.api ?? "openai-completions",
		models,
	});
	return true;
}

function normalizeWindowLabel(window: string): string {
	const value = window.toLowerCase();
	if (value === "5h") return "5h";
	if (value === "1d" || value === "daily" || value === "day") return "daily";
	if (value === "7d" || value === "weekly" || value === "week") return "weekly";
	return window || "default";
}

function formatMoney(value: number, fractionDigits = 2): string {
	return `$${value.toFixed(fractionDigits)}`;
}

function formatUsageLimit(rl: RateLimit): string {
	return `${normalizeWindowLabel(rl.window)} ${formatMoney(rl.used)}/${formatMoney(rl.limit, 0)}`;
}

function shortWindowLabel(window: string): string {
	const label = normalizeWindowLabel(window);
	if (label === "daily") return "d";
	if (label === "weekly") return "w";
	return label;
}

function formatUsagePercent(rl: RateLimit): string {
	const percent = rl.limit > 0 ? Math.round((rl.used / rl.limit) * 100) : 0;
	return `${shortWindowLabel(rl.window)} ${percent}%`;
}

function pickQuotaWindows(rateLimits: RateLimit[]): RateLimit[] {
	const wanted = ["5h", "daily", "weekly"];
	const byLabel = new Map(
		rateLimits.map((rl) => [normalizeWindowLabel(rl.window), rl]),
	);
	const picked = wanted
		.map((label) => byLabel.get(label))
		.filter((rl): rl is RateLimit => Boolean(rl));
	return picked.length ? picked : rateLimits;
}

async function probeUsageEndpoint(
	baseUrl: string,
	apiKey: string,
): Promise<string | null> {
	const cleanBase = baseUrl.replace(/\/+$/, "");
	const root = cleanBase.replace(/\/v1\/?$/, "");

	const candidates = [`${cleanBase}/usage`, `${root}/v1/usage`];

	for (const url of candidates) {
		const res = await fetchWithRetry(url, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
		});
		if (!res || !res.ok) continue;
		try {
			const text = await res.text();
			if (text.includes("<!doctype") || text.includes("<html")) continue;
			const data = JSON.parse(text);
			if (
				data &&
				typeof data === "object" &&
				("rate_limits" in data || "usage" in data || "daily_usage" in data)
			) {
				return url;
			}
		} catch {
			// silent
		}
	}
	return null;
}

async function updateQuota(
	providerId: string,
	usageUrl: string,
	apiKey: string,
): Promise<boolean> {
	try {
		const res = await fetchWithRetry(usageUrl, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
		});
		if (!res || !res.ok) return false;
		const text = await res.text();
		if (text.includes("<!doctype") || text.includes("<html")) return false;
		const data: any = JSON.parse(text);

		const rateLimits: RateLimit[] = Array.isArray(data.rate_limits)
			? data.rate_limits.map((rl: any) => ({
					limit: Number(rl.limit ?? 0),
					remaining: Number(rl.remaining ?? 0),
					used: Number(rl.used ?? 0),
					window: rl.window ?? "",
					reset_at: rl.reset_at ?? "",
				}))
			: [];

		const dailyUsage: DailyUsage[] = Array.isArray(data.daily_usage)
			? data.daily_usage.map((day: any) => ({
					date: String(day.date ?? ""),
					requests: Number(day.requests ?? 0),
					input_tokens: Number(day.input_tokens ?? 0),
					output_tokens: Number(day.output_tokens ?? 0),
					cache_read_tokens: Number(day.cache_read_tokens ?? 0),
					cache_write_tokens: Number(day.cache_write_tokens ?? 0),
					total_tokens: Number(day.total_tokens ?? 0),
					cost: Number(day.cost ?? 0),
					actual_cost: Number(day.actual_cost ?? day.cost ?? 0),
				}))
			: [];
		const latestDay = dailyUsage.at(-1);
		const todayCost = Number(data.usage?.today?.cost ?? latestDay?.cost ?? 0);
		const totalCost = Number(
			data.usage?.total?.cost ??
				dailyUsage.reduce((sum, day) => sum + day.cost, 0),
		);

		quotaProviders.set(providerId, {
			baseUrl: usageUrl,
			apiKey,
			rateLimits,
			dailyUsage,
			todayCost,
			totalCost,
			status: data.status ?? (data.isValid === true ? "valid" : "unknown"),
			mode: data.mode ?? "unknown",
			lastUpdated: Date.now(),
		});
		return true;
	} catch (e) {
		console.error(`[sub2api-quota] Error updating quota for ${providerId}:`, e);
		return false;
	}
}

function formatStatusText(providerId: string, info: QuotaInfo): string {
	const windows = pickQuotaWindows(info.rateLimits).filter(
		(rl) => rl.limit > 0,
	);
	if (windows.length) {
		// Footer space is tight: keep detailed dollar values in /quota, and show
		// compact percentages in the persistent status line to avoid TUI wrapping/flicker.
		return `● ${providerId} ${windows.map(formatUsagePercent).join(" · ")}`;
	}
	return `● ${providerId} d ${formatMoney(info.todayCost)}`;
}

function debugQuotaLog(message: string): void {
	if (process.env.SUB2API_QUOTA_DEBUG === "1") {
		console.error(message);
	}
}

// ---------------------------------------------------------------------------
// Models cache — persist last-successful /models response to disk so that
// a process restart during upstream downtime can still register models.
// ---------------------------------------------------------------------------

/** On-disk shape: `{ [providerId]: any[] }` */
type ModelsCacheFile = Record<string, any[]>;

function getModelsCachePath(): string {
	return path.join(os.homedir(), ".pi", "agent", "models-cache.json");
}

function readModelsCacheFile(): ModelsCacheFile {
	try {
		const raw = fs.readFileSync(getModelsCachePath(), "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as ModelsCacheFile;
		}
	} catch {
		// File missing or corrupt — start fresh.
	}
	return {};
}

function writeModelsCache(providerId: string, models: any[]): void {
	try {
		const cache = readModelsCacheFile();
		cache[providerId] = models;
		const cachePath = getModelsCachePath();
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(cachePath, JSON.stringify(cache, null, "\t"), "utf-8");
	} catch (e) {
		console.error(`[sub2api-quota] Failed to write models cache:`, e);
	}
}

function clearModelsCache(providerId: string): void {
	try {
		const cache = readModelsCacheFile();
		if (!(providerId in cache)) return;
		delete cache[providerId];
		const cachePath = getModelsCachePath();
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(cachePath, JSON.stringify(cache, null, "\t"), "utf-8");
	} catch (e) {
		console.error(`[sub2api-quota] Failed to clear models cache:`, e);
	}
}

function providerHasAuth(auth: AuthConfig, providerId: string): boolean {
	const entry = auth[providerId];
	return Boolean(entry?.key || entry?.access);
}

/** Drop cached /models for providers that no longer have credentials (e.g. after /logout). */
function pruneModelsCacheForMissingAuth(auth: AuthConfig): void {
	const cache = readModelsCacheFile();
	for (const providerId of Object.keys(cache)) {
		if (!providerHasAuth(auth, providerId)) {
			clearModelsCache(providerId);
		}
	}
}

function readModelsCache(providerId: string): any[] | undefined {
	const cache = readModelsCacheFile();
	const models = cache[providerId];
	return Array.isArray(models) && models.length ? models : undefined;
}

async function fetchModels(
	baseUrl: string,
	apiKey: string,
): Promise<any[] | null> {
	const url = `${baseUrl.replace(/\/+$/, "")}/models`;
	const res = await fetchWithRetry(url, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
			Accept: "application/json",
		},
	});
	try {
		if (res?.ok) {
			const payload = await res.json();
			if (payload && Array.isArray(payload.data)) {
				return payload.data;
			}
		}
	} catch {
		// Swallowed — callers handle null as "upstream unavailable".
	}
	return null;
}

export default async function (pi: ExtensionAPI) {
	const homedir = os.homedir();
	const authPath = path.join(homedir, ".pi", "agent", "auth.json");
	const modelsPath = path.join(homedir, ".pi", "agent", "models.json");

	let auth: AuthConfig = {};
	if (fs.existsSync(authPath)) {
		try {
			auth = JSON.parse(fs.readFileSync(authPath, "utf-8"));
		} catch (e) {
			console.error("[sub2api-quota] Error parsing auth.json:", e);
		}
	}
	pruneModelsCacheForMissingAuth(auth);

	function readAuthFile(): AuthConfig {
		if (!fs.existsSync(authPath)) return {};
		try {
			return JSON.parse(fs.readFileSync(authPath, "utf-8")) as AuthConfig;
		} catch (e) {
			console.error("[sub2api-quota] Error parsing auth.json:", e);
			return {};
		}
	}

	function onAuthCredentialsChanged(): void {
		auth = readAuthFile();
		pruneModelsCacheForMissingAuth(auth);
		for (const providerId of [...lazyProviders.keys()]) {
			if (providerHasAuth(auth, providerId)) continue;
			lazyProviders.delete(providerId);
			quotaProviders.delete(providerId);
			try {
				pi.unregisterProvider(providerId);
			} catch (e) {
				console.error(
					`[sub2api-quota] Failed to unregister provider ${providerId}:`,
					e,
				);
			}
		}
	}

	let authWatchTimer: ReturnType<typeof setTimeout> | undefined;
	try {
		if (fs.existsSync(authPath)) {
			fs.watchFile(authPath, { interval: 100, persistent: false }, () => {
				clearTimeout(authWatchTimer);
				authWatchTimer = setTimeout(() => {
					try {
						onAuthCredentialsChanged();
					} catch (e) {
						console.error("[sub2api-quota] Failed to handle auth change:", e);
					}
				}, 50);
			});
		}
	} catch (e) {
		console.error("[sub2api-quota] Failed to watch auth.json:", e);
	}

	let modelsConfig: ModelsConfig = {};
	if (fs.existsSync(modelsPath)) {
		try {
			modelsConfig = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
		} catch (e) {
			console.error("[sub2api-quota] Error parsing models.json:", e);
		}
	}

	async function loadRemoteModels(providerId: string): Promise<void> {
		const state = lazyProviders.get(providerId);
		if (!state || state.modelsLoaded) return;
		if (!state.modelsLoadPromise) {
			state.modelsLoadPromise = fetchModels(state.modelsBase, state.apiKey)
				.then((fetchedModels) => {
					if (fetchedModels?.length) {
						state.cachedModels = fetchedModels;
						writeModelsCache(providerId, fetchedModels);
						registerProviderModels(pi, providerId, state, fetchedModels);
						state.modelsLoaded = true;
					} else if (state.cachedModels?.length) {
						// Upstream temporarily unavailable — fall back to cached models.
						console.error(
							`[sub2api-quota] Upstream /models unavailable for ${providerId}, using cached models`,
						);
						registerProviderModels(pi, providerId, state, state.cachedModels);
						state.modelsLoaded = true;
					}
				})
				.catch((e) => {
					console.error(
						`[sub2api-quota] Remote model load failed for ${providerId}:`,
						e,
					);
					if (state.cachedModels?.length) {
						console.error(
							`[sub2api-quota] Using cached models for ${providerId} after fetch error`,
						);
						registerProviderModels(pi, providerId, state, state.cachedModels);
						state.modelsLoaded = true;
					}
				})
				.finally(() => {
					state.modelsLoadPromise = undefined;
				});
		}
		await state.modelsLoadPromise;
	}

	if (modelsConfig.providers) {
		const eagerModelLoads: Promise<void>[] = [];

		for (const [providerId, providerVal] of Object.entries(
			modelsConfig.providers,
		)) {
			try {
				const baseUrl = providerVal.baseUrl;
				if (!baseUrl) continue;

				const authEntry = auth[providerId];
				const apiKey = authEntry?.key || authEntry?.access;
				if (!apiKey) continue;

				const state: LazyProviderState = {
					baseUrl,
					modelsBase: getModelsBase(baseUrl),
					apiKey,
					providerVal,
					modelsLoaded: false,
					cachedModels: readModelsCache(providerId),
				};
				lazyProviders.set(providerId, state);

				// 启动期优先用本地 models.json 注册；无本地模型时同步拉取 /models，
				// 否则 pi 在扩展加载完成前无法匹配 provider/model 模式（如 s2a/gpt-5.5）。
				const registered = registerProviderModels(pi, providerId, state);
				if (registered) {
					state.modelsLoaded = true;
				} else {
					eagerModelLoads.push(loadRemoteModels(providerId));
				}
			} catch (e) {
				console.error(
					`[sub2api-quota] Failed to initialize provider ${providerId}:`,
					e,
				);
			}
		}

		if (eagerModelLoads.length) {
			await Promise.all(eagerModelLoads);
		}
	}

	async function ensureQuotaProvider(providerId: string): Promise<boolean> {
		if (quotaProviders.has(providerId)) return true;
		const state = lazyProviders.get(providerId);
		if (!state) return false;
		if (!state.quotaProbePromise) {
			state.quotaProbePromise = (async () => {
				if (state.usageUrl === undefined) {
					state.usageUrl = await probeUsageEndpoint(
						state.baseUrl,
						state.apiKey,
					);
					if (state.usageUrl) {
						debugQuotaLog(
							`[sub2api-quota] Detected usage endpoint for provider: ${providerId} at ${state.usageUrl}`,
						);
					} else {
						debugQuotaLog(
							`[sub2api-quota] No usage endpoint found for provider: ${providerId} — quota display disabled`,
						);
					}
				}
				if (!state.usageUrl) return false;
				return updateQuota(providerId, state.usageUrl, state.apiKey);
			})()
				.catch((e) => {
					console.error(
						`[sub2api-quota] Lazy quota initialization failed for ${providerId}:`,
						e,
					);
					return false;
				})
				.finally(() => {
					state.quotaProbePromise = undefined;
				});
		}
		return state.quotaProbePromise;
	}

	function refreshProviderInBackground(
		providerId: string,
		onQuota?: () => void,
	): void {
		void loadRemoteModels(providerId);
		const info = quotaProviders.get(providerId);
		const refresh = info
			? updateQuota(providerId, info.baseUrl, info.apiKey)
			: ensureQuotaProvider(providerId);
		void refresh.then((ok) => {
			if (ok) onQuota?.();
		});
	}

	pi.on("session_start", (_event, ctx) => {
		const model = ctx.model;
		if (!model || !lazyProviders.has(model.provider)) return;

		const info = quotaProviders.get(model.provider);
		if (info) {
			ctx.ui.setStatus(
				"sub2api-quota",
				ctx.ui.theme.fg("accent", formatStatusText(model.provider, info)),
			);
		}
		refreshProviderInBackground(model.provider, () => {
			if (ctx.model?.provider !== model.provider) return;
			const fresh = quotaProviders.get(model.provider);
			if (!fresh) return;
			ctx.ui.setStatus(
				"sub2api-quota",
				ctx.ui.theme.fg("accent", formatStatusText(model.provider, fresh)),
			);
		});
	});

	pi.on("model_select", (event, ctx) => {
		const { model } = event;
		const providerId = model.provider;

		ctx.ui.setStatus("sub2api-quota", undefined);
		if (!lazyProviders.has(providerId)) return;

		refreshProviderInBackground(providerId, () => {
			if (ctx.model?.provider !== providerId) return;
			const fresh = quotaProviders.get(providerId);
			if (!fresh) return;
			ctx.ui.setStatus(
				"sub2api-quota",
				ctx.ui.theme.fg("accent", formatStatusText(providerId, fresh)),
			);
		});
	});

	pi.on("turn_end", (_event, ctx) => {
		const model = ctx.model;
		if (!model || !lazyProviders.has(model.provider)) return;
		void ensureQuotaProvider(model.provider)
			.then((ok) => {
				if (!ok) return;
				const info = quotaProviders.get(model.provider);
				if (!info) return;
				return updateQuota(model.provider, info.baseUrl, info.apiKey).then(
					() => {
						if (ctx.model?.provider !== model.provider) return;
						const fresh = quotaProviders.get(model.provider);
						if (!fresh) return;
						ctx.ui.setStatus(
							"sub2api-quota",
							ctx.ui.theme.fg(
								"accent",
								formatStatusText(model.provider, fresh),
							),
						);
					},
				);
			})
			.catch((e) =>
				console.error(
					`[sub2api-quota] background update failed for ${model.provider}:`,
					e,
				),
			);
	});

	pi.registerCommand("quota", {
		description: "Display detailed billing quota info for the active provider",
		handler: async (_args, ctx) => {
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No active model selected", "error");
				return;
			}
			const providerId = model.provider;
			if (!lazyProviders.has(providerId)) {
				ctx.ui.notify(
					`Provider '${providerId}' is not managed by sub2api quota.`,
					"warning",
				);
				return;
			}

			ctx.ui.notify("Fetching latest billing info...", "info");
			const available = await ensureQuotaProvider(providerId);
			if (!available || !quotaProviders.has(providerId)) {
				ctx.ui.notify(
					`Provider '${providerId}' has no usage endpoint available.`,
					"warning",
				);
				return;
			}
			const info = quotaProviders.get(providerId);
			if (!info) {
				ctx.ui.notify(
					`Provider '${providerId}' has no usage endpoint available.`,
					"warning",
				);
				return;
			}
			const success = await updateQuota(providerId, info.baseUrl, info.apiKey);
			if (!success) {
				ctx.ui.notify("Failed to fetch billing info.", "error");
				return;
			}

			const fresh = quotaProviders.get(providerId);
			if (!fresh) return;
			const latestDay = fresh.dailyUsage.at(-1);
			const lines = [
				`Provider:     ${providerId}`,
				`Status:       ${fresh.status}`,
				`Mode:         ${fresh.mode}`,
				`Today Cost:   $${fresh.todayCost.toFixed(4)}`,
				`Total Cost:   $${fresh.totalCost.toFixed(4)}`,
				latestDay
					? `Today Tokens: ${latestDay.total_tokens.toLocaleString()}`
					: undefined,
				latestDay
					? `Requests:     ${latestDay.requests.toLocaleString()}`
					: undefined,
				"",
				"Rate Limits:",
			].filter((line): line is string => typeof line === "string");

			if (fresh.rateLimits.length === 0) {
				lines.push("  none reported by provider");
			}

			for (const rl of fresh.rateLimits) {
				const resetDate = rl.reset_at
					? new Date(rl.reset_at).toLocaleString()
					: "unknown";
				lines.push(
					`  [${normalizeWindowLabel(rl.window)}]  ${formatMoney(rl.used)}/${formatMoney(rl.limit, 0)}  (remaining: ${formatMoney(rl.remaining)}, resets: ${resetDate})`,
				);
			}

			const windows = pickQuotaWindows(fresh.rateLimits).filter(
				(rl) => rl.limit > 0,
			);
			if (windows.length) {
				ctx.ui.notify(windows.map(formatUsageLimit).join(" • "), "info");
			} else {
				ctx.ui.notify(`Today: ${formatMoney(fresh.todayCost)}`, "info");
			}
			console.error(lines.join("\n"));
		},
	});
}
