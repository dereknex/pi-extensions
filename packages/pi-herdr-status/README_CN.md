# pi-herdr-status

[pi](https://github.com/earendil-works/pi) 扩展：自动将 pi 当前使用的模型信息实时同步至 [Herdr](https://herdr.dev) 的侧边栏 Agents 面板。

通过 Herdr 的 `pane.report-metadata` 接口（参数 `--token model_info=<value>`），使用独立的 `--source pi-model` 命名空间，避免与其他插件（如 `gh-pr`）发生冲突。

## 特性

- **模型实时同步**：在启动、会话恢复、执行 `/model` 或快捷键 `Ctrl+P` 切换模型时，实时更新 Herdr 侧边栏状态。
- **状态实时上报**：自动同步 Agent 生命周期状态（执行中 `working`、等待交互确认 `blocked`、空闲 `idle`）至 Herdr 侧边栏。
- **精准多面板支持**：通过 `HERDR_PANE_ID` 区分不同的分屏面板。
- **命名空间隔离**：使用 `--source pi-model` 及自定义 token `--token model_info`，与其他扩展完全隔离。
- **自动清理**：会话关闭时自动清除对应面板的 `model_info` token。

## 安装

```bash
pi install npm:pi-herdr-status
```

## Herdr 配置说明

在 `~/.config/herdr/config.toml` 中为 `pi` 配置 `model_info` 显示：

```toml
[ui.sidebar.agents.rows_by_agent]
pi = [
  ["state_icon", "workspace", "tab"],
  ["agent", "model_info"]
]
```

## 许可证

MIT
