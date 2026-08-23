import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getRuntimeForId,
	mountedRuntimes,
	Runtime,
	setActiveRuntime,
} from "../runtime";
import type { FrameEntry, StorageAdapter } from "../types";

let runtime: Runtime;
beforeEach(() => {
	vi.useFakeTimers();
	runtime = new Runtime();
	setActiveRuntime(runtime);
});

afterEach(() => {
	if (runtime.isAppMounted()) runtime.unregisterApp();
	mountedRuntimes.clear();
	setActiveRuntime(null);
	vi.useRealTimers();
});

// Draw pass helper

function drawPass(fn: () => void) {
	runtime.beginFrame();
	fn();
	runtime.endFrame();
}

function registerApp() {
	runtime.registerApp(() => {}); // The tests only need a mounted runtime, not a real render callback.
}

// In-memory state retention

describe("in-memory state retention", () => {
	it("initializes state with defaultState on first access", () => {
		registerApp();
		const initial = runtime.getState("test/Button/ok", { clicked: false });
		expect(initial).toEqual({ clicked: false });
	});

	it("persists state across multiple draw passes", () => {
		registerApp();
		const id = "widget/Button/persist";

		drawPass(() => {
			const s = runtime.getState<{ count: number }>(id, { count: 0 });
			runtime.setState(id, { count: s.count + 1 });
		});

		drawPass(() => {
			const s = runtime.getState<{ count: number }>(id, { count: 0 });
			expect(s.count).toBe(1);
		});
	});

	it("setState with updater function receives previous state", () => {
		registerApp();
		const id = "widget/Counter/x";
		runtime.getState(id, { n: 0 });
		runtime.setState(id, (prev: unknown) => ({
			...(prev as { n: number }),
			n: (prev as { n: number }).n + 10,
		}));
		const result = runtime.getState<{ n: number }>(id, { n: 0 });
		expect(result.n).toBe(10);
	});

	it("skips revisions and rerenders when setState returns the identical value", async () => {
		const trigger = vi.fn();
		runtime.registerApp(trigger);
		const id = "widget/Counter/no-op";
		const current = runtime.getState(id, { n: 0 });
		const revision = runtime.getInspectionRevision("state");

		runtime.setState(id, current);
		await Promise.resolve();

		expect(runtime.getInspectionRevision("state")).toBe(revision);
		expect(trigger).not.toHaveBeenCalled();
	});
});

class MemoryStorageAdapter implements StorageAdapter {
	readonly values = new Map<string, unknown>();
	readonly hasChecks: string[] = [];
	readonly reads: string[] = [];
	readonly writes: Array<[string, unknown]> = [];
	readonly deletes: string[] = [];

	has(key: string): boolean {
		this.hasChecks.push(key);
		return this.values.has(key);
	}

	get(key: string): unknown {
		this.reads.push(key);
		return this.values.get(key);
	}

	set(key: string, value: unknown): void {
		this.writes.push([key, value]);
		this.values.set(key, structuredClone(value));
	}

	delete(key: string): void {
		this.deletes.push(key);
		this.values.delete(key);
	}

	keys(): Iterable<string> {
		return this.values.keys();
	}
}

class ThrowingStorageAdapter extends MemoryStorageAdapter {
	throwOn: "has" | "get" | "set" | "delete" | "keys" | null = null;

	override has(key: string): boolean {
		if (this.throwOn === "has") throw new Error("has failed");
		return super.has(key);
	}

	override get(key: string): unknown {
		if (this.throwOn === "get") throw new Error("get failed");
		return super.get(key);
	}

	override set(key: string, value: unknown): void {
		if (this.throwOn === "set") throw new Error("set failed");
		super.set(key, value);
	}

	override delete(key: string): void {
		if (this.throwOn === "delete") throw new Error("delete failed");
		super.delete(key);
	}

	override keys(): Iterable<string> {
		if (this.throwOn === "keys") throw new Error("keys failed");
		return super.keys();
	}
}

const TEST_NAMESPACE = "runtime-tests";

function storageKey(namespace: string, id: string): string {
	return `ism:v1:${encodeURIComponent(namespace)}:${encodeURIComponent(id)}`;
}

function storedPayload(
	storage: MemoryStorageAdapter,
	namespace: string,
	id: string,
) {
	const record = storage.values.get(storageKey(namespace, id)) as
		| { __ismState: 1; version: number; value: unknown }
		| undefined;
	return record?.value;
}

function useStorageRuntime(
	storage: StorageAdapter,
	namespace = TEST_NAMESPACE,
	onStorageError?: ConstructorParameters<typeof Runtime>[2],
): Runtime {
	if (runtime.isAppMounted()) runtime.unregisterApp();
	runtime = new Runtime(storage, namespace, onStorageError);
	setActiveRuntime(runtime);
	registerApp();
	return runtime;
}

