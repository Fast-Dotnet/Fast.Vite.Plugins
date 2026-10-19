**简体中文** | [English](./README.md)

<p align="center">
	<img src="./Fast.png" width="128" alt="Fast.Vite.Plugins Logo" />
</p>

<h1 align="center">Fast.Vite.Plugins</h1>

<p align="center">
	<a href="https://www.npmjs.com/package/fast-vite-plugins"><img src="https://img.shields.io/npm/v/fast-vite-plugins?logo=npm" alt="npm version" /></a>
	<a href="https://www.npmjs.com/package/fast-vite-plugins"><img src="https://img.shields.io/npm/dm/fast-vite-plugins" alt="npm downloads" /></a>
	<a href="./LICENSE"><img src="https://img.shields.io/npm/l/fast-vite-plugins" alt="License" /></a>
</p>

按需组合的 Vite 插件集合，覆盖代码生成、构建信息、资源处理与部署检查。

**[使用文档](https://docs.fastdotnet.cn/zh-CN/frontend/vite-plugins/) · [官方网站](https://fastdotnet.com)**

## 特性

- ESM-only 发布，Vite 是唯一 peer dependency，插件库本身没有运行时依赖。
- 以 Web 应用为核心，覆盖开发体验、HTML、资源、安全、可观测性和生产质量门禁。
- 每个插件只提供一个功能名函数，项目只需导入实际使用的插件。
- 生成结果稳定排序且仅在内容变化时写入，减少无意义 HMR 和缓存失效。
- 输出路径具备目录边界检查；文件监听具备防抖、关闭清理和名称冲突诊断。
- TypeScript 6 严格模式、类型感知 ESLint 10、真实 Vite 构建和公开 API 类型测试共同组成质量门禁。
- 支持 Vite 7 和 8；运行环境要求 Node.js `^22.18.0 || ^24.18.0`。

## 插件一览

| API                    | 用途                                               |
| ---------------------- | -------------------------------------------------- |
| `componentRegistry`    | 扫描 Vue/TSX/JSX 组件，生成导出入口和 Vue 全局类型 |
| `routerMeta`           | 生成页面路径与稳定组件名 JSON 映射                 |
| `svgIcons`             | 将 SVG 目录生成独立 Vue 图标组件与根索引           |
| `cdnImport`            | 注入 CDN 标签，并将 ESM 导入映射为浏览器全局变量   |
| `buildInfo`            | 输出构建信息 JSON、开发端点和虚拟模块              |
| `bundleBudget`         | 对单文件或产物总和执行原始/压缩体积预算            |
| `compression`          | 生成 gzip、Brotli 预压缩资源                       |
| `subresourceIntegrity` | 为本地 JavaScript/CSS 注入 SRI 完整性摘要          |
| `devRestart`           | 外部配置文件变化时防抖重启开发服务器               |
| `staticCopy`           | 构建后安全复制或转换静态文件与目录                 |
| `virtualModules`       | 声明静态或动态虚拟 ESM 模块                        |
| `envGuard`             | 在启动/构建前校验环境变量且不泄露变量值            |
| `htmlTemplate`         | 安全替换 HTML 占位符并注入 Vite HTML 标签描述符    |

## 安装

```bash
pnpm add -D fast-vite-plugins
```

消费项目必须使用 ESM Vite 配置，并安装 Vite 7 或 8。

## 快速开始

在 `vite.config.ts` 中显式启用需要的插件：

```ts
import { defineConfig } from "vite";
import { compression } from "fast-vite-plugins";

export default defineConfig({
	plugins: [compression({ algorithms: ["gzip", "brotli"], threshold: 10 * 1024 })],
});
```

该配置只生成预压缩文件；服务器仍需按 `Accept-Encoding` 返回相应资源，不会自动改变部署配置。

## 安全与部署提示

- `svgIcons` 会把 SVG 标记直接写入生成的 Vue TSX 组件；消费项目需要启用 Vue JSX/TSX 转换，扫描目录只能包含受信任的仓库资源。
- SRI 插件只计算本次构建的本地资源；远程 CDN 仍需固定版本，并单独配置 CSP 与 integrity 元数据。
- 预压缩插件只生成 `.gz` / `.br` 文件，Web 服务器或对象存储仍需按 `Accept-Encoding` 正确返回资源。
- 本仓库发布的是 npm 库，不是可直接部署的网站；应用部署的是消费项目构建得到的 `dist/`。

## 文档

- [完整 API 参考](https://docs.fastdotnet.cn/zh-CN/frontend/vite-plugins/api/)
- [风险指南](https://docs.fastdotnet.cn/zh-CN/frontend/vite-plugins/risks)
- [拉取、开发、发布与部署](./docs/DEVELOPMENT_RELEASE_DEPLOY.zh-CN.md)
- [贡献指南](./CONTRIBUTING.md)
- [工程质量审查](./docs/ENGINEERING_REVIEW.zh-CN.md)
- [更新日志](./CHANGELOG.md)
- [安全策略](./SECURITY.md)

## 本地开发

```bash
pnpm install --frozen-lockfile
pnpm check
```

修改插件时可使用 `pnpm dev` 启动长期运行的 tsdown 监听构建。

`check` 会固定执行 tsdown 构建、源码类型检查、发布声明消费者测试、ESLint、Prettier、运行时与真实 Vite 集成测试，以及公共 API、ESM-only 和归档契约测试。仓库根目录就是公开 npm 包；`pnpm build` 只写入根目录下被忽略的 `dist/`，打包和发布也从仓库根目录执行。

## 版权、许可证与使用声明

版权所有 © 2018-Now 小方。本项目依据 [Apache License 2.0](./LICENSE) 开源；在遵守许可证的前提下，可以使用、修改和分发本软件，包括商业使用。

再分发时，应按许可证要求提供许可证副本、对修改的文件作出显著说明，并保留适用的版权和归属声明；包含需要保留的 NOTICE 信息时一并处理。本说明不替代正式许可证，也不额外要求在产品界面展示作者或项目标识。

使用者应就自身使用、二次开发、部署、数据处理及运营活动遵守适用法律和第三方合法权益，自行取得依法需要的授权。上述内容为合规提醒，不构成附加许可条件。

除适用法律另有规定或另有书面约定外，本软件按“原样”提供；保证排除与责任限制以许可证第 7、8 条为准。提供本项目不代表原作者为使用者的二次开发和运营活动背书，也不当然承担其对第三方作出的合同承诺。本说明不排除依法不得排除的责任。
