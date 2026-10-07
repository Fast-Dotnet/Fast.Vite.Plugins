import { compressBytes } from "../shared/compression";
import { compareStrings } from "../shared/naming";
import { assertPostBuildPluginOrder } from "../shared/order";
import type { Plugin } from "vite";
import type {
	BundleBudgetEvaluation,
	BundleBudgetFilter,
	BundleBudgetPluginOptions,
	BundleBudgetRule,
	BundleOutputType,
	BundleSizeMode,
	MeasurableBundleOutput,
} from "./type";

export type { BundleBudgetFilter, BundleBudgetPluginOptions, BundleBudgetRule, BundleOutputType, BundleSizeMode } from "./type";

const DEFAULT_FILTER = /^(?!.*(?:\.br|\.gz|\.map)$).+/i;

/**
 * 评估一组构建产物是否满足声明的体积预算。
 *
 * gzip/Brotli 大小使用 Node.js 原生 zlib 实际压缩后计算，不以估算值替代。预算保持声明顺序，
 * 匹配的文件始终按文件名稳定排序。
 *
 * @param outputs - 已生成的 chunk 与 asset 内容。
 * @param budgets - 要执行的预算规则。
 * @returns 每条规则的测量值、匹配文件和超限状态。
 */
async function evaluateBundleBudgets(
	outputs: readonly MeasurableBundleOutput[],
	budgets: readonly BundleBudgetRule[]
): Promise<BundleBudgetEvaluation[]> {
	validateBudgets(budgets);
	const sizeCache = new Map<string, Promise<number>>();
	const sortedOutputs = [...outputs].sort((left, right) => compareStrings(left.fileName, right.fileName));

	return Promise.all(
		budgets.map(async (budget, index) => {
			const mode = budget.mode ?? "raw";
			const scope = budget.scope ?? "file";
			const filter = budget.filter ?? DEFAULT_FILTER;
			const matchingOutputs = sortedOutputs.filter((output) => matchesFilter(output.fileName, output.type, filter));
			const files = await Promise.all(
				matchingOutputs.map(async (output) => ({
					fileName: output.fileName,
					bytes: await measureOutput(output, mode, sizeCache),
					type: output.type,
				}))
			);
			const actualBytes =
				scope === "total" ? files.reduce((total, file) => total + file.bytes, 0) : Math.max(0, ...files.map((file) => file.bytes));
			const missingMatch = files.length === 0 && budget.requireMatch === true;
			const exceeded = missingMatch || (scope === "total" ? actualBytes > budget.limit : files.some((file) => file.bytes > budget.limit));

			return {
				name: budget.name ?? `budget-${index + 1}`,
				limit: budget.limit,
				mode,
				scope,
				files,
				actualBytes,
				exceeded,
				missingMatch,
			};
		})
	);
}

/**
 * 为 Vite 构建增加可执行的产物体积预算。
 *
 * 与 Vite 自带的 chunk 警告不同，本插件可检查任意产物、合计多个文件、使用真实压缩
 * 体积，并在 CI 中让超限构建失败。插件只在生产构建运行。
 *
 * @param options - 预算规则及超限处理方式。
 * @returns 可直接加入 Vite `plugins` 的构建体积预算插件。
 * @throws 预算为空、名称冲突、枚举或数值无效，以及构建超限时抛出异常。
 */
export function bundleBudget(options: BundleBudgetPluginOptions): Plugin {
	validateBudgets(options.budgets);
	const configuredOnExceed: unknown = options.onExceed;
	if (configuredOnExceed !== undefined && configuredOnExceed !== "error" && configuredOnExceed !== "warn") {
		throw new Error("[fast-vite:bundle-budget] onExceed must be error or warn.");
	}

	return {
		name: "fast-vite:bundle-budget",
		apply: "build",
		enforce: "post",
		configResolved: assertPostBuildPluginOrder,
		generateBundle: {
			order: "post",
			async handler(_outputOptions, bundle): Promise<void> {
				const outputs: MeasurableBundleOutput[] = Object.values(bundle).map((output) => ({
					fileName: output.fileName,
					type: output.type,
					source: output.type === "chunk" ? output.code : output.source,
				}));
				const evaluations = await evaluateBundleBudgets(outputs, options.budgets);
				const failures = evaluations.filter((evaluation) => evaluation.exceeded);
				if (failures.length === 0) return;

				const message = formatFailures(failures);
				if (options.onExceed === "warn") this.warn(message);
				else this.error(message);
			},
		},
	};
}