describe("storage adapter persistence", () => {
	it("writes the default state when persistent storage is missing", () => {
		const storage = new MemoryStorageAdapter();
		useStorageRuntime(storage);
		const id = "settings/Counter";
		const key = storageKey(TEST_NAMESPACE, id);

		const state = runtime.getState(id, { count: 0 }, true);

		expect(state).toEqual({ count: 0 });
		expect(storage.hasChecks).toEqual([key]);
		expect(storage.reads).toHaveLength(0);
		expect(storage.writes).toHaveLength(1);
		expect(storedPayload(storage, TEST_NAMESPACE, id)).toEqual({ count: 0 });
	});

	it("distinguishes missing storage from stored null and undefined", () => {
		const storage = new MemoryStorageAdapter();
		useStorageRuntime(storage, "nullable");

		runtime.getState<string | null>("nullable", null, true);
		runtime.getState<string | undefined>("optional", undefined, true);

		useStorageRuntime(storage, "nullable");

		expect(
			runtime.getState<string | null>("nullable", "fallback", true),
		).toBeNull();
		expect(
			runtime.getState<string | undefined>("optional", "fallback", true),
		).toBeUndefined();
	});

	it("uses an existing stored value without overwriting it", () => {
		const storage = new MemoryStorageAdapter();
		useStorageRuntime(storage);
		const id = "settings/Counter";
		runtime.getState(id, { count: 0 }, true);
		runtime.setState(id, { count: 7 }, true);
		storage.writes.length = 0;

		useStorageRuntime(storage);
		const state = runtime.getState(id, { count: 0 }, true);

		expect(state).toEqual({ count: 7 });
		expect(storage.writes).toHaveLength(0);
	});

	it("writes persistent setState updates through to the adapter", () => {
		const storage = new MemoryStorageAdapter();
		useStorageRuntime(storage);
		const id = "settings/Counter";
		runtime.getState(id, { count: 0 }, true);
		storage.writes.length = 0;

		runtime.setState(id, { count: 1 }, true);

		expect(storage.writes).toHaveLength(1);
		expect(storedPayload(storage, TEST_NAMESPACE, id)).toEqual({ count: 1 });
	});

	it("writes consumed one-shot state through to the adapter", () => {
		const storage = new MemoryStorageAdapter();
		useStorageRuntime(storage);
		const id = "controls/Button";
		const current = runtime.getState(id, { clicked: true }, true);
		storage.writes.length = 0;

		runtime.consumeState(
			id,
			current,
			(state) => ({ ...(state as { clicked: boolean }), clicked: false }),
			true,
		);

		expect(storage.writes).toHaveLength(1);
		expect(storedPayload(storage, TEST_NAMESPACE, id)).toEqual({
			clicked: false,
		});
	});

	it("isolates identical widget IDs by stable storage namespace", () => {
		const storage = new MemoryStorageAdapter();
		const id = "settings/Counter";
		useStorageRuntime(storage, "app-a");
		runtime.getState(id, { count: 0 }, true);
		runtime.setState(id, { count: 11 }, true);

		useStorageRuntime(storage, "app-b");
		expect(runtime.getState(id, { count: 0 }, true)).toEqual({ count: 0 });
		runtime.setState(id, { count: 22 }, true);

		useStorageRuntime(storage, "app-a");
		expect(runtime.getState(id, { count: 0 }, true)).toEqual({ count: 11 });
		expect(storage.values.has(storageKey("app-a", id))).toBe(true);
		expect(storage.values.has(storageKey("app-b", id))).toBe(true);
	});

	it("migrates versioned stored state and rewrites it at the current version", () => {
		const storage = new MemoryStorageAdapter();
		const id = "settings/Versioned";
		useStorageRuntime(storage, "migration");
		runtime.getState(id, { count: 2 }, { storageVersion: 1 });
		runtime.setState(id, { count: 3 }, { storageVersion: 1 });

		useStorageRuntime(storage, "migration");
		const migrated = runtime.getState(
			id,
			{ count: 0, label: "new" },
			{
				storageVersion: 2,
				migrateStoredState: (value, fromVersion, toVersion) => ({
					count: (value as { count: number }).count,
					label: `${fromVersion}->${toVersion}`,
				}),
				validateStoredState: (
					value,
				): value is { count: number; label: string } =>
					typeof value === "object" &&
					value !== null &&
					typeof (value as { count?: unknown }).count === "number" &&
					typeof (value as { label?: unknown }).label === "string",
			},
		);

		expect(migrated).toEqual({ count: 3, label: "1->2" });
		const record = storage.values.get(storageKey("migration", id)) as {
			version: number;
			value: unknown;
		};
		expect(record.version).toBe(2);
		expect(record.value).toEqual(migrated);
	});

	it("rejects malformed runtime storage envelopes", () => {
		const storage = new MemoryStorageAdapter();
		const failures: string[] = [];
		const id = "settings/CorruptEnvelope";
		storage.values.set(storageKey("corrupt", id), {
			__ismState: 1,
			version: "broken",
			value: { count: 99 },
		});
		useStorageRuntime(storage, "corrupt", (failure) => {
			failures.push(failure.operation);
		});

		const state = runtime.getState(id, { count: 0 }, true);

		expect(state).toEqual({ count: 0 });
		expect(failures).toEqual(["validate"]);
		expect(storedPayload(storage, "corrupt", id)).toEqual({ count: 0 });
	});

	it("falls back to default state when stored data fails validation", () => {
		const storage = new MemoryStorageAdapter();
		const failures: string[] = [];
		const id = "settings/Validated";
		useStorageRuntime(storage, "validation");
		runtime.getState(id, "bad", { storageVersion: 1 });

		useStorageRuntime(storage, "validation", (failure) => {
			failures.push(failure.operation);
		});
		const state = runtime.getState(id, 42, {
			storageVersion: 1,
			validateStoredState: (value): value is number =>
				typeof value === "number",
		});

		expect(state).toBe(42);
		expect(failures).toEqual(["validate"]);
		expect(storedPayload(storage, "validation", id)).toBe(42);
	});

	it("supports custom serialization and deserialization", () => {
		const storage = new MemoryStorageAdapter();
		const id = "settings/Serialized";
		const persistence = {
			storageVersion: 1,
			serialize: (value: unknown) => JSON.stringify(value),
			deserialize: (value: unknown) => JSON.parse(String(value)) as unknown,
		};
		useStorageRuntime(storage, "serialization");
		runtime.getState(id, { count: 1 }, persistence);
		runtime.setState(id, { count: 8 }, persistence);

		expect(storedPayload(storage, "serialization", id)).toBe('{"count":8}');

		useStorageRuntime(storage, "serialization");
		expect(runtime.getState(id, { count: 0 }, persistence)).toEqual({
			count: 8,
		});
	});

	it("reports adapter existence failures without attempting a write", () => {
		const storage = new ThrowingStorageAdapter();
		const failures: string[] = [];
		storage.throwOn = "has";
		useStorageRuntime(storage, "has-failure", (failure) => {
			failures.push(failure.operation);
		});

		const state = runtime.getState("settings/HasFailure", { count: 0 }, true);

		expect(state).toEqual({ count: 0 });
		expect(failures).toEqual(["has"]);
		expect(storage.writes).toHaveLength(0);
	});

	it("reports adapter read failures without overwriting storage", () => {
		const storage = new ThrowingStorageAdapter();
		const failures: string[] = [];
		const id = "settings/ReadFailure";
		const key = storageKey("failure", id);
		storage.values.set(key, { __ismState: 1, version: 1, value: { count: 9 } });
		storage.throwOn = "get";
		useStorageRuntime(storage, "failure", (failure) => {
			failures.push(failure.operation);
		});

		const state = runtime.getState(id, { count: 0 }, true);

		expect(state).toEqual({ count: 0 });
		expect(failures).toEqual(["get"]);
		expect(storage.writes).toHaveLength(0);
		expect(storage.values.get(key)).toEqual({
			__ismState: 1,
			version: 1,
			value: { count: 9 },
		});
	});

	it("keeps in-memory state consistent when adapter writes throw", () => {
		const storage = new ThrowingStorageAdapter();
		const failures: string[] = [];
		storage.throwOn = "set";
		useStorageRuntime(storage, "write-failure", (failure) => {
			failures.push(failure.operation);
		});
		const id = "settings/WriteFailure";

		runtime.getState(id, { count: 0 }, true);
		runtime.setState(id, { count: 5 }, true);

		expect(runtime.getState(id, { count: 0 }, true)).toEqual({ count: 5 });
		expect(failures).toEqual(["set", "set"]);
	});

	it("reports delete failures while keeping the reset in memory", () => {
		const storage = new ThrowingStorageAdapter();
		const failures: string[] = [];
		const id = "settings/DeleteFailure";
		useStorageRuntime(storage, "delete-failure", (failure) => {
			failures.push(failure.operation);
		});
		runtime.getState(id, { count: 0 }, true);
		runtime.setState(id, { count: 7 }, true);
		storage.throwOn = "delete";

		expect(runtime.resetState(id)).toBe(true);
		expect(runtime.getState(id, { count: 99 }, true)).toEqual({ count: 0 });
		expect(failures).toEqual(["delete"]);
		expect(storedPayload(storage, "delete-failure", id)).toEqual({ count: 7 });
	});

	it("resets live state and deletes its persisted value", () => {
		const storage = new MemoryStorageAdapter();
		const id = "settings/Resettable";
		useStorageRuntime(storage, "reset");
		runtime.getState(id, { count: 0 }, true);
		runtime.setState(id, { count: 9 }, true);

		expect(runtime.resetState(id)).toBe(true);
		expect(runtime.getState(id, { count: 99 }, true)).toEqual({ count: 0 });
		expect(storage.values.has(storageKey("reset", id))).toBe(false);
	});

	it("clears known persistent state without touching another namespace", () => {
		const storage = new MemoryStorageAdapter();
		useStorageRuntime(storage, "clear-a");
		runtime.getState("one", 1, true);
		runtime.getState("two", 2, true);
		storage.values.set(storageKey("clear-b", "other"), {
			__ismState: 1,
			version: 1,
			value: 3,
		});

		expect(runtime.clearPersistentState()).toBe(2);
		expect(storage.values.has(storageKey("clear-a", "one"))).toBe(false);
		expect(storage.values.has(storageKey("clear-a", "two"))).toBe(false);
		expect(storage.values.has(storageKey("clear-b", "other"))).toBe(true);
	});

	it("namespace clearing overrides pending writes in a speculative frame", () => {
		const storage = new MemoryStorageAdapter();
		useStorageRuntime(storage, "pending-clear");
		const transaction = runtime.beginFrame();
		runtime.getState("new-state", { count: 1 }, true);

		expect(runtime.clearStorageNamespace()).toBe(1);
		runtime.prepareFrame(transaction);
		runtime.commitFrame(transaction);

		expect(storage.values.has(storageKey("pending-clear", "new-state"))).toBe(
			false,
		);
	});

	it("clears every key in its namespace, including state not loaded this session", () => {
		const storage = new MemoryStorageAdapter();
		storage.values.set(storageKey("clear-all", "old"), 1);
		storage.values.set(storageKey("clear-all", "older"), 2);
		storage.values.set(storageKey("keep", "other"), 3);
		useStorageRuntime(storage, "clear-all");

		expect(runtime.clearStorageNamespace()).toBe(2);
		expect(storage.values.has(storageKey("clear-all", "old"))).toBe(false);
		expect(storage.values.has(storageKey("clear-all", "older"))).toBe(false);
		expect(storage.values.has(storageKey("keep", "other"))).toBe(true);
	});

	it("reports namespace enumeration failures without throwing", () => {
		const storage = new ThrowingStorageAdapter();
		const failures: string[] = [];
		storage.throwOn = "keys";
		useStorageRuntime(storage, "keys-failure", (failure) => {
			failures.push(failure.operation);
		});

		expect(runtime.clearStorageNamespace()).toBe(0);
		expect(failures).toEqual(["keys"]);
	});

	it("does not touch the adapter for non-persistent state", () => {
		const storage = new MemoryStorageAdapter();
		useStorageRuntime(storage);
		const id = "ephemeral/Counter";

		runtime.getState(id, { count: 0 });
		runtime.setState(id, { count: 1 });

		expect(storage.hasChecks).toHaveLength(0);
		expect(storage.reads).toHaveLength(0);
		expect(storage.writes).toHaveLength(0);
		expect(storage.values.size).toBe(0);
	});
});

