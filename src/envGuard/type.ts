/** 单个环境变量的存在性、格式和值域规则。 */
export interface EnvRule {
	/** 是否必须存在；只控制 `undefined`，不允许空值时仍由 `allowEmpty` 单独校验。 @defaultValue `true` */
	required?: boolean;
	/** 是否允许已提供的空字符串，与 `required` 相互独立。 @defaultValue `false` */
	allowEmpty?: boolean;
	/** 字符串必须匹配的正则表达式。 */
	pattern?: RegExp;
	/** 允许值白名单。 */
	values?: readonly string[];
	/** 自定义校验；返回字符串可提供具体错误原因。 */
	validate?: (value: string | undefined, environment: Readonly<Record<string, string | undefined>>) => boolean | string;
	/** 面向维护者的变量用途说明，不会读取或输出变量值。 */
	description?: string;
}

/** 环境变量名称到校验规则的映射；`true` 表示使用默认必填规则。 */
export type EnvSchema = Readonly<Record<string, true | EnvRule>>;

/** 不包含变量值的单条环境校验问题。 */
export interface EnvValidationIssue {
	/** 未通过校验的变量名。 */
	key: string;
	/** 可安全写入日志的失败原因。 */
	message: string;
}

/** `envGuard` 的配置 */
export interface EnvGuardPluginOptions {
	/** 要校验的环境变量规则。 */
	schema: EnvSchema;
	/** 跳过校验的 Vite mode。 */
	skipModes?: readonly string[];
	/** 校验失败行为。 @defaultValue `"error"` */
	onInvalid?: "error" | "warn";
}
