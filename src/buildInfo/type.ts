import type { ConfigEnv } from "vite";
import type { Awaitable, JsonValue } from "../shared/plugin";

/**
 * 构建信息插件生成的标准元数据。
 *
 * 除固定字段外，还会保留 {@link BuildInfoPluginOptions.data} 返回的自定义 JSON 字段。
 * 固定字段始终由插件写入，不能被自定义数据覆盖。
 */
export interface BuildInformation {
	/** 当前应用版本。 */
	version: string;
	/** ISO 8601 格式的构建时间 */
	builtAt: string;
	/** Vite 当前运行模式 */
	mode: string;
	/** CI 提交标识；没有可用来源时省略。 */
	commit?: string;
	/** 由 `data` 提供的其他 JSON 字段。 */
	[key: string]: JsonValue | undefined;
}

/** 传递给动态构建信息提供者的只读上下文 */
export interface BuildInfoContext extends ConfigEnv {
	/** Vite 解析后的项目根目录绝对路径 */
	root: string;
}

/** `buildInfo` 的配置 */
export interface BuildInfoPluginOptions {
	/** 固定版本号；省略时读取 {@link packageJson} 指向的文件。 */
	version?: string;
	/** package.json 路径，相对于 Vite `root`。 @defaultValue `"package.json"` */
	packageJson?: string;
	/** 构建产物中的 JSON 文件名，必须位于 `outDir` 内。 @defaultValue `"build-info.json"` */
	fileName?: string;
	/** Git 提交标识；默认依次读取 `GITHUB_SHA`、`GIT_COMMIT`、`CI_COMMIT_SHA`。 */
	commit?: string;
	/** 自定义、可 JSON 序列化的构建信息；函数允许异步返回。 */
	data?: Readonly<Record<string, JsonValue>> | ((context: BuildInfoContext) => Awaitable<Readonly<Record<string, JsonValue>>>);
	/** 是否在开发服务器的同名 URL 提供 JSON。 @defaultValue `true` */
	dev?: boolean;
	/** 构建信息虚拟模块 ID；设为 `false` 可关闭。 @defaultValue `"virtual:fast-vite/build-info"` */
	virtualModuleId?: false | string;
	/** 自定义时间来源，主要用于可重复构建与自动化测试。 @defaultValue `() => new Date()` */
	now?: () => Date;
}