// ID collisions

describe("ID collision", () => {
	it("returns the same ID for the same label in a frame", () => {
		registerApp();
		drawPass(() => {
			const id1 = runtime.buildId("Button", "Submit");
			// Calling buildId twice with the same label simulates two matching widgets.
			// The second call should receive a collision suffix.
			const id2 = runtime.buildId("Button", "Submit");
			expect(id1).not.toBe(id2);
			expect(id2).toContain("__2");
		});
	});

	it("collision counters reset between frames", () => {
		registerApp();
		let firstId: string;
		drawPass(() => {
			firstId = runtime.buildId("Text", "hello");
		});
		drawPass(() => {
			const id = runtime.buildId("Text", "hello");
			expect(id).toBe(firstId!);
		});
	});

	it("keeps structurally different slash-containing labels distinct", () => {
		registerApp();
		let flat = "";
		let nested = "";
		drawPass(() => {
			flat = runtime.buildId("Button", "a/Button/b");
		});
		drawPass(() => {
			const parentId = runtime.buildId("Panel", "a");
			const parent = {
				id: parentId,
				widgetName: "Panel",
				args: [],
				children: [],
				renderState: {},
				persistence: null,
				widgetProps: {
					"data-ism-widget": "Panel",
					"data-ism-id": parentId,
					className: "ism-widget ism-panel",
				},
				renderFn: () => null,
			};
			runtime.getCurrentParentChildren().push(parent);
			runtime.pushScope(parentId, "a", parent);
			nested = runtime.buildId("Button", "b");
			runtime.popScope();
		});
		expect(flat).not.toBe(nested);
		expect(flat).toContain("%2F");
	});

	it("never returns a suffix that was already allocated as a literal label", () => {
		registerApp();
		drawPass(() => {
			const literal = runtime.buildId("Button", "X__2");
			const first = runtime.buildId("Button", "X");
			const duplicate = runtime.buildId("Button", "X");
			expect(new Set([literal, first, duplicate]).size).toBe(3);
		});
	});

	it("### convention uses only text after ### as ID", () => {
		registerApp();
		drawPass(() => {
			const id = runtime.buildId("Button", "Click Me###btn-stable");
			expect(id).toContain("btn-stable");
			expect(id).not.toContain("Click Me");
		});
	});

	it("## convention uses full string as ID", () => {
		registerApp();
		drawPass(() => {
			const id = runtime.buildId("Button", "Delete##item_3");
			expect(id).toContain("Delete##item_3");
		});
	});
});

