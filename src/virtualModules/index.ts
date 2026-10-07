import type { ConfigEnv, Plugin, ResolvedConfig } from "vite";
import type { Awaitable } from "../shared/plugin";

/** 传递给动态虚拟模块源码提供者的上下文 */
export interface VirtualModuleContext extends ConfigEnv {
	/** Vite 项目根目录的绝对路径 */
	root: string;
}

/** 静态 ESM 源码，或根据当前 Vite 环境异步生成源码的函数。 */
export type VirtualModuleSource = string | ((context: VirtualModuleContext) => Awaitable<string>);
/** 以 `virtual:` 开头的公开模块 ID 到源码提供者的映射。 */
export type VirtualModuleMap = Readonly<Record<string, VirtualModuleSource>>;

/** `virtualModules` 的配置 */
export interface VirtualModulesPluginOptions {
	/** 要注册的虚拟模块。所有键都必须以 `virtual:` 开头。 */
	modules: VirtualModuleMap;
}

/**
 * 使用对象声明虚拟模块。
 *
 * 生成内容必须是合法 ESM 源码。消费项目应为每个公开模块 ID 提供相应的 `declare module`
 * 声明，示例见 API 文档。
 *
 * @param options - 公开虚拟模块 ID 与静态或动态源码的映射。
 * @returns 可直接加入 Vite `plugins` 的虚拟模块插件。
 * @throws 模块映射为空、不是对象或包含非 `virtual:` ID 时抛出异常。
 */
export function virtualModules(options: VirtualModulesPluginOptions): Plugin {
	const configuredModules: unknown = options.modules;
	if (typeof configuredModules !== "object" || configuredModules === null || Array.isArray(configuredModules)) {
		throw new Error("[fast-vite:virtual-modules] modules must be an object.");
	}
	const { modules } = options;
	const ids = Object.keys(modules);
	const prefix = "\0fast-vite:virtual:";
	let config: ResolvedConfig;
	let env: ConfigEnv;

	if (ids.length === 0) throw new Error("[fast-vite:virtual-modules] modules must contain at least one module.");
	if (ids.some((id) => !id.startsWith("virtual:"))) {
		throw new Error("[fast-vite:virtual-modules] All module IDs must start with virtual:.");
	}

	return {
		name: "fast-vite:virtual-modules",
		config(_config, configEnv): void {
			env = configEnv;
		},
		configResolved(resolvedConfig): void {
			config = resolvedConfig;
		},
		resolveId(id): string | undefined {
			return Object.hasOwn(modules, id) ? `${prefix}${id}` : undefined;
		},
		async load(id): Promise<string | undefined> {
			if (!id.startsWith(prefix)) return undefined;
			const publicId = id.slice(prefix.length);
			const source = modules[publicId];
			if (source === undefined) return undefined;
			return typeof source === "function" ? source({ ...env, root: config.root }) : source;
		},
	};
}
