import type { Awaitable } from "../shared/plugin";

/** 会触发开发服务器重启的文件系统事件。 */
export type DevRestartEvent = "add" | "addDir" | "change" | "unlink" | "unlinkDir";

/** 传给 `beforeRestart` 的最后一次合并后变更。 */
export interface DevRestartContext {
	/** 发生变更的绝对路径 */
	file: string;
	/** Chokidar 文件系统事件。 */
	event: DevRestartEvent;
}

/** `devRestart` 的配置 */
export interface DevRestartPluginOptions {
	/**
	 * 要监听的文件或目录，相对于 Vite `root`；也允许绝对路径。
	 *
	 * 目录必须在服务器启动时存在才能识别其后代路径。不支持 glob，以避免不同 Chokidar
	 * 版本的 glob 语义差异。
	 */
	paths: string | readonly string[];
	/**
	 * 合并编辑器一次保存产生的连续文件事件。
	 *
	 * @defaultValue `100`
	 */
	debounce?: number;
	/**
	 * 重启时是否强制重新运行依赖预构建。
	 *
	 * @defaultValue `false`
	 */
	forceOptimizeDeps?: boolean;
	/** 重启前调用的同步或异步钩子；抛错会取消本次重启并写入 Vite 日志。 */
	beforeRestart?: (context: DevRestartContext) => Awaitable<void>;
	/**
	 * 是否记录触发重启的相对路径
	 *
	 * @defaultValue `true`
	 */
	log?: boolean;
}

/** 插件内部使用的已解析监听目标。 */
export interface ResolvedRestartPath {
	/** 规范化后的绝对路径 */
	path: string;
	/** 目标在服务器启动时是否为目录 */
	directory: boolean;
}