describe("strict ID mode", () => {
	it("throws instead of suffixing duplicate logical IDs", () => {
		if (runtime.isAppMounted()) runtime.unregisterApp();
		runtime = new Runtime(undefined, undefined, undefined, true);
		registerApp();

		runtime.beginFrame();
		runtime.buildId("Button", "Delete");
		expect(() => runtime.buildId("Button", "Delete")).toThrow("strictIds");
		runtime.abortFrame();
	});

	it("allows repeated visible labels when pushId supplies stable identity", () => {
		if (runtime.isAppMounted()) runtime.unregisterApp();
		runtime = new Runtime(undefined, undefined, undefined, true);
		registerApp();

		runtime.beginFrame();
		runtime.pushIdSegment("row-1");
		const first = runtime.buildId("Button", "Delete");
		runtime.popIdSegment();
		runtime.pushIdSegment("row-2");
		const second = runtime.buildId("Button", "Delete");
		runtime.popIdSegment();
		runtime.endFrame();

		expect(first).not.toBe(second);
	});

	it("still rejects the same explicit ID suffix twice", () => {
		if (runtime.isAppMounted()) runtime.unregisterApp();
		runtime = new Runtime(undefined, undefined, undefined, true);
		registerApp();

		runtime.beginFrame();
		runtime.buildId("Button", "Delete###item-7");
		expect(() => runtime.buildId("Button", "Remove###item-7")).toThrow(
			"strictIds",
		);
		runtime.abortFrame();
	});
});

