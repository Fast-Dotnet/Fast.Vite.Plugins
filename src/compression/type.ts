import type { BrotliOptions, ZlibOptions } from "node:zlib";

/** 插件支持的预压缩算法。 */
export type CompressionAlgorithm = "brotli" | "gzip";

/** `compression` 的配置 */
export interface CompressionPluginOptions {
	/** 要生成的压缩格式；重复项会被忽略。 @defaultValue `["gzip", "brotli"]` */
	algorithms?: CompressionAlgorithm | readonly CompressionAlgorithm[];
	/** 小于该字节数的资源不压缩。 @defaultValue `1024` */
	threshold?: number;
	/** 仅当“压缩后大小 / 原大小”小于该值时输出。 @defaultValue `0.95` */
	minRatio?: number;
	/** 资源过滤器。默认压缩常见文本与 WebAssembly 文件。 */
	filter?: RegExp | ((fileName: string) => boolean);
	/** 自定义压缩文件名；结果必须是 `outDir` 内未被占用的相对路径。 */
	fileName?: (originalFileName: string, algorithm: CompressionAlgorithm) => string;
	/** 传递给 Node.js `zlib.gzip` 的选项 */
	gzipOptions?: ZlibOptions;
	/** 传递给 Node.js `zlib.brotliCompress` 的选项 */
	brotliOptions?: BrotliOptions;
}