function validateBudgets(budgets: readonly BundleBudgetRule[]): void {
	const configuredBudgets: unknown = budgets;
	if (!Array.isArray(configuredBudgets)) throw new Error("[fast-vite:bundle-budget] budgets must be an array.");
	if (budgets.length === 0) throw new Error("[fast-vite:bundle-budget] budgets must contain at least one budget rule.");
	const configuredNames = new Set<string>();

	for (const [index, budget] of budgets.entries()) {
		const name = budget.name ?? `budget-${index + 1}`;
		if (!name.trim()) throw new Error(`[fast-vite:bundle-budget] Budget ${index + 1}: name must not be empty.`);
		if (configuredNames.has(name)) throw new Error(`[fast-vite:bundle-budget] Duplicate budget name: ${name}`);
		configuredNames.add(name);
		if (!Number.isSafeInteger(budget.limit) || budget.limit < 0) {
			throw new Error(`[fast-vite:bundle-budget] Budget ${index + 1}: limit must be a non-negative safe integer.`);
		}
		const configuredScope: unknown = budget.scope;
		if (configuredScope !== undefined && configuredScope !== "file" && configuredScope !== "total") {
			throw new Error(`[fast-vite:bundle-budget] Budget ${index + 1}: scope must be file or total.`);
		}
		const configuredMode: unknown = budget.mode;
		if (configuredMode !== undefined && configuredMode !== "raw" && configuredMode !== "gzip" && configuredMode !== "brotli") {
			throw new Error(`[fast-vite:bundle-budget] Budget ${index + 1}: mode must be raw, gzip, or brotli.`);
		}
	}
}

function matchesFilter(fileName: string, type: BundleOutputType, filter: BundleBudgetFilter): boolean {
	if (typeof filter === "function") return filter(fileName, type);
	filter.lastIndex = 0;
	return filter.test(fileName);
}

async function measureOutput(output: MeasurableBundleOutput, mode: BundleSizeMode, cache: Map<string, Promise<number>>): Promise<number> {
	const key = `${mode}\0${output.type}\0${output.fileName}`;
	const cached = cache.get(key);
	if (cached) return cached;

	const content = typeof output.source === "string" ? Buffer.from(output.source) : Buffer.from(output.source);
	const measurement = mode === "raw" ? Promise.resolve(content.byteLength) : compressBytes(content, mode).then((value) => value.byteLength);
	cache.set(key, measurement);
	return measurement;
}

function formatFailures(evaluations: readonly BundleBudgetEvaluation[]): string {
	const lines = ["[fast-vite:bundle-budget] Build output budget checks failed:"];
	for (const evaluation of evaluations) {
		if (evaluation.missingMatch) {
			lines.push(`- ${evaluation.name}: requireMatch is enabled, but no build outputs matched`);
			continue;
		}
		if (evaluation.scope === "total") {
			lines.push(`- ${evaluation.name}: total ${formatBytes(evaluation.actualBytes)} > ${formatBytes(evaluation.limit)} (${evaluation.mode})`);
			continue;
		}
		for (const file of evaluation.files.filter((item) => item.bytes > evaluation.limit)) {
			lines.push(`- ${evaluation.name}: ${file.fileName}: ${formatBytes(file.bytes)} > ${formatBytes(evaluation.limit)} (${evaluation.mode})`);
		}
	}
	return lines.join("\n");
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kibibytes = bytes / 1024;
	if (kibibytes < 1024) return `${kibibytes.toFixed(2)} KiB`;
	return `${(kibibytes / 1024).toFixed(2)} MiB`;
}