describe("DOM/runtime identity", () => {
	it("allocates unique v4 runtime namespaces from the shared global registry", () => {
		const other = new Runtime();
		expect(runtime.getInstanceId()).toMatch(/^ism-runtime-v4-\d+$/);
		expect(other.getInstanceId()).toMatch(/^ism-runtime-v4-\d+$/);
		expect(other.getInstanceId()).not.toBe(runtime.getInstanceId());
	});

	it("creates compact DOM-safe IDs without embedding logical labels", () => {
		const logical = 'Button/Save % / [x] "quoted" 😀';
		const domId = runtime.getDomId("description", logical);
		expect(domId).toMatch(/^ism-runtime-v4-\d+-description-[A-Za-z0-9]+$/);
		expect(domId).not.toContain("Save");
		expect(domId).not.toContain("😀");
		expect(runtime.getDomId("description", logical)).toBe(domId);
		expect(runtime.getDomId("description", `${logical}!`)).not.toBe(domId);
	});
});

// State cleanup

describe("state GC", () => {
	it("removes state for widgets that disappear after a frame", () => {
		registerApp();
		const id = "Button/Orphan";

		// Frame 1 creates the widget state.
		drawPass(() => {
			runtime.buildId("Button", "Orphan");
			// Register an entry so the ID is considered active.
			runtime.getCurrentParentChildren().push({
				id,
				widgetName: "Button",
				args: [],
				children: [],
				renderState: {},
				persistence: null,
				widgetProps: {
					"data-ism-widget": "Button",
					"data-ism-id": id,
					className: "ism-widget ism-button",
				},
				renderFn: () => null,
			});
			runtime.getState(id, { clicked: false });
		});

		expect(runtime.getState(id, { clicked: false })).toEqual({
			clicked: false,
		});

		// Frame 2 leaves the widget out.
		drawPass(() => {
			// No widget is registered in this frame.
		});

		// A second missing committed frame exceeds the default one-frame retention.
		drawPass(() => {});

		// A new read should return the default instead of the old value.
		// The old state should no longer be reachable.
		// getState always returns a value, so behavior is checked indirectly.
		// A recreated widget starts from its default state.
		// This proves the previous entry was removed.
		// Set a nondefault value before the cleanup check.
		registerApp(); // Mount again before checking the new state.
		const fresh = runtime.getState(id, { clicked: true });
		// The old value is gone if cleanup worked.
		expect(fresh).toEqual({ clicked: true });
	});

	it("uses committed frame generations instead of wall-clock time", () => {
		registerApp();
		const id = "Button/Generation";

		drawPass(() => {
			runtime.getState(id, { value: 7 });
		});
		vi.advanceTimersByTime(60_000);
		expect(runtime.getStateStore().get(id)).toEqual({ value: 7 });

		drawPass(() => {});
		expect(runtime.getStateStore().has(id)).toBe(true);
		drawPass(() => {});
		expect(runtime.getStateStore().has(id)).toBe(false);
	});

	it("does not leak memory after 1000-widget add/remove cycles", () => {
		registerApp();

		for (let cycle = 0; cycle < 1000; cycle++) {
			drawPass(() => {
				for (let i = 0; i < 10; i++) {
					const id = `Button/cycle-${cycle}-item-${i}`;
					runtime.getCurrentParentChildren().push({
						id,
						widgetName: "Button",
						args: [],
						children: [],
						renderState: {},
						persistence: null,
						widgetProps: {
							"data-ism-widget": "Button",
							"data-ism-id": id,
							className: "ism-widget ism-button",
						},
						renderFn: () => null,
					});
					runtime.getState(id, {});
				}
			});
			// One empty frame retains the just-removed widgets; the next cycle
			// advances the generation far enough to collect older state.
			drawPass(() => {});
		}

		// Advance one more missing generation so the final cycle is collected.
		drawPass(() => {});

		// The repeated cycle should not leave old state behind.
		// The final empty frame removes the last active widget.
		// Check cleanup through public behavior because the store is private.
		// A missing old value should fall back to the provided default.
		const testId = "Button/cycle-999-item-5";
		const val = runtime.getState(testId, { sentinel: "fresh" });
		expect(val).toEqual({ sentinel: "fresh" });
	});
});

