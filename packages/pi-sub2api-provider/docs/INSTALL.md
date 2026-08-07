# 安装与迁移

## 推荐安装

```bash
pi install /Users/derek/workspaces/pi-extensions/packages/pi-sub2api-provider
```

安装后重启 pi，或在交互界面中执行 `/reload`。

## 临时验证

```bash
pi -e /Users/derek/workspaces/pi-extensions/packages/pi-sub2api-provider
```

## 从旧位置迁移

旧文件：

```text
~/.pi/agent/extensions/sub2api-quota.ts
```

新入口：

```text
/Users/derek/workspaces/pi-extensions/packages/pi-sub2api-provider/src/index.ts
```

确认新 package 可用后，可以选择删除旧全局扩展，避免重复注册：

```bash
mv ~/.pi/agent/extensions/sub2api-quota.ts ~/.pi/agent/extensions/sub2api-quota.ts.bak
```

如需回滚：

```bash
mv ~/.pi/agent/extensions/sub2api-quota.ts.bak ~/.pi/agent/extensions/sub2api-quota.ts
```
