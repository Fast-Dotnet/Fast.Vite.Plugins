import path from "node:path";
import { loadEnv } from "vite";
import type { Plugin } from "vite";
import type { EnvGuardPluginOptions, EnvRule, EnvSchema, EnvValidationIssue } from "./type";

export type { EnvGuardPluginOptions, EnvRule, EnvSchema } from "./type";

/**
 * 校验环境变量并返回不包含实际值的问题列表。
 *
 * @param schema - 变量名与对应校验规则。
 * @param environment - 待校验的只读键值映射。
 * @returns 按 schema 声明顺序排列的问题。
 */
function validateEnvironment(schema: EnvSchema, environment: Readonly<Record<string, string | undefined>>): EnvValidationIssue[] {
	const issues: EnvValidationIssue[] = [];

	for (const [key, configuredRule] of Object.entries(schema)) {
		const rule: EnvRule = configuredRule === true ? {} : configuredRule;
		const value = environment[key];
		if (value === undefined && rule.required !== false) {
			issues.push({ key, message: "Required variable is missing" });
			continue;
		}
		if (value === undefined) continue;
		if (value.length === 0 && rule.allowEmpty !== true) {
			issues.push({ key, message: "Variable is empty; set allowEmpty: true to allow empty strings" });
			continue;
		}

		if (rule.pattern) {
			rule.pattern.lastIndex = 0;
			if (!rule.pattern.test(value)) issues.push({ key, message: "Value does not match pattern" });
		}
		if (rule.values && !rule.values.includes(value)) issues.push({ key, message: `Value must be one of: ${rule.values.join(", ")}` });
		if (rule.validate) {
			const result = rule.validate(value, environment);
			if (result !== true) issues.push({ key, message: typeof result === "string" ? result : "Custom validation failed" });
		}
	}

	return issues;
}

/**
 * 在 Vite 启动和构建前校验环境变量，尽早暴露缺失配置。
 *
 * @param options - 环境变量 schema、跳过模式和失败处理方式。
 * @returns 可直接加入 Vite `plugins` 的环境变量校验插件。
 * @throws schema、空值规则或失败枚举无效时抛出异常。
 */
export function envGuard(options: EnvGuardPluginOptions): Plugin {
	const configuredSchema: unknown = options.schema;
	if (
		typeof configuredSchema !== "object" ||
		configuredSchema === null ||
		Array.isArray(configuredSchema) ||
		Object.keys(configuredSchema).length === 0
	) {
		throw new Error("[fast-vite:env-guard] schema must contain at least one environment variable rule.");
	}
	const configuredOnInvalid: unknown = options.onInvalid;
	if (configuredOnInvalid !== undefined && configuredOnInvalid !== "error" && configuredOnInvalid !== "warn") {
		throw new Error("[fast-vite:env-guard] onInvalid must be error or warn.");
	}
	if (options.skipModes?.some((mode) => !mode.trim())) throw new Error("[fast-vite:env-guard] skipModes must not contain empty modes.");
	for (const [key, rule] of Object.entries(options.schema)) {
		if (!key.trim()) throw new Error("[fast-vite:env-guard] Environment variable names must not be empty.");
		const configuredRule: unknown = rule;
		if (configuredRule !== true && (typeof configuredRule !== "object" || configuredRule === null || Array.isArray(configuredRule))) {
			throw new Error(`[fast-vite:env-guard] The rule for ${key} must be true or an object.`);
		}
		if (rule !== true && rule.values?.length === 0) {
			throw new Error(`[fast-vite:env-guard] values must not be an empty array for ${key}.`);
		}
	}
	return {
		name: "fast-vite:env-guard",
		config(config, env): void {
			if (options.skipModes?.includes(env.mode)) return;
			const root = path.resolve(config.root ?? process.cwd());
			const loaded = config.envDir === false ? {} : loadEnv(env.mode, path.resolve(root, config.envDir ?? "."), "");
			const environment: Record<string, string | undefined> = { ...loaded, ...process.env };
			const issues = validateEnvironment(options.schema, environment);
			if (issues.length === 0) return;

			const message = `[fast-vite:env-guard] Environment variable validation failed:\n${issues.map((issue) => `- ${issue.key}: ${issue.message}`).join("\n")}`;
			if (options.onInvalid === "warn") this.warn(message);
			else this.error(message);
		},
	};
}