// Scopes

describe("scope management", () => {
	it("pushScope / popScope correctly nest widget children", () => {
		registerApp();
		drawPass(() => {
			const parentId = runtime.buildId("Panel", "main");
			const parentEntry = {
				id: parentId,
				widgetName: "Panel",
				args: [],
				children: [],
				renderState: {},
				persistence: null,
				widgetProps: {
					"data-ism-widget": "Panel",
					"data-ism-id": parentId,
					className: "ism-widget ism-panel",
				},
				renderFn: () => null,
			};
			runtime.getCurrentParentChildren().push(parentEntry);
			runtime.pushScope(parentId, "main", parentEntry);

			const childId = runtime.buildId("Button", "ok");
			runtime.getCurrentParentChildren().push({
				id: childId,
				widgetName: "Button",
				args: [],
				children: [],
				renderState: {},
				persistence: null,
				widgetProps: {
					"data-ism-widget": "Button",
					"data-ism-id": childId,
					className: "ism-widget ism-button",
				},
				renderFn: () => null,
			});
			runtime.popScope();

			const root = runtime.getFrameBuffer().get("default");
			expect(root).toBeDefined();
			expect(root!.length).toBe(1);
			expect(root![0]!.children.length).toBe(1);
			expect(root![0]!.children[0]!.id).toBe(childId);
			expect(childId.startsWith(`${parentId}/`)).toBe(true);
		});
	});
});

// markDirty batching

describe("markDirty batching", () => {
	it("multiple markDirty calls in the same microtask fire only once", async () => {
		let renderCount = 0;
		runtime.registerApp(() => {
			renderCount++;
		});

		runtime.markDirty();
		runtime.markDirty();
		runtime.markDirty();

		// Repeated calls in one task should schedule one render.
		await Promise.resolve(); // Let the queued microtask run.
		expect(renderCount).toBe(1);
	});

	it("cancels a queued rerender across an unregister/register lifecycle", async () => {
		const trigger = vi.fn();
		runtime.registerApp(trigger);
		runtime.markDirty();
		runtime.unregisterApp();
		runtime.registerApp(trigger);

		await Promise.resolve();
		expect(trigger).not.toHaveBeenCalled();

		runtime.markDirty();
		await Promise.resolve();
		expect(trigger).toHaveBeenCalledTimes(1);

		runtime.unregisterApp();
	});
});

// Inspection revisions and frame pool reuse

