import type { FrameEntry } from "./types";

/** Resource limits used by DevTools inspection. */
export interface InspectorLimits {
	maxDepth: number;
	maxNodes: number;
	maxArrayLength: number;
	maxObjectKeys: number;
	maxStringLength: number;
	maxTreeDepth: number;
	maxTreeNodes: number;
}

/** Conservative defaults that keep inspection work bounded during rendering. */
export const DEFAULT_INSPECTOR_LIMITS: Readonly<InspectorLimits> = {
	maxDepth: 8,
	maxNodes: 1000,
	maxArrayLength: 100,
	maxObjectKeys: 100,
	maxStringLength: 2000,
	maxTreeDepth: 64,
	maxTreeNodes: 2000,
};

type Inspectable =
	| null
	| boolean
	| number
	| string
	| Inspectable[]
	| { [key: string]: Inspectable };

interface SerializationContext {
	limits: InspectorLimits;
	seen: WeakMap<object, string>;
	nodes: number;
}

function truncateString(value: string, limit: number): string {
	if (value.length <= limit) return value;
	return `${value.slice(0, limit)}… <${value.length - limit} chars truncated>`;
}

const INSPECTOR_LIMIT_CEILINGS: Readonly<InspectorLimits> = {
	maxDepth: 64,
	maxNodes: 100_000,
	maxArrayLength: 10_000,
	maxObjectKeys: 10_000,
	maxStringLength: 100_000,
	maxTreeDepth: 256,
	maxTreeNodes: 100_000,
};

function normalizeLimit(
	value: number | undefined,
	fallback: number,
	ceiling: number,
): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.floor(value), 0), ceiling);
}

function normalizeLimits(
	overrides?: Partial<InspectorLimits>,
): InspectorLimits {
	return {
		maxDepth: normalizeLimit(
			overrides?.maxDepth,
			DEFAULT_INSPECTOR_LIMITS.maxDepth,
			INSPECTOR_LIMIT_CEILINGS.maxDepth,
		),
		maxNodes: normalizeLimit(
			overrides?.maxNodes,
			DEFAULT_INSPECTOR_LIMITS.maxNodes,
			INSPECTOR_LIMIT_CEILINGS.maxNodes,
		),
		maxArrayLength: normalizeLimit(
			overrides?.maxArrayLength,
			DEFAULT_INSPECTOR_LIMITS.maxArrayLength,
			INSPECTOR_LIMIT_CEILINGS.maxArrayLength,
		),
		maxObjectKeys: normalizeLimit(
			overrides?.maxObjectKeys,
			DEFAULT_INSPECTOR_LIMITS.maxObjectKeys,
			INSPECTOR_LIMIT_CEILINGS.maxObjectKeys,
		),
		maxStringLength: normalizeLimit(
			overrides?.maxStringLength,
			DEFAULT_INSPECTOR_LIMITS.maxStringLength,
			INSPECTOR_LIMIT_CEILINGS.maxStringLength,
		),
		maxTreeDepth: normalizeLimit(
			overrides?.maxTreeDepth,
			DEFAULT_INSPECTOR_LIMITS.maxTreeDepth,
			INSPECTOR_LIMIT_CEILINGS.maxTreeDepth,
		),
		maxTreeNodes: normalizeLimit(
			overrides?.maxTreeNodes,
			DEFAULT_INSPECTOR_LIMITS.maxTreeNodes,
			INSPECTOR_LIMIT_CEILINGS.maxTreeNodes,
		),
	};
}

