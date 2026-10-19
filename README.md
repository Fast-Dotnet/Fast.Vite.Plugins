[简体中文](./README.zh.md) | **English**

<p align="center">
	<img src="./Fast.png" width="128" alt="Fast.Vite.Plugins Logo" />
</p>

<h1 align="center">Fast.Vite.Plugins</h1>

<p align="center">
	<a href="https://www.npmjs.com/package/fast-vite-plugins"><img src="https://img.shields.io/npm/v/fast-vite-plugins?logo=npm" alt="npm version" /></a>
	<a href="https://www.npmjs.com/package/fast-vite-plugins"><img src="https://img.shields.io/npm/dm/fast-vite-plugins" alt="npm downloads" /></a>
	<a href="./LICENSE"><img src="https://img.shields.io/npm/l/fast-vite-plugins" alt="License" /></a>
</p>

Composable Vite plugins for code generation, build information, asset processing and deployment checks.

**[Documentation](https://docs.fastdotnet.cn/en-US/frontend/vite-plugins/) · [Official website](https://fastdotnet.com)**

## Highlights

- ESM-only package with Vite as its only peer dependency and no runtime dependencies.
- Web-application-first scope covering development, HTML, assets, security, observability, and production quality gates.
- One feature-named function per plugin: import and configure only what your project needs.
- Deterministic generators that avoid rewriting unchanged output.
- Output-boundary validation, debounced watchers, watcher cleanup, and clear conflict diagnostics.
- TypeScript 6 strict checks, type-aware ESLint 10, public API type tests, Node tests, and a real Vite build test.
- Vite 7 and 8 support on Node.js `^22.18.0 || ^24.18.0`.

## Plugins

| API                    | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `componentRegistry`    | Generate Vue component exports and global types         |
| `routerMeta`           | Generate a route-file to component-name JSON map        |
| `svgIcons`             | Generate independent Vue icon components and an index   |
| `cdnImport`            | Map ESM imports to CDN-provided browser globals         |
| `buildInfo`            | Emit build metadata, a dev endpoint, and virtual module |
| `bundleBudget`         | Enforce per-file or total raw/compressed size budgets   |
| `compression`          | Emit gzip and Brotli precompressed assets               |
| `subresourceIntegrity` | Inject SRI hashes for local JavaScript and CSS          |
| `devRestart`           | Restart dev when external configuration files change    |
| `staticCopy`           | Safely copy or transform build-time static assets       |
| `virtualModules`       | Declare static or dynamic virtual ESM modules           |
| `envGuard`             | Validate environment variables without logging values   |
| `htmlTemplate`         | Replace escaped HTML placeholders and inject tags       |

## Install

```bash
pnpm add -D fast-vite-plugins
```

The consuming project must use an ESM Vite configuration and Vite 7 or 8.

## Quick start

Enable only the plugins needed by the application in `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { compression } from "fast-vite-plugins";

export default defineConfig({
	plugins: [compression({ algorithms: ["gzip", "brotli"], threshold: 10 * 1024 })],
});
```

This emits precompressed files only. The server must still select them using `Accept-Encoding`; deployment settings are not changed automatically.

## Operational notes

- `svgIcons` writes SVG markup directly into generated Vue TSX components. Enable Vue JSX/TSX transformation in the consuming project and only scan trusted repository assets.
- The SRI plugin hashes local build outputs. Pin CDN versions and provide integrity metadata for remote CDN resources separately.
- Precompression emits `.gz` and `.br`; your server or object storage must serve them based on `Accept-Encoding`.
- When using SRI, budgets, and precompression together, keep this order in `plugins`: SRI → budgets → compression.
- This repository publishes an npm library. Deploy the consuming application's built `dist/`, not this repository.

## Documentation

- [Complete API reference](https://docs.fastdotnet.cn/en-US/frontend/vite-plugins/api/)
- [Risk guide](https://docs.fastdotnet.cn/en-US/frontend/vite-plugins/risks)
- [Development, release, and deployment guide (Chinese)](./docs/DEVELOPMENT_RELEASE_DEPLOY.zh-CN.md)
- [Contributing guide](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)
- [Security policy](./SECURITY.md)

## Development

```bash
pnpm install --frozen-lockfile
pnpm check
```

Use `pnpm dev` for a long-running tsdown watch build while editing plugins.

The repository root is the public npm package. `pnpm build` writes only to the ignored root `dist/` directory, and package inspection or publishing runs from the repository root with pnpm.

## Copyright, license and use

Copyright © 2018-Now 小方. This project uses [Apache License 2.0](./LICENSE). Use, modification, distribution and commercial use are permitted subject to its terms.

When redistributing, provide the license, mark modified files and preserve applicable copyright, attribution and supplied NOTICE information as required. This summary does not replace the license or impose additional UI attribution.

Users are responsible for the legal compliance and authorization of their own modifications, deployment, data processing and operations. This reminder is not an additional license condition.

Except as required by applicable law or agreed in writing, the software is provided on an "AS IS" basis. Sections 7 and 8 govern warranty disclaimers and liability limits. Providing the project does not endorse downstream activities or assume users' contractual commitments. This statement does not exclude liability that cannot lawfully be excluded.
