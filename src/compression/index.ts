import { compressBytes } from "../shared/compression";
import { isSafeOutputFileName } from "../shared/fileSystem";
import { assertPostBuildPluginOrder } from "../shared/order";
import type { Plugin } from "vite";
import type { CompressionAlgorithm, CompressionPluginOptions } from "./type";

export type { CompressionAlgorithm, CompressionPluginOptions } from "./type";

type CompressibleOutput = { code: string; type: "chunk" } | { source: string | Uint8Array; type: "asset" };

const DEFAULT_FILTER = /\.(?:css|html?|js|json|mjs|svg|txt|wasm|xml)$/i;

/**
 * 为构建产物生成 `.gz` / `.br` 预压缩文件，适合 Nginx、Caddy 与对象存储直接提供静态压缩资源。
 *
 * @param options - 压缩算法、阈值、收益率、过滤器和编码器选项。
 * @returns 可直接加入 Vite `plugins` 的预压缩插件。
 * @throws 算法、数值、文件名或产物顺序无效时抛出异常。
 */
export function compression(options: CompressionPluginOptions = {}): Plugin {
	const configuredAlgorithms: unknown = options.algorithms;
	const algorithmsWithDefault = configuredAlgorithms === undefined ? ["gzip", "brotli"] : configuredAlgorithms;
	const algorithmValues = typeof algorithmsWithDefault === "string" ? [algorithmsWithDefault] : algorithmsWithDefault;
	const threshold = options.threshold ?? 1024;
	const minRatio = options.minRatio ?? 0.95;
	const filter = options.filter ?? DEFAULT_FILTER;

	if (!Number.isFinite(threshold) || threshold < 0) throw new Error("[fast-vite:compression] threshold must be a finite non-negative number.");
	if (!Number.isFinite(minRatio) || minRatio <= 0 || minRatio > 1) {
		throw new Error("[fast-vite:compression] minRatio must be a finite number greater than 0 and at most 1.");
	}
	if (
		!Array.isArray(algorithmValues) ||
		algorithmValues.length === 0 ||
		algorithmValues.some((algorithm) => algorithm !== "gzip" && algorithm !== "brotli")
	) {
		throw new Error("[fast-vite:compression] algorithms must contain only gzip or brotli.");
	}
	const algorithms = [...new Set(algorithmValues)] as CompressionAlgorithm[];

	return {
		name: "fast-vite:compression",
		apply: "build",
		enforce: "post",
		configResolved: assertPostBuildPluginOrder,
		generateBundle: {
			order: "post",
			async handler(_outputOptions, bundle): Promise<void> {
				const emittedNames = new Set(Object.keys(bundle));
				for (const [originalFileName, output] of Object.entries(bundle)) {
					if (!matchesFilter(originalFileName, filter)) continue;
					const content = outputToBuffer(output);
					if (content.byteLength < threshold) continue;

					for (const algorithm of algorithms) {
						const compressed = await compressBytes(content, algorithm, options);
						if (compressed.byteLength / content.byteLength >= minRatio) continue;
						const fileName =
							options.fileName?.(originalFileName, algorithm) ?? `${originalFileName}${algorithm === "gzip" ? ".gz" : ".br"}`;
						if (!isSafeOutputFileName(fileName) || emittedNames.has(fileName)) {
							throw new Error(
								`[fast-vite:compression] Compressed file name is invalid or conflicts with an existing output: ${fileName}`
							);
						}
						this.emitFile({ type: "asset", fileName, source: compressed });
						emittedNames.add(fileName);
					}
				}
			},
		},
	};
}

function matchesFilter(fileName: string, filter: RegExp | ((fileName: string) => boolean)): boolean {
	if (typeof filter === "function") return filter(fileName);
	filter.lastIndex = 0;
	return filter.test(fileName);
}

function outputToBuffer(output: CompressibleOutput): Buffer {
	if (output.type === "chunk") return Buffer.from(output.code);
	return typeof output.source === "string" ? Buffer.from(output.source) : Buffer.from(output.source);
}
