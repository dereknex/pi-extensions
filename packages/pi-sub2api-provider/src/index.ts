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
 * 对齐 CodexBar 的 15s 超时。
 */
async function fetchWithRetry(
	url: string,
	init: RequestInit & { timeoutMs?: number } = {},
	retries = 2,
): Promise<Response | null> {
	const { timeoutMs = 15000, ...rest } = init;
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

// ---------------------------------------------------------------------------
// sub2api usage 端点 — 对齐 CodexBar canonical 逻辑
// ---------------------------------------------------------------------------

function getTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/**
 * CodexBar canonical: base 去尾斜杠 → 若非 /v1 或 /v1/usage 则补 /v1 → 若非 /usage 则补 /usage → 追加 ?days=30&timezone
 * 参考: Sources/CodexBarCore/Resources/Plugins/sub2api.js
 */
function buildCanonicalUsageUrl(baseUrl: string): string {
	let base = baseUrl.replace(/\/+$/, "");
	if (!/\/v1(?:\/usage)?$/.test(base)) base += "/v1";
	if (!base.endsWith("/usage")) base += "/usage";
	const tz = getTimeZone();
	return `${base}?days=30&timezone=${encodeURIComponent(tz)}`;
}

function buildUsageCandidates(baseUrl: string): string[] {
	const canonical = buildCanonicalUsageUrl(baseUrl);
	// Fallback for legacy deployments that expose /usage without /v1 prefix or with different base
	const cleanBase = baseUrl.replace(/\/+$/, "");
	const root = cleanBase.replace(/\/v1\/?$/, "");
	const legacy = [`${cleanBase}/usage`, `${root}/v1/usage`].map(
		(u) => `${u}?days=30&timezone=${encodeURIComponent(getTimeZone())}`,
	);
	// 去重，canonical 优先
	const seen = new Set<string>();
	const out: string[] = [];
	for (const u of [canonical, ...legacy]) {
		if (!seen.has(u)) {
			seen.add(u);
			out.push(u);
		}
	}
	return out;
}

function safeFiniteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

function safeString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
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

interface Quota {
	limit: number;
	used: number;
	remaining: number;
	unit: string;
}

interface Subscription {
	dailyUsage: number;
	weeklyUsage: number;
	monthlyUsage: number;
	dailyLimit: number | null;
	weeklyLimit: number | null;
	monthlyLimit: number | null;
	expiresAt: string | null;
}

interface UsageTotals {
	requests: number;
	tokens: number;
	cost: number;
}

interface QuotaInfo {
	baseUrl: string; // the canonical usage URL that succeeded
	apiKey: string;
	rateLimits: RateLimit[];
	dailyUsage: DailyUsage[];
	todayCost: number;
	totalCost: number;
	status: string;
	mode: string;
	lastUpdated: number;
	// --- CodexBar-aligned extensions ---
	quota: Quota | null;
	subscription: Subscription | null;
	balance: number | null;
	unit: string;
	planName: string | null;
	remaining: number | null;
	expiresAt: string | null;
	todayUsage: UsageTotals | null;
	totalUsage: UsageTotals | null;
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

function formatMoneyWithUnit(value: number, unit: string, fractionDigits = 2): string {
	if (!unit || unit.toUpperCase() === "USD") return formatMoney(value, fractionDigits);
	return `${value.toFixed(fractionDigits)} ${unit}`;
}

function formatAmount(used: number, limit: number, unit: string = "USD"): string {
	return `${formatMoneyWithUnit(used, unit)} / ${formatMoneyWithUnit(limit, unit, 0)}`;
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

function subscriptionPercent(used: number, limit: number | null): number | null {
	if (limit === null || limit <= 0) return null;
	return Math.min(100, Math.max(0, (used / limit) * 100));
}

// ---------------------------------------------------------------------------
// Usage fetch — aligned with CodexBar sub2api.js
// ---------------------------------------------------------------------------

async function probeUsageEndpoint(
	baseUrl: string,
	apiKey: string,
): Promise<string | null> {
	const candidates = buildUsageCandidates(baseUrl);
	for (const url of candidates) {
		const res = await fetchWithRetry(url, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
		});
		if (!res) continue;
		// 对齐 CodexBar 的状态码分级
		if (res.status === 401 || res.status === 403) {
			debugQuotaLog(`[sub2api-quota] Auth rejected for ${baseUrl} at ${url} (HTTP ${res.status})`);
			// 认证失败不再尝试后续候选
			return null;
		}
		if (!res.ok) continue;
		try {
			const text = await res.text();
			if (text.includes("<!doctype") || text.includes("<html")) continue;
			const data = JSON.parse(text);
			if (
				data &&
				typeof data === "object" &&
				!Array.isArray(data) &&
				(data.isValid === false
					? false
					: "rate_limits" in data ||
						"usage" in data ||
						"daily_usage" in data ||
						"quota" in data ||
						"subscription" in data ||
						"balance" in data)
			) {
				// isValid === false 视为不可用，与 CodexBar 保持一致
				if (data.isValid === false) {
					debugQuotaLog(`[sub2api-quota] Probe rejected: isValid=false at ${url}`);
					return null;
				}
				return url;
			}
			// 兼容旧响应：只要是对象且含任意已知字段即视为可用
			if (data && typeof data === "object" && !Array.isArray(data)) {
				// 至少返回过 JSON 对象，视为探测成功（避免误判）
				// 但需包含上述字段校验，兜底返回 url 以便后续 updateQuota 再做细校验
				if (Object.keys(data).length > 0) return url;
			}
		} catch {
			// silent
		}
	}
	return null;
}

function parseQuota(raw: any, fallbackUnit: string): Quota | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const limit = safeFiniteNumber(raw.limit);
	const used = safeFiniteNumber(raw.used);
	const remaining = safeFiniteNumber(raw.remaining);
	if (limit === null || used === null || remaining === null) return null;
	const unit = safeString(raw.unit) ?? fallbackUnit;
	return { limit, used, remaining, unit };
}

function parseSubscription(raw: any): Subscription | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const dailyUsage = safeFiniteNumber(raw.daily_usage_usd) ?? 0;
	const weeklyUsage = safeFiniteNumber(raw.weekly_usage_usd) ?? 0;
	const monthlyUsage = safeFiniteNumber(raw.monthly_usage_usd) ?? 0;
	const dailyLimit = safeFiniteNumber(raw.daily_limit_usd);
	const weeklyLimit = safeFiniteNumber(raw.weekly_limit_usd);
	const monthlyLimit = safeFiniteNumber(raw.monthly_limit_usd);
	const expiresAt = safeString(raw.expires_at);
	// 至少有一项 usage/limit 才视为有效 subscription
	if (
		dailyUsage === 0 &&
		weeklyUsage === 0 &&
		monthlyUsage === 0 &&
		dailyLimit === null &&
		weeklyLimit === null &&
		monthlyLimit === null &&
		!expiresAt
	) {
		return null;
	}
	return {
		dailyUsage,
		weeklyUsage,
		monthlyUsage,
		dailyLimit,
		weeklyLimit,
		monthlyLimit,
		expiresAt: expiresAt ?? null,
	};
}

