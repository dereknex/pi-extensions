# 发布与维护

本项目已决策使用 [Changesets](https://github.com/changesets/changesets) 管理版本、更新 `CHANGELOG.md`，并通过 GitHub Actions 自动发布到 npm。

## 发布策略

- `main` 是发布分支。
- 每个会影响用户的改动都需要提交一个 changeset 文件。
- 普通代码 PR 合并到 `main` 后，`Release` workflow 会创建或更新 release PR。
- release PR 合并后，`Release` workflow 会执行 `npm publish`。
- 首次发布目标版本是 `0.1.0`：仓库内 `package.json` 初始版本保持为 `0.0.0`，由 `.changeset/initial-release.md` 的 `minor` bump 生成 `0.1.0`。

## 首次发布前必须准备

1. GitHub 仓库已创建：`dereknex/pi-sub2api-provider`。
2. 本地 remote 指向该仓库：

   ```bash
   git remote -v
   ```

3. npm 包名可用：

   ```bash
   npm view pi-sub2api-provider
   ```

   首次发布前应返回 404 / not found。

4. GitHub Actions Secret 已配置：

   - `NPM_TOKEN`：npm Automation / Publish token。

5. GitHub Actions 权限已允许创建 release PR：

   - Repository Settings → Actions → General → Workflow permissions
   - 建议启用 `Read and write permissions`
   - 建议启用 `Allow GitHub Actions to create and approve pull requests`

6. `package-lock.json` 需要提交到仓库，因为 CI 使用 `npm ci`。

## 日常发布流程

1. 修改代码或文档。
2. 创建 changeset：

   ```bash
   npm run changeset
   ```

3. 按提示选择版本类型：

   - `patch`：bug fix、文档修正、小改动。
   - `minor`：新增能力、兼容性增强。
   - `major`：破坏性变更。

4. 本地检查：

   ```bash
   npm run check
   npm run pack:dry-run
   ```

5. 提交代码、lockfile、changeset 文件：

   ```bash
   git add .
   git commit -m "feat: describe change"
   git push
   ```

6. PR 合并到 `main` 后，GitHub Actions 会创建 `chore(release): version packages` release PR。
7. 检查 release PR 中的 `package.json`、`package-lock.json`、`CHANGELOG.md` 是否符合预期。
8. 合并 release PR，GitHub Actions 自动发布到 npm。

## 本地预发布检查

```bash
npm ci
npm run check
npm run pack:dry-run
```

`npm pack --dry-run` 输出应只包含发布所需文件，例如：

- `src/`
- `docs/`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `package.json`

不应包含：

- `node_modules/`
- `.git/`
- `.github/`
- `.changeset/`
- `.env`

## 手动发布，仅应急

正常情况下不要手动发布。只有 GitHub Actions 故障时才使用：

```bash
npm ci
npm run check
npm run pack:dry-run
npm run version
git add package.json package-lock.json CHANGELOG.md .changeset
git commit -m "chore(release): version packages"
npm run release
```

如果手动发布，需要确保当前 npm 登录账号有发布权限，且没有跳过 `npm run pack:dry-run`。

## 发布后验证

```bash
npm view pi-sub2api-provider
pi install npm:pi-sub2api-provider
```

进入 pi 后验证：

```text
/model
/quota
```

## 回滚与补救

npm 包已经发布后不建议删除版本。优先处理方式：

1. 发现文档或小问题：提交修复 PR，使用 `patch` changeset 发布新版本。
2. 发现严重运行问题：提交回滚或禁用相关逻辑，使用 `patch` changeset 发布新版本。
3. 误发敏感信息：立即撤销相关 token / secret，然后评估是否需要 npm deprecate 或联系 npm support。

可标记坏版本：

```bash
npm deprecate pi-sub2api-provider@<version> "Please upgrade to a newer version."
```
