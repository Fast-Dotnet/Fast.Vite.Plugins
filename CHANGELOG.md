# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases should follow [Semantic Versioning](https://semver.org/).

## [2.0.17] - 2026-10-07

### Changed

- Use English for built-in errors and warning diagnostics, preserving plugin prefixes, configuration and path context, error types and failure conditions.
- Preserve caller-provided validation messages and underlying errors without translation.
- Normalize plugin option and context documentation.

### Tests

- Update diagnostic assertions and cover English environment validation messages and unchanged custom messages.

## [2.0.16] - 2026-09-22

### Fixed

- Route synchronous debounced-task failures through `onError`, just like Promise rejections.

### Documentation and Tooling

- Correct localized Fast.Docs links and retain minimal README examples.
- Align public-contract comments and agent guidance.
- Keep ESLint and Prettier skill-file ignores separate and add regression checks.

## [2.0.15] - 2026-09-12

### Changed

- Expanded the applicable JavaScript, TypeScript, import, RegExp, JSON, Markdown, sorting, and Prettier rules from Fast.ESLint.Config 2.1.8 directly in the repository's single `eslint.config.mjs`.
- Kept only the Node, browser-fixture, and project-file scope adaptations required by this Vite plugin package; no shared-config package or framework rule group is loaded.

## [2.0.14] - 2026-09-11

### Changed

- Strengthened runtime option validation across plugins so invalid falsy JavaScript values are rejected instead of bypassing enum, object, array, or algorithm checks.
- Enabled type-aware unnecessary-condition and async-function lint checks for plugin sources, aligning the implementations without changing the public API.

## [2.0.13] - 2026-09-01

### Changed

- Fixed `cdnImport({ dev: true })` parsing Vite HTML inline-style proxy requests as JavaScript; CSS requests are now ignored while CDN tags and JavaScript import transforms remain enabled in development.

## [2.0.12] - 2026-08-30

### Changed

- Changed the generated SVG icon root index to emit one named export per line, keeping large icon collections stable under formatting.
- Removed the default `Icon` component-name suffix; `about.svg` now generates `About` unless `componentSuffix` is configured explicitly.

## [2.0.11] - 2026-08-30

### Changed

- Simplified `componentRegistry` output by removing the generated component object while retaining named exports, `NameInstance` types, and `registerComponents`; registration now uses each runtime component name directly, while statically detectable missing names only warn during generation.
- Changed `svgIcons` to emit one `defineComponent`-based inline-TSX `<SVG relative path>/index.tsx` component per source file plus a root index that directly default-exports the readonly icon object.
- Replaced generated lint and format suppression directives with a method-specific Chinese `@generated` header and a blank line before generated code.

## [2.0.10] - 2026-08-29

### Changed

- Enabled source-group ordering inside the TypeScript type-import group and aligned repository type imports with the resulting builtin, external, internal, parent, sibling, and index hierarchy.
- Sorted generated component imports by module source path and placed the Vue `App` type import after value imports so generated registries remain compatible with the ESLint import order.

## [2.0.9] - 2026-08-29

### Changed

- Changed generated component registration to use `Component.name ?? "GeneratedName"`, preserving runtime names while ensuring unnamed components are still registered with a type-safe generated fallback.

## [2.0.8] - 2026-08-29

### Changed

- Changed generated component registration to use each component's runtime `name`, with build warnings for statically detectable missing names and safe skipping when the runtime name is empty.
- Restored generated `NameInstance` exports for every scanned component.

## [2.0.7] - 2026-08-26

### Changed

- Preserved the original missing-source filesystem error as the `cause` of strict static-copy failures.
- Simplified internal fallback naming and debounced task scheduling without changing the public plugin API.
- Synchronized the self-contained ESLint Flat Config with the applicable Fast.ESLint.Config source rules and comments, refreshed compatible development dependencies, and documented the VS Code recommendations.

## [2.0.6] - 2026-08-19

### Changed

- Changed the default component registry outputs to `src/components/index.ts` and `types/components.d.ts`.
- Changed the default SVG icon module output to `src/icons/index.ts`.

## [2.0.5] - 2026-08-16

### Changed

- Aligned the component registry, router metadata, and SVG icon source directories with their published plugin API names without changing the public API.

## [2.0.4] - 2026-08-09

### Changed