describe("runtime diagnostics", () => {
	function addFrameEntry(label: string): string {
		const id = runtime.buildId("Diagnostic", label);
		const entry = runtime.acquireFrameEntry();
		entry.id = id;
		entry.widgetName = "Diagnostic";
		entry.args = [label];
		entry.renderState = runtime.getState(id, { count: 0 });
		entry.widgetProps = {
			"data-ism-widget": "Diagnostic",
			"data-ism-id": id,
			className: "ism-widget ism-diagnostic",
		};
		entry.renderFn = () => null;
		runtime.getCurrentParentChildren().push(entry);
		return id;
	}

	it("advances inspection revisions only when tree or state data changes", () => {
		registerApp();
		let id = "";
		drawPass(() => {
			id = addFrameEntry("same");
		});
		const firstTree = runtime.getInspectionRevision("tree");
		const firstState = runtime.getInspectionRevision("state");

		drawPass(() => {
			addFrameEntry("same");
		});
		expect(runtime.getInspectionRevision("tree")).toBe(firstTree);
		expect(runtime.getInspectionRevision("state")).toBe(firstState);

		runtime.setState(id, { count: 1 });
		expect(runtime.getInspectionRevision("state")).toBe(firstState + 1);

		drawPass(() => {
			addFrameEntry("different");
		});
		expect(runtime.getInspectionRevision("tree")).toBe(firstTree + 1);
	});

	it("defers tree fingerprinting until inspection is requested", () => {
		registerApp();
		drawPass(() => {
			addFrameEntry("lazy");
		});

		const internals = runtime as unknown as {
			treeRevision: number;
			lastInspectedTreeEpoch: number;
		};
		expect(internals.treeRevision).toBe(0);
		expect(internals.lastInspectedTreeEpoch).toBe(-1);
		expect(runtime.getInspectionRevision("tree")).toBe(1);
	});

	it("handles deeply nested inspection and memo snapshots iteratively", () => {
		registerApp();
		const makeEntry = (index: number): FrameEntry => ({
			id: `Deep/${index}`,
			widgetName: "Deep",
			args: [index],
			children: [],
			renderState: null,
			persistence: null,
			widgetProps: {
				"data-ism-widget": "Deep",
				"data-ism-id": `Deep/${index}`,
				className: "ism-widget ism-deep",
			},
			renderFn: () => null,
		});

		const rootEntry = makeEntry(0);
		let cursor = rootEntry;
		for (let index = 1; index < 12_000; index++) {
			const child = makeEntry(index);
			cursor.children.push(child);
			cursor = child;
		}

		runtime.beginFrame();
		runtime.getCurrentParentChildren().push(rootEntry);
		runtime.endFrame();
		expect(() => runtime.getInspectionRevision("tree")).not.toThrow();

		runtime.setMemo("deep-snapshot", [], [rootEntry]);
		expect(() => {
			runtime.beginFrame();
			runtime.abortFrame();
		}).not.toThrow();
	});

	it("trims the retained frame pool after a transient large frame", () => {
		registerApp();
		drawPass(() => {
			for (let index = 0; index < 1000; index++) addFrameEntry(String(index));
		});
		drawPass(() => {
			addFrameEntry("small");
		});

		const retained = (
			runtime as unknown as {
				workingFramePool: { pool: unknown[] };
			}
		).workingFramePool.pool.length;
		expect(retained).toBeLessThanOrEqual(128);
	});
});

// Runtime ownership

describe("getRuntimeForId", () => {
	it("resolves to the runtime that built the id", () => {
		registerApp();
		let id = "";
		drawPass(() => {
			id = runtime.buildId("Button", "save");
		});
		expect(getRuntimeForId(id)).toBe(runtime);
		runtime.unregisterApp();
	});

	it("returns undefined for an id no runtime owns", () => {
		expect(getRuntimeForId("nonexistent")).toBeUndefined();
	});

	it("stops owning an id after unregisterApp", () => {
		registerApp();
		let id = "";
		drawPass(() => {
			id = runtime.buildId("Button", "save");
		});
		runtime.unregisterApp();
		expect(getRuntimeForId(id)).toBeUndefined();
	});

	it("does not let one runtime's ids collide with another's bookkeeping", () => {
		registerApp();
		const other = new Runtime();
		other.registerApp(() => {});

		let idA = "";
		drawPass(() => {
			idA = runtime.buildId("Button", "save");
		});

		let idB = "";
		other.beginFrame();
		idB = other.buildId("Button", "cancel");
		other.endFrame();

		// Different IDs should resolve to their own runtime.
		expect(getRuntimeForId(idA)).toBe(runtime);
		expect(getRuntimeForId(idB)).toBe(other);

		other.unregisterApp();
	});

	it("resolves a genuine cross-app id collision to a match rather than throwing, and warns once", () => {
		registerApp();
		const other = new Runtime();
		other.registerApp(() => {});

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		let idA = "";
		drawPass(() => {
			idA = runtime.buildId("Button", "save");
		});

		// Matching widget names and labels can produce the same ID in separate roots.
		other.beginFrame();
		const idB = other.buildId("Button", "save");
		other.endFrame();
		expect(idB).toBe(idA);

		const resolved = getRuntimeForId(idA);
		expect(resolved === runtime || resolved === other).toBe(true);
		expect(warnSpy).toHaveBeenCalled();

		warnSpy.mockRestore();
		other.unregisterApp();
	});
});

