import { describe, expect, it } from "vitest";
import { serializeInspectorState } from "../inspectorSerializer";

describe("bounded DevTools serializer", () => {
	it("handles cycles and non-JSON runtime values without failing the whole state", () => {
		const state: Record<string, unknown> = {
			big: 42n,
			fn: function named() {},
			symbol: Symbol("token"),
			regex: /abc/gi,
			error: new Error("boom"),
			map: new Map([["a", 1]]),
			set: new Set([1, 2]),
			typed: new Uint8Array([1, 2, 3]),
		};
		state.self = state;

		const serialized = serializeInspectorState(state);
		expect(serialized).toContain("[Circular -> $]");
		expect(serialized).toContain("42n");
		expect(serialized).toContain("Function: named");
		expect(serialized).toContain("RegExp");
		expect(serialized).toContain("Uint8Array");
	});

	it("serializes valid and invalid dates without relying on Date JSON hooks", () => {
		expect(
			serializeInspectorState(new Date("2026-01-02T03:04:05.000Z")),
		).toContain("2026-01-02T03:04:05.000Z");
		expect(serializeInspectorState(new Date("not a date"))).toContain(
			"Invalid Date",
		);
	});

	it("enforces depth, node, array, object-key, and string budgets", () => {
		const serialized = serializeInspectorState(
			{
				deep: { a: { b: { c: true } } },
				array: [1, 2, 3, 4],
				object: { a: 1, b: 2, c: 3 },
			},
			{
				maxDepth: 2,
				maxNodes: 20,
				maxArrayLength: 2,
				maxObjectKeys: 2,
				maxStringLength: 10,
			},
		);
		expect(serialized).toContain("Truncated");
		expect(
			serializeInspectorState("x".repeat(100), { maxStringLength: 10 }),
		).toContain("chars truncated");
	});

	it("describes accessors without invoking getters", () => {
		let reads = 0;
		const state = {} as Record<string, unknown>;
		Object.defineProperty(state, "bad", {
			enumerable: true,
			get() {
				reads++;
				throw new Error("getter exploded");
			},
		});
		const serialized = serializeInspectorState(state);
		expect(serialized).toContain("[Getter]");
		expect(serialized).not.toContain("getter exploded");
		expect(reads).toBe(0);
	});

	it("normalizes invalid and excessive custom limits", () => {
		const serialized = serializeInspectorState(
			{ value: "abcdef", nested: { ok: true } },
			{ maxStringLength: -10, maxDepth: Number.NaN, maxNodes: Infinity },
		);
		expect(serialized).toContain("chars truncated");
		expect(serialized).toContain("nested");
	});
});
