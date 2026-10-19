# 拉取、开发、发布与部署

本文档以仓库当前 `master` 分支、Gitee `origin` 和 npm 包 `fast-vite-plugins` 为准。

## 1. 首次拉取

```bash
git clone https://gitee.com/FastDotnet/Fast.Vite.Plugins.git
cd Fast.Vite.Plugins
corepack enable
pnpm --version
pnpm install --frozen-lockfile
pnpm check
```

要求 Node.js `^22.18.0 || ^24.18.0`、pnpm `^11.0.0`。`.nvmrc` 固定最低验证线 `22.18.0`；仓库不声明 `packageManager` 范围值，CI 明确安装 pnpm 11。

## 2. 正确同步远端

先确认工作区状态：

```bash
git status
git fetch origin
git pull --ff-only origin master
```

`--ff-only` 可以避免拉取时意外生成合并提交。如果有本地修改，先提交到功能分支，或明确暂存后再同步；不要在不清楚差异来源时覆盖生成文件或锁文件。

依赖清单或锁文件变化后执行：

```bash
pnpm install --frozen-lockfile
pnpm check
```

## 3. 开发流程

```bash
git switch master
git pull --ff-only origin master
git switch -c feat/short-topic
pnpm install --frozen-lockfile
```

开发时常用命令：

```bash
pnpm dev
pnpm lint:fix
pnpm format
pnpm test
pnpm check
```

公共 API 变更必须同时更新：源码类型与 TSDoc、`README`、[api](https://docs.fastdotnet.cn/zh-CN/frontend/vite-plugins/api/)、测试和 `CHANGELOG.md`。仓库根目录就是公开 npm 包；运行 `pnpm build` 会在被 Git 忽略的 `dist/` 生成 ESM、类型声明和 sourcemap，不应手工修改这些构建产物。

提交前确认：

```bash
git status --short
pnpm check
git diff --check
```

## 4. 准备版本

npm 版本不可覆盖。发布前先从 `package.json` 读取目标版本并查询注册表，确认该版本仍未被占用：

```bash
git switch master
git pull --ff-only origin master
git status --short
pnpm view fast-vite-plugins versions --json
```

如果查询结果已经包含目标版本，立即停止发布流程，按语义化版本选择新版本，再执行 `pnpm version <新版本> --no-git-tag-version` 并同步更新 changelog。不要覆盖、复用或删除已经发布的 npm 版本。

随后更新 `CHANGELOG.md`，并执行完整发布预检：

```bash
pnpm check
pnpm --config.ignore-scripts=true pack --dry-run
```

这两个命令会完成类型、Lint、格式、构建、测试和包内容检查。重点确认归档中只有需要发布的 `dist`、文档、许可证和清单，没有源码缓存、测试夹具、旧 CommonJS 产物或密钥。

## 5. 提交与打标签

```bash
git add package.json pnpm-lock.yaml CHANGELOG.md
git commit -m "release: v<version>"
git tag -a v<version> -m "fast-vite-plugins v<version>"
git push origin master
git push origin v<version>
```

标签必须指向已经通过质量门禁、版本和 changelog 一致的提交。不要先打标签再补文件。

## 6. 发布到 npm

仅在受信任工作站和已登录 npm 的前提下执行：

```bash
pnpm login
pnpm check
pnpm --config.ignore-scripts=true pack --dry-run
pnpm publish --access public
```

根 `package.json` 是唯一公开包清单，必须在仓库根目录直接执行上述命令。`prepack` 会再次执行 `pnpm check`；CI 只验证、不持有 npm 凭证也不自动发布。发布流程不会复制、同步或改写另一份 package.json。

仓库不配置自动 npm 发布工作流。发布者必须确认本地检出的是已推送并打标签的目标提交；不要把 npm token 写入仓库、`.npmrc` 或命令历史。

发布后核对：

```bash
pnpm view fast-vite-plugins@<version> version
pnpm add -D fast-vite-plugins@<version>
```

建议在最小 Vite 7 和 Vite 8 项目中分别完成一次安装、类型检查和构建冒烟测试。

## 7. “部署”应如何理解

本仓库是 npm 插件库，不运行服务，也没有单独的网站部署步骤。发布完成后，消费项目安装指定版本：

```bash
pnpm add -D fast-vite-plugins@<version>
pnpm build
```

真正部署的是消费项目的 `dist/`。如果启用了预压缩，服务器需要按 `Accept-Encoding` 返回 `.gz` / `.br`；如果启用了 SRI，需要同时部署注入后的 HTML 和对应哈希版本资源，并为跨域资源返回正确 CORS 响应；远程 CDN 的 integrity 仍需单独配置。如果启用了 CDN，需要验证 CSP、跨域属性、版本固定和目标网络可用性；如果启用了构建信息或 integrity manifest，需要决定 JSON 端点的缓存与公开策略。体积预算只在构建阶段执行，不产生运行时服务。

## 8. 故障版本处理

不要修改或复用已经发布的版本号。修复代码后发布新的 patch 版本，并在必要时使用 npm 的 deprecate 能力标记问题版本，同时在 changelog 中写明影响范围和替代版本。
