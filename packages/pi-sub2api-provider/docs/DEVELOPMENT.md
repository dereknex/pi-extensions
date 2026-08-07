# 开发内容归纳

## 目标

把原先放在 `~/.pi/agent/extensions/sub2api-quota.ts` 的个人扩展整理成独立目录 `/Users/derek/workspaces/pi-extensions/packages/pi-sub2api-provider`，方便：

- 独立维护；
- 通过 `pi install <local-path>` 安装；
- 后续发布为 npm/git pi package；
- 避免扩展代码继续混在个人全局配置目录里。

## 功能边界

这是一个 pi extension，不是独立 HTTP 服务。它依赖 pi 的扩展加载机制运行。

### 输入

- `~/.pi/agent/models.json`
  - provider id；
  - `baseUrl`；
  - 可选本地模型列表。
- `~/.pi/agent/auth.json`
  - 与 provider id 同名的认证条目；
  - 使用 `key` 或 `access` 字段。

### 输出 / 副作用

- 通过 `pi.registerProvider()` 注册 OpenAI-compatible provider。
- 通过 `ctx.ui.setStatus()` 更新状态栏额度摘要。
- 通过 `ctx.ui.notify()` 和 `console.log()` 输出 `/quota` 详情。

## 核心流程

1. 扩展启动时读取 `models.json` 和 `auth.json`。
2. 遍历 `modelsConfig.providers`。
3. 对每个 provider：
   - 读取 `baseUrl`；
   - 查找同名 auth；
   - 用 API key 探测 usage endpoint；
   - 拉取 usage 数据并缓存；
   - 拉取 `/models` 远端模型列表；
   - 合并远端模型与本地模型配置；
   - 注册 provider。
4. pi 生命周期事件触发时刷新 UI：
   - `session_start`：根据当前模型展示额度；
   - `model_select`：切换模型时刷新额度；
   - `turn_end`：每轮结束后后台刷新额度。
5. 用户执行 `/quota` 时拉取最新账单并显示详细信息。

## 数据结构

### ProviderModelConfig

本地模型配置，用于补充远端模型缺失的信息：

- `id`
- `name`
- `reasoning`
- `contextWindow`
- `maxTokens`

### QuotaInfo

运行期缓存：

- usage endpoint；
- API key；
- rate limits；
- daily usage；
- 今日成本；
- 总成本；
- provider 状态；
- 最近更新时间。

## Usage endpoint 兼容策略

探测顺序：

1. `${baseUrl}/usage`
2. `${root}/v1/usage`，其中 `root` 会移除末尾 `/v1`。

只有返回 JSON 且包含以下任一字段才认为有效：

- `rate_limits`
- `usage`
- `daily_usage`

HTML 响应会被忽略，避免误把前端页面当 API。

## 模型注册策略

- 优先使用远端 `/models` 返回的 `data`。
- 如果远端不可用，回退到 `models.json` 中配置的 `models`。
- 对每个模型补齐：
  - `name`
  - `reasoning`
  - `input: ["text"]`
  - 零成本占位 `cost`
  - `contextWindow`
  - `maxTokens`

reasoning 模型判断：

- 本地配置 `reasoning` 优先；
- 否则基于模型 id 中的关键字猜测：`o1`、`o3`、`reasoning`、`gpt5`、`gpt55`。

## UI 展示策略

状态栏优先显示这些窗口：

1. `5h`
2. `daily`
3. `weekly`

如果 provider 没返回 rate limit，则显示今日成本。

## 当前已整理文件

- `src/index.ts`：从全局扩展复制来的主实现。
- `package.json`：pi package manifest，声明 `pi.extensions`。
- `tsconfig.json`：开发期 TypeScript 检查。
- `README.md`：安装、配置与使用说明。
- `.gitignore`：排除依赖、密钥和临时文件。

## 后续建议

1. 把 usage API response 做更严格的类型守卫，减少 `any`。
2. 给 endpoint probe、usage normalize、model normalize 拆成独立模块并加单元测试。
3. 增加配置项控制刷新频率，避免高频 turn 下过多请求 usage endpoint。
4. 如果准备发布 npm，移除 `private: true`，补齐 license/repository。