function parseUsageTotals(raw: any): UsageTotals | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const requestsRaw = safeFiniteNumber(raw.requests);
	const tokensRaw = safeFiniteNumber(raw.total_tokens);
	const costRaw = safeFiniteNumber(raw.actual_cost);
	// CodexBar 校验 requests/tokens 需为整数；pi 端宽松处理
	const requests = requestsRaw !== null ? Math.floor(requestsRaw) : 0;
	const tokens = tokensRaw !== null ? Math.floor(tokensRaw) : 0;
	const cost = costRaw ?? 0;
	if (requests === 0 && tokens === 0 && cost === 0) {
		// 保留空但视为存在，与 CodexBar 的 || 0 语义一致
		return { requests, tokens, cost };
	}
	return { requests, tokens, cost };
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
		if (!res) return false;
		if (res.status === 401 || res.status === 403) {
			console.error(`[sub2api-quota] Auth rejected for ${providerId} (HTTP ${res.status})`);
			return false;
		}
		if (res.status === 429) {
			console.error(`[sub2api-quota] Rate limited for ${providerId} (HTTP 429)`);
			return false;
		}
		if (res.status >= 500) {
			console.error(`[sub2api-quota] Provider unavailable for ${providerId} (HTTP ${res.status})`);
			return false;
		}
		if (!res.ok) return false;
		const text = await res.text();
		if (text.includes("<!doctype") || text.includes("<html")) return false;
		let data: any;
		try {
			data = JSON.parse(text);
		} catch {
			return false;
		}
		if (!data || typeof data !== "object" || Array.isArray(data)) return false;
		if (data.isValid === false) {
			console.error(`[sub2api-quota] API rejected key for ${providerId} (isValid=false)`);
			return false;
		}

		// ---- 基础字段 ----
		const rootUnit = safeString(data.unit);
		const quotaRaw = data.quota;
		const quotaParsed = parseQuota(quotaRaw, rootUnit ?? "USD");
		const unit = rootUnit ?? quotaParsed?.unit ?? "USD";
		const subscription = parseSubscription(data.subscription);
		const balance = safeFiniteNumber(data.balance);
		const remaining = safeFiniteNumber(data.remaining);
		const planName = safeString(data.planName);
		const expiresAt = safeString(data.expires_at) ?? subscription?.expiresAt ?? null;

		const rateLimits: RateLimit[] = Array.isArray(data.rate_limits)
			? data.rate_limits
					.map((rl: any) => {
						if (!rl || typeof rl !== "object" || Array.isArray(rl)) return null;
						const window = safeString(rl.window);
						const limit = safeFiniteNumber(rl.limit);
						const used = safeFiniteNumber(rl.used);
						const remainingRL = safeFiniteNumber(rl.remaining);
						if (!window || limit === null || used === null || remainingRL === null) return null;
						return {
							limit,
							remaining: remainingRL,
							used,
							window,
							reset_at: safeString(rl.reset_at) ?? "",
						} satisfies RateLimit;
					})
					.filter((v: RateLimit | null): v is RateLimit => v !== null)
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

		// usage.today / usage.total — 对齐 CodexBar 的 totals() 校验
		let usageToday: UsageTotals | null = null;
		let usageTotal: UsageTotals | null = null;
		if (data.usage && typeof data.usage === "object" && !Array.isArray(data.usage)) {
			usageToday = parseUsageTotals(data.usage.today);
			usageTotal = parseUsageTotals(data.usage.total);
		}
		// 兼容 daily_usage 兜底
		const latestDay = dailyUsage.at(-1);
		const todayCost = Number(usageToday?.cost ?? latestDay?.cost ?? 0);
		const totalCost = Number(
			usageTotal?.cost ?? dailyUsage.reduce((sum, day) => sum + day.cost, 0),
		);

		// CodexBar 强调 subscription 的 daily/weekly/monthly 为权威，不从 daily_usage 重建；
		// 此处保留 daily_usage 仅用于 totalCost 兜底与 /quota 明细，不参与状态栏主窗口计算

		quotaProviders.set(providerId, {
			baseUrl: usageUrl,
			apiKey,
			rateLimits,
			dailyUsage,
			todayCost,
			totalCost,
			status: safeString(data.status) ?? (data.isValid === true ? "valid" : "unknown"),
			mode: safeString(data.mode) ?? "unknown",
			lastUpdated: Date.now(),
			quota: quotaParsed,
			subscription,
			balance: balance ?? null,
			unit,
			planName: planName ?? null,
			remaining: remaining ?? null,
			expiresAt,
			todayUsage: usageToday,
			totalUsage: usageTotal,
		});
		return true;
	} catch (e) {
		console.error(`[sub2api-quota] Error updating quota for ${providerId}:`, e);
		return false;
	}
}