function inspectValue(
	value: unknown,
	context: SerializationContext,
	depth: number,
	path: string,
): Inspectable {
	if (value === null) return null;
	if (typeof value === "string")
		return truncateString(value, context.limits.maxStringLength);
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "undefined") return "[undefined]";
	if (typeof value === "bigint") return `${value}n`;
	if (typeof value === "symbol")
		return `[Symbol${value.description ? `: ${value.description}` : ""}]`;
	if (typeof value === "function")
		return `[Function: ${value.name || "anonymous"}]`;
	if (typeof value !== "object") return String(value);

	const circularPath = context.seen.get(value);
	if (circularPath) return `[Circular -> ${circularPath}]`;
	if (context.nodes >= context.limits.maxNodes)
		return `[Truncated: maxNodes=${context.limits.maxNodes}]`;
	if (depth >= context.limits.maxDepth)
		return `[Truncated: maxDepth=${context.limits.maxDepth}]`;

	context.nodes++;
	context.seen.set(value, path);

	if (value instanceof Date) {
		return Number.isNaN(value.getTime())
			? { __type: "Date", value: "Invalid Date" }
			: { __type: "Date", value: value.toISOString() };
	}
	if (value instanceof RegExp)
		return { __type: "RegExp", value: String(value) };
	if (value instanceof Error) {
		return {
			__type: "Error",
			name: value.name,
			message: truncateString(value.message, context.limits.maxStringLength),
			...(value.stack
				? {
						stack: truncateString(
							value.stack,
							context.limits.maxStringLength * 2,
						),
					}
				: {}),
		};
	}
	if (value instanceof Map) {
		const entries: Inspectable[] = [];
		let index = 0;
		for (const [key, entryValue] of value) {
			if (index >= context.limits.maxArrayLength) break;
			entries.push([
				inspectValue(key, context, depth + 1, `${path}.<map-key:${index}>`),
				inspectValue(
					entryValue,
					context,
					depth + 1,
					`${path}.<map-value:${index}>`,
				),
			]);
			index++;
		}
		if (value.size > index)
			entries.push(`[${value.size - index} map entries truncated]`);
		return { __type: "Map", size: value.size, entries };
	}
	if (value instanceof Set) {
		const values: Inspectable[] = [];
		let index = 0;
		for (const entryValue of value) {
			if (index >= context.limits.maxArrayLength) break;
			values.push(
				inspectValue(entryValue, context, depth + 1, `${path}.<set:${index}>`),
			);
			index++;
		}
		if (value.size > index)
			values.push(`[${value.size - index} set values truncated]`);
		return { __type: "Set", size: value.size, values };
	}
	if (ArrayBuffer.isView(value)) {
		if (value instanceof DataView) {
			return { __type: "DataView", byteLength: value.byteLength };
		}
		const arrayLike = value as unknown as ArrayLike<unknown>;
		const length = Math.min(arrayLike.length, context.limits.maxArrayLength);
		const values: Inspectable[] = [];
		for (let index = 0; index < length; index++) {
			values.push(
				inspectValue(arrayLike[index], context, depth + 1, `${path}[${index}]`),
			);
		}
		if (arrayLike.length > length)
			values.push(`[${arrayLike.length - length} values truncated]`);
		return {
			__type: value.constructor.name,
			length: arrayLike.length,
			values,
		};
	}
	if (value instanceof ArrayBuffer) {
		return { __type: "ArrayBuffer", byteLength: value.byteLength };
	}
	if (Array.isArray(value)) {
		const result: Inspectable[] = [];
		const length = Math.min(value.length, context.limits.maxArrayLength);
		for (let index = 0; index < length; index++) {
			result.push(
				inspectValue(value[index], context, depth + 1, `${path}[${index}]`),
			);
		}
		if (value.length > length)
			result.push(`[${value.length - length} array items truncated]`);
		return result;
	}

	const result: Record<string, Inspectable> = {};
	let keys: string[];
	try {
		keys = Object.keys(value);
	} catch (error) {
		return `[Uninspectable object: ${error instanceof Error ? error.message : String(error)}]`;
	}

	const limit = Math.min(keys.length, context.limits.maxObjectKeys);
	let typeName = "Object";
	try {
		typeName = value.constructor?.name || "Object";
	} catch {
		// Proxies can throw while reading constructor. Keep the safe default.
	}
	if (typeName !== "Object") result.__type = typeName;

	for (let index = 0; index < limit; index++) {
		const key = keys[index];
		if (key === undefined) continue;
		let descriptor: PropertyDescriptor | undefined;
		try {
			descriptor = Object.getOwnPropertyDescriptor(value, key);
		} catch (error) {
			result[key] =
				`[Property descriptor threw: ${error instanceof Error ? error.message : String(error)}]`;
			continue;
		}

		if (!descriptor) {
			result[key] = "[Unavailable property descriptor]";
			continue;
		}

		if (descriptor.get || descriptor.set) {
			result[key] = descriptor.get
				? descriptor.set
					? "[Getter/Setter]"
					: "[Getter]"
				: "[Setter]";
			continue;
		}

		result[key] = inspectValue(
			descriptor.value,
			context,
			depth + 1,
			`${path}.${key}`,
		);
	}
	if (keys.length > limit)
		result["…"] = `[${keys.length - limit} object keys truncated]`;
	return result;
}

/** Serialize arbitrary state without allowing cycles or huge values to block DevTools. */
export function serializeInspectorState(
	state: unknown,
	overrides?: Partial<InspectorLimits>,
): string {
	const limits = normalizeLimits(overrides);
	try {
		const normalized = inspectValue(
			state,
			{ limits, seen: new WeakMap(), nodes: 0 },
			0,
			"$",
		);
		return JSON.stringify(normalized, null, 2);
	} catch (error) {
		return `<uninspectable: ${error instanceof Error ? error.message : String(error)}>`;
	}
}

/** Serialize the widget tree iteratively with explicit node/depth budgets. */
export function serializeInspectorTree(
	entries: readonly FrameEntry[],
	overrides?: Partial<InspectorLimits>,
): string {
	const limits = normalizeLimits(overrides);
	const lines: string[] = [];
	const stack: Array<{ entry: FrameEntry; depth: number }> = [];
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry) stack.push({ entry, depth: 0 });
	}

	let visited = 0;
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) break;
		if (visited >= limits.maxTreeNodes) {
			lines.push(`[tree truncated: maxTreeNodes=${limits.maxTreeNodes}]`);
			break;
		}
		visited++;
		const indent = "  ".repeat(Math.min(current.depth, limits.maxTreeDepth));
		lines.push(`${indent}${current.entry.widgetName} (${current.entry.id})`);
		if (current.depth >= limits.maxTreeDepth) {
			if (current.entry.children.length > 0)
				lines.push(
					`${indent}  [children truncated: maxTreeDepth=${limits.maxTreeDepth}]`,
				);
			continue;
		}
		for (let index = current.entry.children.length - 1; index >= 0; index--) {
			const child = current.entry.children[index];
			if (child) stack.push({ entry: child, depth: current.depth + 1 });
		}
	}
	return lines.join("\n");
}