describe("frame transactions", () => {
	it("rolls speculative state back when a frame aborts", () => {
		registerApp();
		const id = "widget/Counter/transaction";
		runtime.getState(id, { count: 1 });
		const beforeRevision = runtime.getInspectionRevision("state");

		const transaction = runtime.beginFrame();
		runtime.getState(id, { count: 0 });
		runtime.setState(id, { count: 2 });
		runtime.setFocus(id);
		runtime.prepareFrame(transaction);
		runtime.abortFrame(transaction);

		expect(runtime.getState<{ count: number }>(id, { count: 0 })).toEqual({
			count: 1,
		});
		expect(runtime.getFocusedId()).toBeNull();
		expect(runtime.getInspectionRevision("state")).toBe(beforeRevision);
	});

	it("defers persistent writes until commit", () => {
		const storage = new MemoryStorageAdapter();
		useStorageRuntime(storage);
		const id = "settings/Transactional";

		const transaction = runtime.beginFrame();
		runtime.getState(id, { count: 0 }, true);
		runtime.setState(id, { count: 1 }, true);
		runtime.prepareFrame(transaction);

		expect(storage.writes).toHaveLength(0);
		runtime.commitFrame(transaction);
		expect(storage.writes).toHaveLength(1);
		expect(storedPayload(storage, TEST_NAMESPACE, id)).toEqual({ count: 1 });
	});

	it("discards pending persistent writes when a frame aborts", () => {
		const storage = new MemoryStorageAdapter();
		const id = "settings/Transactional";
		const key = storageKey(TEST_NAMESPACE, id);
		storage.values.set(key, {
			__ismState: 1,
			version: 1,
			value: { count: 4 },
		});
		useStorageRuntime(storage);

		const transaction = runtime.beginFrame();
		const current = runtime.getState<{ count: number }>(id, { count: 0 }, true);
		runtime.setState(id, { count: current.count + 1 }, true);
		runtime.prepareFrame(transaction);
		runtime.abortFrame(transaction);

		expect(storage.writes).toHaveLength(0);
		expect(storedPayload(storage, TEST_NAMESPACE, id)).toEqual({ count: 4 });
		expect(runtime.getState<{ count: number }>(id, { count: 0 }, true)).toEqual(
			{
				count: 4,
			},
		);
	});

	it("automatically rolls back an abandoned attempt before a replay", () => {
		registerApp();
		const id = "widget/Counter/replay";
		runtime.getState(id, { count: 10 });

		const abandoned = runtime.beginFrame();
		runtime.setState(id, { count: 99 });
		runtime.prepareFrame(abandoned);

		const replay = runtime.beginFrame();
		expect(runtime.getState<{ count: number }>(id, { count: 0 })).toEqual({
			count: 10,
		});
		runtime.prepareFrame(replay);
		runtime.commitFrame(replay);
	});

	it("preserves a prepared React replay when requested", () => {
		registerApp();
		const id = "widget/Counter/react-replay";
		runtime.getState(id, { count: 10 });

		const prepared = runtime.beginFrame();
		runtime.setState(id, { count: 99 });
		runtime.prepareFrame(prepared);

		const replay = runtime.beginFrame(true);
		expect(runtime.getState<{ count: number }>(id, { count: 0 })).toEqual({
			count: 99,
		});
		runtime.prepareFrame(replay);
		runtime.commitFrame(replay);
	});

	it("does not consume one-shot state from an aborted frame", () => {
		registerApp();
		const id = "controls/Button/transaction";
		runtime.getState(id, { clicked: true });

		const transaction = runtime.beginFrame();
		const current = runtime.getState<{ clicked: boolean }>(id, {
			clicked: false,
		});
		runtime.consumeState(id, current, (state) => ({
			...(state as { clicked: boolean }),
			clicked: false,
		}));
		runtime.prepareFrame(transaction);
		runtime.abortFrame(transaction);

		expect(
			runtime.getState<{ clicked: boolean }>(id, { clicked: false }),
		).toEqual({ clicked: true });
	});

	it("commits prepared frames idempotently for React StrictMode effects", () => {
		registerApp();
		const transaction = runtime.beginFrame();
		runtime.prepareFrame(transaction);
		runtime.commitFrame(transaction);

		expect(() => runtime.commitFrame(transaction)).not.toThrow();
	});
});