function formatStatusText(providerId: string, info: QuotaInfo): string {
	// 优先级与 CodexBar 一致：subscription > quota > rate_limits > balance/todayCost
	// CodexBar sub2api.js: if (subscription) primary=daily, secondary=weekly, tertiary=monthly
	//                     else if (quota) primary=quota
	// statusbar 空间紧张，仅展示百分比；金额详情进 /quota
	if (info.subscription) {
		const parts: string[] = [];
		const sub = info.subscription;
		const dailyPct = subscriptionPercent(sub.dailyUsage, sub.dailyLimit);
		const weeklyPct = subscriptionPercent(sub.weeklyUsage, sub.weeklyLimit);
		const monthlyPct = subscriptionPercent(sub.monthlyUsage, sub.monthlyLimit);
		if (dailyPct !== null) parts.push(`d ${Math.round(dailyPct)}%`);
		if (weeklyPct !== null) parts.push(`w ${Math.round(weeklyPct)}%`);
		if (monthlyPct !== null) parts.push(`m ${Math.round(monthlyPct)}%`);
		if (parts.length) return `● ${providerId} ${parts.join(" · ")}`;
		// subscription 无 limit 时回落到 rate_limits
	}
	if (info.quota && info.quota.limit > 0) {
		const pct = Math.round((info.quota.used / info.quota.limit) * 100);
		// quota 模式下 CodexBar 也会展示 rate_limits extraWindows，但 statusbar 只取最紧凑的 quota 百分比
		// 若同时有 rate_limits，附加一个最满的 window 以保留原有 5h/daily 感知
		const windows = pickQuotaWindows(info.rateLimits).filter((rl) => rl.limit > 0);
		if (windows.length) {
			const windowPct = windows.map(formatUsagePercent).join(" · ");
			return `● ${providerId} quota ${pct}% · ${windowPct}`;
		}
		return `● ${providerId} quota ${pct}%`;
	}
	const windows = pickQuotaWindows(info.rateLimits).filter(
		(rl) => rl.limit > 0,
	);
	if (windows.length) {
		return `● ${providerId} ${windows.map(formatUsagePercent).join(" · ")}`;
	}
	if (info.balance !== null) {
		return `● ${providerId} ${formatMoneyWithUnit(info.balance, info.unit)}`;
	}
	return `● ${providerId} d ${formatMoneyWithUnit(info.todayCost, info.unit)}`;
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

			// Build detailed console layout aligned with CodexBar's usage summary
			const lines: string[] = [];
			lines.push(`Provider:     ${providerId}`);
			if (fresh.planName) lines.push(`Plan:         ${fresh.planName}`);
			lines.push(`Status:       ${fresh.status}`);
			lines.push(`Mode:         ${fresh.mode}`);
			lines.push(`Unit:         ${fresh.unit}`);
			if (fresh.balance !== null) {
				lines.push(`Balance:      ${formatMoneyWithUnit(fresh.balance, fresh.unit)}`);
			}
			if (fresh.remaining !== null) {
				lines.push(`Remaining:    ${formatMoneyWithUnit(fresh.remaining, fresh.unit)}`);
			}
			if (fresh.expiresAt) {
				const d = new Date(fresh.expiresAt);
				lines.push(`Expires:      ${isNaN(d.getTime()) ? fresh.expiresAt : d.toLocaleString()}`);
			}

			// Quota section (quota-limited key)
			if (fresh.quota) {
				const q = fresh.quota;
				const pct = q.limit > 0 ? Math.round((q.used / q.limit) * 100) : 0;
				lines.push(`Quota:        ${formatAmount(q.used, q.limit, q.unit)} (${pct}%, remaining ${formatMoneyWithUnit(q.remaining, q.unit)})`);
			}

			// Subscription section (daily/weekly/monthly) — authoritative per CodexBar docs
			if (fresh.subscription) {
				const s = fresh.subscription;
				lines.push("");
				lines.push("Subscription (authoritative, not derived from daily_usage):");
				if (s.dailyLimit !== null) {
					const pct = s.dailyLimit > 0 ? Math.round((s.dailyUsage / s.dailyLimit) * 100) : 0;
					lines.push(`  Daily:        ${formatAmount(s.dailyUsage, s.dailyLimit, "USD")} (${pct}%)`);
				} else {
					lines.push(`  Daily:        ${formatMoneyWithUnit(s.dailyUsage, "USD")} (no limit)`);
				}
				if (s.weeklyLimit !== null) {
					const pct = s.weeklyLimit > 0 ? Math.round((s.weeklyUsage / s.weeklyLimit) * 100) : 0;
					lines.push(`  Weekly:       ${formatAmount(s.weeklyUsage, s.weeklyLimit, "USD")} (${pct}%)`);
				} else {
					lines.push(`  Weekly:       ${formatMoneyWithUnit(s.weeklyUsage, "USD")} (no limit)`);
				}
				if (s.monthlyLimit !== null) {
					const pct = s.monthlyLimit > 0 ? Math.round((s.monthlyUsage / s.monthlyLimit) * 100) : 0;
					lines.push(`  Monthly:      ${formatAmount(s.monthlyUsage, s.monthlyLimit, "USD")} (${pct}%)`);
				} else {
					lines.push(`  Monthly:      ${formatMoneyWithUnit(s.monthlyUsage, "USD")} (no limit)`);
				}
			}

			// Usage summary (today / total) — aligned with CodexBar detail rows
			// CodexBar 未提供 usage 时不以 daily_usage 派生展示，避免与 subscription 权威值混淆
			const hasUsageSummary = Boolean(fresh.todayUsage || fresh.totalUsage);
			if (hasUsageSummary) {
				lines.push("");
				lines.push("Usage summary (key-scoped):");
				if (fresh.todayUsage) {
					lines.push(
						`  Today:        ${fresh.todayUsage.requests.toLocaleString()} req · ${fresh.todayUsage.tokens.toLocaleString()} tokens · ${formatMoneyWithUnit(fresh.todayUsage.cost, fresh.unit)}`,
					);
				}
				if (fresh.totalUsage) {
					lines.push(
						`  All time:     ${fresh.totalUsage.requests.toLocaleString()} req · ${fresh.totalUsage.tokens.toLocaleString()} tokens · ${formatMoneyWithUnit(fresh.totalUsage.cost, fresh.unit)}`,
					);
				}
			} else if (!fresh.subscription && !fresh.quota && fresh.balance === null) {
				// 仅当无 subscription/quota/balance 时，fallback 到 daily_usage 兜底展示
				const hasDaily = fresh.dailyUsage.length > 0;
				const hasCost = fresh.todayCost !== 0 || fresh.totalCost !== 0;
				if (hasDaily || hasCost) {
					lines.push(`Today Cost:   ${formatMoneyWithUnit(fresh.todayCost, fresh.unit)}`);
					lines.push(`Total Cost:   ${formatMoneyWithUnit(fresh.totalCost, fresh.unit)}`);
					const latestDay = fresh.dailyUsage.at(-1);
					if (latestDay) {
						lines.push(`Today Tokens: ${latestDay.total_tokens.toLocaleString()}`);
					lines.push(`Requests:     ${latestDay.requests.toLocaleString()}`);
					}
				}
			}

			lines.push("");
			lines.push("Rate Limits (extraWindows):");
			if (fresh.rateLimits.length === 0) {
				lines.push("  none reported by provider");
			}
			for (const rl of fresh.rateLimits) {
				const resetDate = rl.reset_at
					? new Date(rl.reset_at).toLocaleString()
					: "unknown";
				// CodexBar rate_limits 金额始终按 USD 展示，与 quota.unit 无关
				lines.push(
					`  [${normalizeWindowLabel(rl.window)}]  ${formatMoney(rl.used)}/${formatMoney(rl.limit, 0)}  (remaining: ${formatMoney(rl.remaining)}, resets: ${resetDate})`,
				);
			}

			// Notify: compact status-aligned string
			const statusText = formatStatusText(providerId, fresh);
			// 去掉前缀 ● 后的纯指标用于 toast，避免重复图标
			const toastText = statusText.replace(/^●\s*\S+\s*/, "");
			if (fresh.subscription || fresh.quota || fresh.rateLimits.length) {
				ctx.ui.notify(toastText || statusText, "info");
			} else if (fresh.balance !== null) {
				ctx.ui.notify(`Balance: ${formatMoneyWithUnit(fresh.balance, fresh.unit)}`, "info");
			} else {
				ctx.ui.notify(`Today: ${formatMoneyWithUnit(fresh.todayCost, fresh.unit)}`, "info");
			}
			console.error(lines.join("\n"));
		},
	});
}