- Added prioritized import path groups for the uni-app, Vue, Element Plus, Fast Element Plus, Fast China, and Lodash ecosystems while keeping type-only imports in the dedicated type group.
- Changed import group spacing to a compact no-blank-line style and normalized the repository imports to the new policy.

## [2.0.3] - 2026-08-08

### Changed

- Added consistent `fast` and `fast-china` package keywords and completed the npm publish allowlist with contribution guidance.
- Removed `src` and declaration maps that referenced unpublished source files while retaining self-contained runtime source maps.
- Focused package-contract checks on public exports, ESM loading, publish contents, and runtime source-map integrity.

## [2.0.2] - 2026-08-04

### Changed

- Standardize the bilingual README, repository ignores, editor recommendations, TypeScript configuration, and development workflow with the other Fast frontend SDK repositories.
- Rename the package contract test to `tests/package.test.mjs` and align package metadata with the canonical FastDotnet project URLs.
- Preserve the repository-local ESLint, sorting, and formatting implementation without introducing cross-repository dependencies.

## [2.0.1] - 2026-08-03

### Changed

- Align Node.js, pnpm, CI, and Node type contracts with the 22.18/24.18 validation lines.
- Add a single explicit ESM entry, declaration maps, and exact package-content governance tests.
- Add regression coverage for CDN transforms and source maps, SRI HTML/path handling, lifecycle disposal, route-name scanning, runtime validation, multi-output static copy, and SRI → budget → compression ordering.
- Add public jsDelivr and unpkg URL templates, with jsDelivr remaining the default CDN provider.
- Support Vite 7 and 8 through the public peer dependency contract.
- Add English and Chinese risk guidance and clarify the release process.

## [2.0.0] - 2026-08-01

### Added

#### Core

- One feature-named function per plugin with `...PluginOptions` public types.
- ESM-only `.mjs` output and `.d.mts` declarations with source maps.
- TypeScript 6, tsdown, ESLint 10, pnpm 11, and Node.js `^22.18.0 || >=24.11.0`.
- Vite 8 development and peer support.
- Consistent `fast-vite:<feature>` plugin names and diagnostics.

#### Plugins

- Component registry, router metadata, SVG icons, CDN imports, build information, compression, static copy, virtual modules, environment validation, and HTML templates.
- Per-file or aggregate raw/gzip/Brotli bundle budgets with no-match enforcement.
- SHA-256/384/512 Subresource Integrity injection with an optional manifest.
- Debounced development-server restart for external configuration inputs.

#### Quality and Documentation

- Type-aware, self-contained ESLint flat config with documented project rules.
- Public API compilation tests, unit tests, real Vite Web application builds, and package archive checks.
- Output-root guards, strict option validation, stable generation, unchanged-write avoidance, and cancellable watcher tasks.
- Framework-level TSDoc for plugin options, contexts, results, defaults, error boundaries, and security-sensitive behavior.
- English and Chinese README/API documentation plus contribution, security, engineering review, and release guides.

#### Publishing

- The repository root is the public `fast-vite-plugins` package.
- `pnpm build` writes ESM code, declarations, and source maps only to the root `dist/` directory.
- Pack and publish commands use the root package manifest directly; no duplicated manifest or synchronization script is maintained.
- CI validates Node.js 22.18/24.11, pnpm 11, Vite 8, and the final npm archive before release.

[2.0.17]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.16...v2.0.17
[2.0.16]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.15...v2.0.16
[2.0.15]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.14...v2.0.15
[2.0.14]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.13...v2.0.14
[2.0.13]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.12...v2.0.13
[2.0.12]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.11...v2.0.12
[2.0.11]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.10...v2.0.11
[2.0.10]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.9...v2.0.10
[2.0.9]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.8...v2.0.9
[2.0.8]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.7...v2.0.8
[2.0.7]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.6...v2.0.7
[2.0.6]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.5...v2.0.6
[2.0.5]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.4...v2.0.5
[2.0.4]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.3...v2.0.4
[2.0.3]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.2...v2.0.3
[2.0.2]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.1...v2.0.2
[2.0.1]: https://gitee.com/FastDotnet/fast.vite.plugins/compare/v2.0.0...v2.0.1
[2.0.0]: https://gitee.com/FastDotnet/fast.vite.plugins/releases/tag/v2.0.0
