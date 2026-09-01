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
- 获取并缓存 rate limit / daily usage。
- 自动拉取 `${baseUrl}/models`，优先使用远端模型列表，仅在远端不可用时回退到本地配置模型。
- 远端模型元数据存在时读取 `context_window`、`max_tokens` 及常见别名；如果 endpoint 只返回 `id` / `display_name`，则使用保守内置兜底值。
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

```text
● my-sub2api d [⣿⣀⡀⡀⡀] · w [⣤⡀⡀⡀⡀]
```

## License

[MIT](./LICENSE) © dereknex
