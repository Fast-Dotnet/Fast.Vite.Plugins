import type { Awaitable } from "../shared/plugin";

/** 构建后要复制的单个文件或目录 */
export interface StaticCopyTarget {
	/** 源文件或目录，相对于 Vite root；也可以传绝对路径。 */
	src: string;
	/** 目标文件或目录，相对于 Vite outDir。 */
	dest: string;
	/** 是否覆盖已存在文件。 @defaultValue `true` */
	overwrite?: boolean;
	/** 仅用于单个文件的内容转换。 */
	transform?: (content: Buffer, sourcePath: string) => Awaitable<Buffer | string | Uint8Array>;
}

/** `staticCopy` 的配置 */
export interface StaticCopyPluginOptions {
	/** 按声明顺序执行的复制目标。 */
	targets: readonly StaticCopyTarget[];
	/** 源路径不存在时的行为。 @defaultValue `"error"` */
	missing?: "error" | "ignore" | "warn";
}
