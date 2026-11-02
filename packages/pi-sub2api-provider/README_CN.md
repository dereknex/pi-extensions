# pi-sub2api-provider

[![npm](https://img.shields.io/npm/v/pi-sub2api-provider.svg)](https://www.npmjs.com/package/pi-sub2api-provider)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/dereknex/pi-extensions/actions/workflows/check.yml/badge.svg)](https://github.com/dereknex/pi-extensions/actions/workflows/check.yml)

独立的 pi package：自动从 `~/.pi/agent/models.json` 与 `~/.pi/agent/auth.json` 读取 OpenAI-compatible / sub2api provider 配置，注册 provider，并在 pi 状态栏与 `/quota` 命令中展示额度信息。

隶属于 [pi-extensions](https://github.com/dereknex/pi-extensions) monorepo。

[English](./README.md)

## 能力

- 扫描 `~/.pi/agent/models.json` 中的 providers。
- 从 `~/.pi/agent/auth.json` 读取对应 provider 的 `key` 或 `access`。
- 自动探测 usage endpoint：
  - `${baseUrl}/usage`
  - `${root}/v1/usage`
  - magpie 网关：`${root}/v1/magpie/quotas?kept=1`（缓存读取，不打厂商）。状态栏显示当前模型
    所属账号、最紧的窗口在前；`/quota` 列出网关背后的每个账号。
- 获取并缓存 rate limit / daily usage。
- 自动拉取 `${baseUrl}/models`，并注册 `refreshModels`：打开 `/model`（或 `pi update --models`）时重新载入上游实时目录，而不是 `models.json` 里那份固定列表。
- 远端列表与 `models.json` 合并：本地配置优先（`api`、`baseUrl`、`reasoning`、`input`、`cost`、`contextWindow`、`maxTokens`、`thinkingLevelMap`），上游没有列出的本地模型保留。端点不可用、或 pi 要求离线刷新时，使用本地配置 / 缓存列表，且不报错。
- 远端模型元数据存在时读取，endpoint 只返回 `id` / `display_name` 时使用保守内置兜底值：
  - 上限：`context_window` / `context_length` / `max_input_tokens`、`max_output_tokens` / `max_tokens` / `max_completion_tokens`；
  - magpie 网关：`modalities.input` → `input`，`reasoning_levels` → `thinkingLevelMap`（模型没有的档位隐藏），`pricing`（每 token 的 USD）→ `cost`（每百万 token 的 USD）。
- 调用 `pi.registerProvider()` 注册 provider。
- 在 `session_start`、`model_select`、`turn_end` 时刷新/展示额度。
- 注册 `/quota` 命令显示当前 provider 的详细账单与额度信息。

## 安装方式

### 方式一：从 npm 安装（推荐）

```bash
pi install npm:pi-sub2api-provider
```

也可在 `~/.pi/agent/settings.json` 中加入：

```json
{
  "packages": ["npm:pi-sub2api-provider"]
}
```

### 方式二：从 git 安装

```bash
pi install git:github.com/dereknex/pi-extensions
```

### 方式三：作为本地 package 安装

```bash
pi install ./packages/pi-sub2api-provider
```

### 方式四：临时加载测试

```bash
pi -e /Users/derek/workspaces/pi-extensions/packages/pi-sub2api-provider
```

### 方式五：继续用全局扩展目录

如果暂时不想切换安装方式，可以把入口复制回全局扩展：

```bash
cp /Users/derek/workspaces/pi-extensions/packages/pi-sub2api-provider/src/index.ts ~/.pi/agent/extensions/sub2api-quota.ts
```

## 配置要求

需要已有：

- `~/.pi/agent/models.json`，用于 provider 连接配置；逐模型 `models` 数组是可选项。
- `~/.pi/agent/auth.json`

示例结构：

```jsonc
// ~/.pi/agent/models.json
{
  "providers": {
    "my-sub2api": {
      "baseUrl": "https://example.com/v1"
    }
  }
}
```

```jsonc
// ~/.pi/agent/auth.json
{
  "my-sub2api": {
    "type": "api-key",
    "key": "..."
  }
}
```

> 安全说明：本仓库不保存、不复制任何 API key 或 auth 文件。

## API adapter

默认使用 `openai-completions`。通过 `api` 字段可显式切换到其他 adapter。

| `api` | 请求路径 | `models.json` 中的 `baseUrl` |
|---|---|---|
| `openai-completions` / `openai-responses`（默认 `openai-completions`） | `{baseUrl}/v1/chat/completions`、`{baseUrl}/v1/responses` | 带或不带 `/v1` 都可以：缺失时自动补 `/v1` |
| `anthropic-messages` | `{baseUrl}/v1/messages` | 带或不带 `/v1` 都可以：末尾的 `/v1` 会被去掉，因为 Anthropic SDK 自己会拼 |

```jsonc
// ~/.pi/agent/models.json
{
  "providers": {
    "stepfun": {
      "baseUrl": "https://api.stepfun.com/step_plan",
      "api": "anthropic-messages",
      "models": [{ "id": "step-5-preview", "reasoning": true }]
    }
  }
}
```

如果没有这层归一化，请求会打到 `https://api.stepfun.com/step_plan/v1/v1/messages`，上游返回
`404`。现在两种 `baseUrl` 写法都会注册成同一个正确地址。

注意：`anthropic-messages` 仍要求上游确实暴露 `{baseUrl}/v1/messages` 路由；只提供
OpenAI 兼容路由的 sub2api 部署换了 adapter 也依然是 404。

单条 `models` 条目里也可以写自己的 `api` / `baseUrl`；其中 `baseUrl` 会按原样使用，不再做 `/v1` 调整。

### magpie 网关

[magpie](https://github.com/yetone/magpie) 会跑一个网关（默认 `http://127.0.0.1:3425`），
提供 OpenAI、Responses、Anthropic、Gemini 四种 API，所以 pi 把它当普通 provider 接即可。
逐模型 `models` 数组是可选的 —— 目录会自己载入：

```jsonc
// ~/.pi/agent/models.json
{
  "providers": {
    "my-magpie": {
      "api": "openai-responses",
      "baseUrl": "https://magpie.example.com/v1"
    }
  }
}
```

```jsonc
// ~/.pi/agent/auth.json
{
  "my-magpie": { "type": "api_key", "key": "<magpie 网关 key>" }
}
```

`baseUrl` 写网关根地址或带 `/v1` 都行，注册出来是同一个端点。key 就是 magpie **Gateway** 页上
那个；本机回环地址下 magpie 不校验，从别的机器访问则需要局域网共享 key。

**模型自动载入。** pi 刷新模型目录时（打开 `/model`、`pi update --models`、`pi --list-models`）
会拉一次 `/v1/models`，窗口、回复上限、输入模态、思考等级与价格都来自该响应。你在 `models.json`
里写的值仍然优先（`api`、`baseUrl`、`reasoning`、`input`、`cost`、`contextWindow`、`maxTokens`、
`thinkingLevelMap`），而你配置了、magpie 没列出的模型也会保留。

**额度来自 magpie。** `/v1/usage` 返回 `404`，于是探测回退到 `/v1/magpie/quotas?kept=1`
（magpie 的缓存读取，不打任何上游厂商）：

- 状态栏显示当前模型所属账号（`codex/gpt-6.1-sol` → magpie 的 `codex` 卡），最紧的窗口在前，
  最多 3 个：

  ```text
  ● my-magpie codex w [⣿⣤⡀⡀⡀] · 5h [⣤⡀⡀⡀⡀]
  ● my-magpie example Credits [⣿⣿⣿⣿⣿] · w [⡀⡀⡀⡀⡀] · 4h [⡀⡀⡀⡀⡀]
  ```

  `"statusBarUsage": "numeric"` 时：

  ```text
  ● my-magpie codex w 31% · 5h 10%
  ```

- `/quota` 会向 magpie 要一次现场读取，并列出网关背后的每个账号，每个窗口带百分比、重置时间，
  以及 magpie 自己的 `0 / 500` / `1500 / 1600` 渲染：

  ```text
  Provider:     my-magpie
  Source:       magpie (https://magpie.example.com/v1/magpie/quotas)
  Accounts:     2

  Codex (codex) · subscription · plus · you@example.com
    5 hours          0%  [⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀]  resets 03/11/2026, 3:16:15 am
    7 days          31%  [⣿⣿⣿⡀⡀⡀⡀⡀⡀⡀]  resets 09/11/2026, 11:11:16 am
  Example AI (example) · subscription · Free plan · you@example.com
    Credits          0%  [⡀⡀⡀⡀⡀⡀⡀⡀⡀⡀]  0 / 500  resets 30/11/2026, 11:59:59 pm
    Extra credits   94%  [⣿⣿⣿⣿⣿⣿⣿⣿⣿⣤]  1500 / 1600
  ```

不展示：magpie 的 reset 次数（`resets`）、账号为何被跳过（`holdsWhy`）、以及它的 token/金额汇总
（`/v1/magpie/usage`）。

> magpie 自己的 **Agents → Pi** 连接会往 `~/.pi/agent/models.json` 写一个名为 `magpie` 的 provider，
> 把 key 内联在里面。本扩展只接管凭据在 `auth.json` 的 provider，所以那个 provider 不动：pi 能正常
> 用，但不显示额度。想要两者都有，就把同一个网关按上面的方式配成自己的 provider（key 放 `auth.json`）。

如果没出现额度，用 `SUB2API_QUOTA_DEBUG=1` 启动 pi，可以看到探测了哪些端点、为什么被拒绝。

### 接管范围

`registerProvider` 的优先级高于 `models.json` 和 pi 内置 catalog，所以只有在 pi 自己解析不了时，
本扩展才会接管整个 provider：

| Provider | 注册内容 | 原因 |
|---|---|---|
| 自定义 id，凭据是 `auth.json` 里的 api-key | 全套（`name`/`api`/`baseUrl`/`apiKey`/`authHeader`/`models`） | pi 对「自定义 id + 凭据只在 auth.json」会报 `credentials_not_configured` |
| `auth.json` 里是 `oauth` 凭据 | 只注册 models | pi 自己管 OAuth 刷新与原生流；原始 access token 不会被当成 Bearer key 发出 |
| `models.json` 自带 `apiKey` / `headers` | 只注册 models | pi 原生就能解析 |
| 内置 provider id（`anthropic`、`openai`、`xai` …） | 只注册 models | provider 定义（`api`/`baseUrl`/鉴权/模型列表）归 pi 所有 |

“只注册 models”模式下，`name`、`api`、`baseUrl`、`apiKey`、`authHeader` 全部不传，各自回退到 pi
自己的层。模型自动拉取不受影响：如果 pi 无法为这些模型推断出 `api` / `baseUrl`（它会在改动任何
已存配置**之前**报错），注册会自动升级为全套形式。

可以用 `pi auth check --provider <id> --json` 观察实际生效的形式。

## 设置选项

可在全局 `~/.pi/agent/settings.json` 或项目 `.pi/settings.json` 中配置状态栏用量显示样式：

```json
{
  "sub2api": {
    "statusBarUsage": "progress"
  }
}
```

`statusBarUsage`（或 `usageDisplay`）支持的选项：

| 取值 | 说明 | 示例 |
|---|---|---|
| `"progress"` / `"bar"` | 进度条（默认） | `● my-sub2api d [⣿⣀⡀⡀⡀] · w [⣤⡀⡀⡀⡀]` |
| `"numeric"` / `"percent"` | 数字百分比 | `● my-sub2api d 25% · w 50%` |
| `"none"` / `false` | 状态栏隐藏用量 | *(不显示状态)* |

也可以通过环境变量 `SUB2API_STATUS_BAR_USAGE` 快速覆盖。

## 开发检查

在 monorepo 根目录（安装全部包并检查全部包）：

```bash
cd /Users/derek/workspaces/pi-extensions
npm install
npm test
npm run check
npm run pack:dry-run
```

或仅针对本包：

```bash
npm test -w pi-sub2api-provider
npm run check -w pi-sub2api-provider
```

## 发布

本包通过 pi-extensions monorepo 统一版本管理与发布。每个影响用户的改动都需要提交 changeset：

```bash
cd /Users/derek/workspaces/pi-extensions
npm run changeset
```

合并 release PR 后自动发布到 npm。

详细流程见 [`docs/RELEASE.md`](./docs/RELEASE.md)。

## 使用

进入 pi 后：

```text
/model
/quota
```

状态栏会显示类似：

- 进度条模式（默认）：
  ```text
  ● my-sub2api d [⣿⣀⡀⡀⡀] · w [⣤⡀⡀⡀⡀]
  ```
- 数字模式（`"statusBarUsage": "numeric"`）：
  ```text
  ● my-sub2api d 25% · w 50%
  ```
- magpie 网关（见 [magpie 网关](#magpie-网关)）：
  ```text
  ● my-magpie codex w [⣿⣤⡀⡀⡀] · 5h [⣤⡀⡀⡀⡀]
  ```

`/quota` 会把当前 provider 的完整明细打到控制台（账号、套餐、每个窗口、重置时间，以及上游提供
时的今日/累计用量）。

## License

[MIT](./LICENSE) © dereknex
