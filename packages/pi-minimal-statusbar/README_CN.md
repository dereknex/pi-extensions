# pi-minimal-statusbar

[![npm](https://img.shields.io/npm/v/pi-minimal-statusbar.svg)](https://www.npmjs.com/package/pi-minimal-statusbar)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/dereknex/pi-extensions/actions/workflows/check.yml/badge.svg)](https://github.com/dereknex/pi-extensions/actions/workflows/check.yml)

极简 pi 状态栏（footer）：只展示重要信息。

```
左：~/path/to/project git:branch± • provider/model (thinking) • 12.3 t/s • 1.20s ttft • cache:87% • $1.23/$10 • goal
右：[####.........] 40% (128K)
```

隶属于 [pi-extensions](https://github.com/dereknex/pi-extensions) monorepo。

[English](./README.md)

## 能力

- 当前目录（home 缩写为 `~`）、git 分支及脏标记。
- 模型名、provider，以及按思考强度着色的 thinking level。
- 实时 tokens/s（按生成时长加权的本次运行吞吐，不含工具执行时间）、首字延迟（ttft）、会话累计缓存命中率（与 /session 一致）。
- 其他扩展的额度状态（如 [pi-sub2api-provider](https://www.npmjs.com/package/pi-sub2api-provider)）与任意 `ctx.ui.setStatus()` 扩展状态。
- 上下文使用条，颜色渐变（绿 → 黄 → 橙 → 红）。
- 单行放不下时自动拆成两行。

## 安装

```bash
pi install npm:pi-minimal-statusbar
```

或在 `~/.pi/agent/settings.json` 中加入：

```json
{
  "packages": ["npm:pi-minimal-statusbar"]
}
```

## 配置

所有选项均可选，默认值如下。配置放在**全局** `~/.pi/agent/settings.json` 或**项目** `.pi/agent/settings.json` 的 `minimal-footer` 键下（项目配置覆盖全局）：

```jsonc
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
```

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `showCwd` | `true` | 显示当前目录 |
| `showGit` | `true` | 显示 git 分支（带 `±` 脏标记） |
| `showModel` | `true` | 显示 provider/model |
| `showThinking` | `true` | 显示 thinking level（按强度着色） |
| `showTps` | `true` | 显示每秒 tokens（按生成时长加权，不含工具执行时间） |
| `showTtft` | `true` | 显示首字延迟 |
| `showCacheStats` | `true` | 显示会话累计缓存命中率（与 /session 一致） |
| `showQuota` | `true` | 显示其他扩展的额度状态 |
| `showGoal` | `true` | 显示 goal 状态 |
| `showContextBar` | `true` | 显示上下文使用条 |
| `showContextPercent` | `true` | 显示上下文使用百分比 |
| `showContextWindowSize` | `true` | 显示上下文窗口大小（如 `128K`） |
| `extensionStatuses` | `true` | 其他扩展状态：`true`（全部）、`false`（不显示）、`string[]`（白名单） |
| `hiddenExtensionStatuses` | `[]` | 即使 `extensionStatuses` 为 `true` 也隐藏的 status key |

## 额度集成

footer 会优先匹配当前 provider 的额度状态（如 `quota:<provider>`、`<provider>-quota` 等），依次回退到 `quota`、`sub2api-quota` 或任意 `quota|usage|billing|limit` 键。这样多个额度扩展可以共存，只显示当前 provider 的额度。

## 开发

在 monorepo 根目录：

```bash
cd /Users/derek/workspaces/pi-extensions
npm install
npm run check
npm run pack:dry-run
```

## License

[MIT](./LICENSE) © dereknex
