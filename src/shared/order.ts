import type { ResolvedConfig } from "vite";

const POST_BUILD_ORDER = ["fast-vite:subresource-integrity", "fast-vite:bundle-budget", "fast-vite:compression"] as const;

/** 校验会修改或测量最终产物的插件顺序，避免预算和预压缩读取到错误阶段的内容。 */
export function assertPostBuildPluginOrder(config: ResolvedConfig): void {
	const positions = new Map<string, number>();
	for (const [index, plugin] of config.plugins.entries()) {
		if (POST_BUILD_ORDER.includes(plugin.name as (typeof POST_BUILD_ORDER)[number])) positions.set(plugin.name, index);
	}
	for (let index = 1; index < POST_BUILD_ORDER.length; index += 1) {
		const previous = POST_BUILD_ORDER[index - 1];
		const current = POST_BUILD_ORDER[index];
		if (!previous || !current) continue;
		const previousPosition = positions.get(previous);
		const currentPosition = positions.get(current);
		if (previousPosition !== undefined && currentPosition !== undefined && previousPosition > currentPosition) {
			throw new Error(
				"[fast-vite] Output plugin order must be subresource-integrity -> bundle-budget -> compression. Configure plugins in this order."
			);
		}
	}
}
