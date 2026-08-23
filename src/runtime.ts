import * as errors from "./errors";
import type {
	FrameEntry,
	PersistentStateOptions,
	ResolvedPersistenceOptions,
	StorageAdapter,
	StorageFailure,
	StorageOperation,
} from "./types";

interface ScopeEntry {
	id: string;
	label: string;
	frameEntry: FrameEntry;
	previousIdPrefix: string;
}

interface MemoCacheEntry {
	deps: unknown[];
	subtree: FrameEntry[];
	widgetIds: string[];
}

interface FrameTransactionSnapshot {
	frameRoot: Map<string, FrameEntry[]>;
	stateStore: Map<string, unknown>;
	stateDefaults: Map<string, unknown>;
	persistenceById: Map<string, ResolvedPersistenceOptions>;
	contextStack: Map<string, unknown[]>;
	memoCache: Map<string, MemoCacheEntry>;
	memoKeysByWidgetId: Map<string, Set<string>>;
	memoLastSeenFrame: Map<string, number>;
	memoCollisionCounter: Map<string, number>;
	idPrefixStack: string[];
	idPrefix: string;
	collisionCounter: Map<string, number>;
	usedFinalIds: Set<string>;
	duplicateWarned: Set<string>;
	activeLayerStack: string[];
	focusedId: string | null;
	ownedIds: Set<string>;
	stateLastSeenFrame: Map<string, number>;
	frameGeneration: number;
	treeMutationEpoch: number;
	lastInspectedTreeEpoch: number;
	scopeStack: ScopeEntry[];
	dirty: boolean;
	treeRevision: number;
	stateRevision: number;
	lastTreeFingerprint: string;
}

interface PendingStorageSet {
	kind: "set";
	value: unknown;
	persistence: ResolvedPersistenceOptions;
}

interface PendingStorageDelete {
	kind: "delete";
}

type PendingStorageMutation = PendingStorageSet | PendingStorageDelete;

interface FrameTransaction {
	id: number;
	snapshot: FrameTransactionSnapshot;
	pendingStorageMutations: Map<string, PendingStorageMutation>;
	prepared: boolean;
}

interface PersistedStateRecord {
	__ismState: 1;
	version: number;
	value: unknown;
}

type PersistenceRequest<S> =
	| boolean
	| PersistentStateOptions<S>
	| ResolvedPersistenceOptions;

type StorageReadResult<S> =
	| { status: "found"; value: S; normalize: boolean }
	| { status: "missing" }
	| { status: "invalid" }
	| { status: "unavailable" };

export interface MemoIdentity {
	cacheKey: string;
	idSegment: string;
}

function encodeIdSegment(value: string): string {
	return value.replaceAll("%", "%25").replaceAll("/", "%2F");
}

function cloneMapOfArrays(map: Map<string, unknown[]>): Map<string, unknown[]> {
	return new Map(Array.from(map, ([key, value]) => [key, [...value]]));
}

function cloneMapOfSets<K, V>(map: Map<K, Set<V>>): Map<K, Set<V>> {
	return new Map(Array.from(map, ([key, value]) => [key, new Set(value)]));
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function mapsOfArraysEqual(
	left: Map<string, unknown[]>,
	right: Map<string, unknown[]>,
): boolean {
	if (left.size !== right.size) return false;
	for (const [key, leftValues] of left) {
		const rightValues = right.get(key);
		if (!rightValues || !arraysEqual(leftValues, rightValues)) return false;
	}
	return true;
}

function shallowStateEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		return arraysEqual(left, right);
	}
	if (
		left !== null &&
		right !== null &&
		typeof left === "object" &&
		typeof right === "object" &&
		Object.getPrototypeOf(left) === Object.prototype &&
		Object.getPrototypeOf(right) === Object.prototype
	) {
		const leftRecord = left as Record<string, unknown>;
		const rightRecord = right as Record<string, unknown>;
		const leftKeys = Object.keys(leftRecord);
		if (leftKeys.length !== Object.keys(rightRecord).length) return false;
		return leftKeys.every(
			(key) =>
				Object.hasOwn(rightRecord, key) &&
				Object.is(leftRecord[key], rightRecord[key]),
		);
	}
	return false;
}

function restoreMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
	target.clear();
	for (const [key, value] of source) target.set(key, value);
}

function restoreSet<T>(target: Set<T>, source: Set<T>): void {
	target.clear();
	for (const value of source) target.add(value);
}

const RUNTIME_REGISTRY_SYMBOL = Symbol.for(
	"@ispoofermotion/core/runtime-registry",
);

interface RuntimeRegistry {
	nextInstanceId: number;
}

function getRuntimeRegistry(): RuntimeRegistry {
	const globalRecord = globalThis as typeof globalThis &
		Record<PropertyKey, unknown>;
	const existing = globalRecord[RUNTIME_REGISTRY_SYMBOL] as
		| RuntimeRegistry
		| undefined;
	if (existing) return existing;
	const registry: RuntimeRegistry = { nextInstanceId: 1 };
	globalRecord[RUNTIME_REGISTRY_SYMBOL] = registry;
	return registry;
}

function allocateRuntimeInstanceId(): string {
	const registry = getRuntimeRegistry();
	const id = registry.nextInstanceId++;
	return `ism-runtime-v4-${id}`;
}

function hashDomIdValue(value: string): string {
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		first = Math.imul(first ^ code, 0x01000193);
		second = Math.imul(second ^ code, 0x85ebca6b);
	}
	return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function sanitizeDomToken(value: string): string {
	const sanitized = value
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return sanitized || "node";
}

class FramePool {
	private pool: FrameEntry[] = [];
	private index = 0;

	reset(): void {
		this.index = 0;
	}

	trim(maxRetained: number): void {
		if (this.pool.length > maxRetained) this.pool.length = maxRetained;
	}

	get usedCount(): number {
		return this.index;
	}

	acquire(): FrameEntry {
		if (this.index >= this.pool.length) {
			this.pool.push({
				id: "",
				widgetName: "",
				args: [],
				children: [],
				renderState: null,
				persistence: null,
				widgetProps: {
					"data-ism-widget": "",
					"data-ism-id": "",
					className: "",
				},
				renderFn: () => null,
			} satisfies FrameEntry);
		}

		const entry = this.pool[this.index++] as FrameEntry;
		entry.children.length = 0;
		delete entry.a11yDescription;
		return entry;
	}
}

/** Runtime state for one component returned by `createApp`. */
export class Runtime {
	private readonly storage: StorageAdapter | null;
	private readonly storageNamespace: string | null;
	private readonly storagePrefix: string | null;
	private readonly onStorageError: ((failure: StorageFailure) => void) | null;
	private readonly strictIds: boolean;
	private readonly strictRuntime: boolean;
	private readonly onDiagnostic: errors.DiagnosticSink | null;
	private stateStore = new Map<string, unknown>();
	private stateDefaults = new Map<string, unknown>();
	private persistenceById = new Map<string, ResolvedPersistenceOptions>();
	private contextStack = new Map<string, unknown[]>();
	private memoCache = new Map<string, MemoCacheEntry>();
	private memoKeysByWidgetId = new Map<string, Set<string>>();
	private memoLastSeenFrame = new Map<string, number>();
	private memoCollisionCounter = new Map<string, number>();
	private memoCaptureDepth = 0;
	private idPrefixStack: string[] = [];
	private idPrefix = "";
	private collisionCounter = new Map<string, number>();
	private usedFinalIds = new Set<string>();
	private duplicateWarned = new Set<string>();
	private frameRoot = new Map<string, FrameEntry[]>();
	private workingFrameRoot = new Map<string, FrameEntry[]>();
	private activeLayerStack: string[] = ["default"];
	private focusedId: string | null = null;
	private ownedIds = new Set<string>();
	private committedFramePool = new FramePool();
	private workingFramePool = new FramePool();
	private frameTransaction: FrameTransaction | null = null;
	private nextFrameTransactionId = 1;
	private lastCommittedFrameTransactionId: number | null = null;
	private stateLastSeenFrame = new Map<string, number>();
	private frameGeneration = 0;
	private readonly retentionFrames: number;
	private scopeStack: ScopeEntry[] = [];
	private drawing = false;
	private rerenderFn: (() => void) | null = null;
	private dirty = false;
	private readonly instanceId = allocateRuntimeInstanceId();
	private lifecycleToken = 0;
	private appMounted = false;
	private treeRevision = 0;
	private stateRevision = 0;
	private treeMutationEpoch = 0;
	private lastInspectedTreeEpoch = -1;
	private inspectorSubscribers = 0;
	private lastTreeFingerprint = "";

	constructor(
		storage?: StorageAdapter,
		storageNamespace?: string,
		onStorageError?: (failure: StorageFailure) => void,
		strictIds = false,
		strictRuntime = false,
		onDiagnostic?: errors.DiagnosticSink,
		retentionFrames = 1,
	) {
		this.storage = storage ?? null;
		this.onStorageError = onStorageError ?? null;
		this.strictIds = strictIds;
		this.strictRuntime = strictRuntime;
		this.onDiagnostic = onDiagnostic ?? null;
		if (!Number.isSafeInteger(retentionFrames) || retentionFrames < 0) {
			throw errors.createISMError(
				"ISM_FRAME_TRANSACTION",
				"[ism] retentionFrames must be a non-negative safe integer.",
				{ details: { retentionFrames } },
			);
		}
		this.retentionFrames = retentionFrames;

		if (storage) {
			const namespace = storageNamespace?.trim();
			if (!namespace) {
				throw errors.createISMError(
					"ISM_STORAGE_FAILURE",
					"[ism] storageNamespace is required when a storage adapter is configured.",
					{ details: { operation: "namespace" } },
				);
			}
			this.storageNamespace = namespace;
			this.storagePrefix = `ism:v1:${encodeURIComponent(namespace)}:`;
		} else {
			this.storageNamespace = null;
			this.storagePrefix = null;
		}
	}

	registerApp(rerenderFn: () => void): void {
		this.lifecycleToken++;
		this.appMounted = true;
		this.rerenderFn = rerenderFn;
		this.dirty = false;
		mountedRuntimes.add(this);
	}

	unregisterApp(): void {
		this.appMounted = false;
		this.rerenderFn = null;
		this.dirty = false;
		mountedRuntimes.delete(this);
		if (mountedRuntimes.size <= 1) crossRuntimeCollisionWarned.clear();

		const token = ++this.lifecycleToken;
		queueMicrotask(() => {
			if (!this.appMounted && this.lifecycleToken === token) this.clearState();
		});
	}

	private clearState(): void {
		this.frameTransaction = null;
		this.lastCommittedFrameTransactionId = null;
		this.stateStore.clear();
		this.stateDefaults.clear();
		this.persistenceById.clear();
		this.contextStack.clear();
		this.memoCache.clear();
		this.memoKeysByWidgetId.clear();
		this.memoLastSeenFrame.clear();
		this.memoCollisionCounter.clear();
		this.idPrefixStack.length = 0;
		this.idPrefix = "";
		this.collisionCounter.clear();
		this.usedFinalIds.clear();
		this.duplicateWarned.clear();
		this.frameRoot.clear();
		this.workingFrameRoot.clear();
		this.activeLayerStack = ["default"];
		this.focusedId = null;
		this.ownedIds.clear();
		this.committedFramePool.reset();
		this.committedFramePool.trim(0);
		this.workingFramePool.reset();
		this.workingFramePool.trim(0);
		this.stateLastSeenFrame.clear();
		this.frameGeneration = 0;
		this.scopeStack.length = 0;
		this.drawing = false;
		this.dirty = false;
		this.memoCaptureDepth = 0;
		this.treeMutationEpoch++;
		this.treeRevision++;
		this.stateRevision++;
		this.lastInspectedTreeEpoch = -1;
		this.lastTreeFingerprint = "";
	}

	isAppMounted(): boolean {
		return this.appMounted;
	}

	getInstanceId(): string {
		return this.instanceId;
	}

	getStorageNamespace(): string | null {
		return this.storageNamespace;
	}

	getDomId(kind: string, id: string): string {
		const token = sanitizeDomToken(kind);
		const hash = hashDomIdValue(`${kind}\0${id}`);
		return `${this.instanceId}-${token}-${hash}`;
	}

	beginFrame(preservePreparedState = false): number {
		// A React replay can start a new render before the previous attempt commits.
		// Treat the older attempt as abandoned and restore the last committed state.
		if (this.frameTransaction) {
			if (preservePreparedState && this.frameTransaction.prepared) {
				// React can replay a prepared render in Strict Mode or after a
				// suspended child. Preserve logical state changes made by that
				// attempt so one-shot widget events are not observed twice.
				this.frameRoot = this.frameTransaction.snapshot.frameRoot;
				this.workingFramePool.reset();
				this.frameTransaction = null;
				this.drawing = false;
			} else {
				this.abortFrame(this.frameTransaction.id);
			}
		}

		const transactionId = this.nextFrameTransactionId++;
		this.frameTransaction = {
			id: transactionId,
			snapshot: this.captureFrameTransactionSnapshot(),
			pendingStorageMutations: new Map(),
			prepared: false,
		};

		this.drawing = true;
		this.frameGeneration++;
		// Record into a buffer that is distinct from the committed tree. On commit
		// the buffers swap, so the previous committed objects can be reused safely
		// by the following speculative frame without mutating live React state.
		this.workingFrameRoot.clear();
		this.frameRoot = this.workingFrameRoot;
		this.workingFramePool.reset();
		this.activeLayerStack = ["default"];
		this.collisionCounter.clear();
		this.memoCollisionCounter.clear();
		this.usedFinalIds.clear();
		this.duplicateWarned.clear();
		this.scopeStack.length = 0;
		this.idPrefixStack.length = 0;
		this.idPrefix = "";
		this.contextStack.clear();
		this.dirty = false;
		return transactionId;
	}

	prepareFrame(transactionId?: number): void {
		const transaction = this.requireFrameTransaction(transactionId);
		if (transaction.prepared) return;

		if (this.scopeStack.length > 0) {
			const scopes = this.scopeStack.map((scope) => scope.label);
			this.reportInvariant(
				"ISM_UNCLOSED_SCOPES",
				errors.unclosedScopes(scopes),
				{ scopes },
			);
		}

		for (const [id, lastSeenFrame] of this.stateLastSeenFrame) {
			if (this.frameGeneration - lastSeenFrame <= this.retentionFrames)
				continue;
			this.stateStore.delete(id);
			this.stateDefaults.delete(id);
			this.persistenceById.delete(id);
			this.stateRevision++;
			this.stateLastSeenFrame.delete(id);
			this.ownedIds.delete(id);
			this.invalidateMemoForWidget(id);
			if (this.focusedId === id) this.focusedId = null;
		}

		for (const [key, lastSeenFrame] of this.memoLastSeenFrame) {
			if (this.frameGeneration - lastSeenFrame > this.retentionFrames) {
				this.deleteMemo(key);
			}
		}

		if (this.idPrefixStack.length > 0) {
			this.reportInvariant(
				"ISM_UNBALANCED_ID_STACK",
				`[ism] Unbalanced pushId/popId calls: ${this.idPrefixStack.length} segment(s) remain open.`,
				{ depth: this.idPrefixStack.length },
			);
		}
		for (const [key, stack] of this.contextStack) {
			if (stack.length > 0) {
				this.reportInvariant(
					"ISM_UNBALANCED_CONTEXT",
					`[ism] Unbalanced context stack for "${key}": ${stack.length} value(s) remain.`,
					{ key, depth: stack.length },
				);
			}
		}
		if (this.activeLayerStack.length > 1) {
			this.reportInvariant(
				"ISM_UNBALANCED_LAYER_STACK",
				`[ism] Unbalanced pushLayer/popLayer calls: ${this.activeLayerStack.length - 1} layer(s) remain open.`,
				{ depth: this.activeLayerStack.length - 1 },
			);
		}

		this.treeMutationEpoch++;
		if (this.inspectorSubscribers > 0) this.refreshTreeInspectionRevision();

		this.drawing = false;
		transaction.prepared = true;
	}

	commitFrame(transactionId?: number): void {
		if (!this.frameTransaction) {
			if (
				transactionId !== undefined &&
				transactionId === this.lastCommittedFrameTransactionId
			) {
				return;
			}
			throw errors.createISMError(
				"ISM_FRAME_TRANSACTION",
				"[ism] No frame transaction is active.",
			);
		}
		const transaction = this.requireFrameTransaction(transactionId);
		if (!transaction.prepared) this.prepareFrame(transaction.id);

		for (const [key, mutation] of transaction.pendingStorageMutations) {
			this.applyStorageMutation(key, mutation);
		}

		const poolRetention = Math.max(this.workingFramePool.usedCount * 2, 128);
		const previousCommittedPool = this.committedFramePool;
		this.committedFramePool = this.workingFramePool;
		this.workingFramePool = previousCommittedPool;
		this.workingFramePool.reset();
		this.workingFramePool.trim(poolRetention);

		const previousCommittedRoot = transaction.snapshot.frameRoot;
		this.workingFrameRoot = previousCommittedRoot;
		this.workingFrameRoot.clear();

		this.lastCommittedFrameTransactionId = transaction.id;
		this.frameTransaction = null;
		if (this.dirty) this.scheduleRerender();
	}

	abortFrame(transactionId?: number): void {
		const transaction = this.frameTransaction;
		if (!transaction) return;
		if (transactionId !== undefined && transaction.id !== transactionId) return;

		this.restoreFrameTransactionSnapshot(transaction.snapshot);
		this.workingFramePool.reset();
		this.frameTransaction = null;
		this.drawing = false;
	}

	/**
	 * Synchronously finalize a frame. Kept for direct Runtime consumers and
	 * tests; React integration uses prepareFrame() during render and
	 * commitFrame() from the commit phase.
	 */
	endFrame(): void {
		const transaction = this.requireFrameTransaction();
		this.prepareFrame(transaction.id);
		this.commitFrame(transaction.id);
	}

	isDrawing(): boolean {
		return this.drawing;
	}

	getFrameBuffer(): Map<string, FrameEntry[]> {
		return this.frameRoot;
	}

	getState<S>(
		id: string,
		defaultState: S,
		persistent: PersistenceRequest<S> = false,
	): S {
		const persistence = this.normalizePersistence(persistent);

		if (!this.stateStore.has(id)) {
			let initialState: S;
			try {
				initialState = structuredClone(defaultState);
			} catch (error) {
				throw errors.createISMError(
					"ISM_DEFAULT_STATE_CLONE_FAILURE",
					errors.defaultStateCloneFailure(id, errors.getErrorMessage(error)),
					{ cause: error, details: { id } },
				);
			}

			this.stateDefaults.set(id, structuredClone(initialState));
			if (persistence) {
				this.persistenceById.set(id, persistence);

				if (this.storage) {
					const stored = this.readPersistentState<S>(id, persistence);
					if (stored.status === "found") {
						initialState = stored.value;
						if (stored.normalize) {
							this.writeStorage(id, initialState, persistence);
						}
					} else if (
						stored.status === "missing" ||
						stored.status === "invalid"
					) {
						this.writeStorage(id, initialState, persistence);
					}
				}
			}

			this.stateStore.set(id, initialState);
			this.stateRevision++;
		} else if (persistence) {
			this.persistenceById.set(id, persistence);
		}

		this.stateLastSeenFrame.set(id, this.frameGeneration);
		return this.stateStore.get(id) as S;
	}

	setState(
		id: string,
		updater: unknown,
		persistent: PersistenceRequest<unknown> = false,
	): void {
		if (!this.stateStore.has(id)) return;
		const current = this.stateStore.get(id);
		const next =
			typeof updater === "function"
				? (updater as (previous: unknown) => unknown)(current)
				: updater;
		if (Object.is(current, next)) return;
		this.stateStore.set(id, next);
		this.stateRevision++;

		const persistence = this.resolvePersistenceForId(id, persistent);
		if (persistence && this.storage) this.writeStorage(id, next, persistence);

		this.invalidateMemoForWidget(id);
		this.markDirty();
	}

	consumeState(
		id: string,
		currentState: unknown,
		consumer: (state: unknown) => unknown,
		persistent: PersistenceRequest<unknown> = false,
	): void {
		if (!this.stateStore.has(id)) return;
		const next = consumer(currentState);
		if (shallowStateEqual(currentState, next)) return;
		this.stateStore.set(id, next);
		this.stateRevision++;

		const persistence = this.resolvePersistenceForId(id, persistent);
		if (persistence && this.storage) this.writeStorage(id, next, persistence);
	}

	/** Reset one live widget state to its declared default value. */
	resetState(id: string): boolean {
		if (!this.stateDefaults.has(id) || !this.stateStore.has(id)) return false;

		let next: unknown;
		try {
			next = structuredClone(this.stateDefaults.get(id));
		} catch (error) {
			throw errors.createISMError(
				"ISM_DEFAULT_STATE_CLONE_FAILURE",
				errors.defaultStateCloneFailure(id, errors.getErrorMessage(error)),
				{ cause: error, details: { id } },
			);
		}

		this.stateStore.set(id, next);
		this.stateRevision++;
		if (this.persistenceById.has(id)) this.deleteStorage(id);
		this.invalidateMemoForWidget(id);
		this.markDirty();
		return true;
	}

	/** Delete persisted values for every persistent widget known to this runtime. */
	clearPersistentState(): number {
		if (!this.storage) return 0;
		let count = 0;
		for (const id of this.persistenceById.keys()) {
			if (this.deleteStorage(id)) count++;
		}
		return count;
	}

	/** Delete every storage key owned by this runtime's stable namespace. */
	clearStorageNamespace(): number {
		const prefix = this.storagePrefix;
		if (!this.storage || !prefix) return 0;

		let keys: string[];
		try {
			keys = Array.from(this.storage.keys());
		} catch (error) {
			this.reportStorageFailure("keys", undefined, error);
			return 0;
		}

		const keysToDelete = new Set(keys.filter((key) => key.startsWith(prefix)));
		if (this.frameTransaction) {
			for (const key of this.frameTransaction.pendingStorageMutations.keys()) {
				if (key.startsWith(prefix)) keysToDelete.add(key);
			}
		}

		let count = 0;
		for (const key of keysToDelete) {
			if (this.deleteStorageKey(key)) count++;
		}
		return count;
	}

	buildId(widgetName: string, label: string | undefined): string {
		const rawLabel =
			label === undefined
				? widgetName
				: label.includes("###")
					? label.slice(label.indexOf("###") + 3)
					: label;
		const rawId = `${this.idPrefix}${encodeIdSegment(widgetName)}/${encodeIdSegment(rawLabel)}`;
		let occurrence = this.collisionCounter.get(rawId) ?? 0;

		if (occurrence > 0 && this.strictIds) {
			const displayLabel =
				label === undefined ? widgetName : extractDisplayLabel(label);
			throw errors.createISMError(
				"ISM_DUPLICATE_ID_STRICT",
				errors.duplicateIdStrict(widgetName, displayLabel),
				{ details: { widgetName, displayLabel } },
			);
		}

		let finalId = occurrence === 0 ? rawId : `${rawId}__${occurrence + 1}`;

		while (this.usedFinalIds.has(finalId)) {
			occurrence++;
			finalId = `${rawId}__${occurrence + 1}`;
		}

		this.collisionCounter.set(rawId, occurrence + 1);
		this.reserveId(finalId);
		if (
			finalId !== rawId &&
			label !== undefined &&
			!this.duplicateWarned.has(rawId)
		) {
			this.duplicateWarned.add(rawId);
			const displayLabel = extractDisplayLabel(label);
			this.emitRuntimeDiagnostic(
				"ISM_DUPLICATE_ID",
				"warning",
				errors.duplicateId(widgetName, displayLabel),
				{ widgetName, displayLabel },
			);
		}
		return finalId;
	}

	ownsId(id: string): boolean {
		return this.ownedIds.has(id);
	}

	pushContext<T>(key: string, value: T): void {
		let stack = this.contextStack.get(key);
		if (!stack) {
			stack = [];
			this.contextStack.set(key, stack);
		}
		stack.push(value);
	}

	popContext(key: string): void {
		const stack = this.contextStack.get(key);
		if (!stack || stack.length === 0) {
			this.reportInvariant(
				"ISM_UNBALANCED_CONTEXT",
				errors.unbalancedPopContext(key),
				{ key },
			);
			return;
		}
		stack.pop();
	}

	getContext<T>(key: string): T | undefined {
		const stack = this.contextStack.get(key);
		return stack?.[stack.length - 1] as T | undefined;
	}

	pushLayer(layerName: string): void {
		this.activeLayerStack.push(layerName);
	}

	popLayer(): void {
		if (this.activeLayerStack.length <= 1) {
			this.reportInvariant("ISM_POP_DEFAULT_LAYER", errors.popDefaultLayer());
			return;
		}
		this.activeLayerStack.pop();
	}

	getActiveLayer(): string {
		return this.activeLayerStack[this.activeLayerStack.length - 1] ?? "default";
	}

	buildMemoIdentity(id: string): MemoIdentity {
		const encoded = encodeIdSegment(id);
		const base = `${this.idPrefix}__memo__/${encoded}`;
		const count = (this.memoCollisionCounter.get(base) ?? 0) + 1;
		this.memoCollisionCounter.set(base, count);
		const suffix = count === 1 ? "" : `__${count}`;
		const cacheKey = `${base}${suffix}`;
		this.memoLastSeenFrame.set(cacheKey, this.frameGeneration);
		return { cacheKey, idSegment: `${encoded}${suffix}` };
	}

	/** @deprecated Use `buildMemoIdentity`. */
	buildMemoKey(id: string): string {
		return this.buildMemoIdentity(id).cacheKey;
	}

	getMemo(id: string): MemoCacheEntry | undefined {
		return this.memoCache.get(id);
	}

	setMemo(id: string, deps: readonly unknown[], subtree: FrameEntry[]): void {
		this.deleteMemo(id);
		const widgetIds = this.collectSubtreeIds(subtree);
		this.memoCache.set(id, { deps: [...deps], subtree, widgetIds });
		this.memoLastSeenFrame.set(id, this.frameGeneration);
		for (const widgetId of widgetIds) {
			let keys = this.memoKeysByWidgetId.get(widgetId);
			if (!keys) {
				keys = new Set<string>();
				this.memoKeysByWidgetId.set(widgetId, keys);
			}
			keys.add(id);
		}
	}

	private deleteMemo(id: string): void {
		const existing = this.memoCache.get(id);
		if (existing) {
			for (const widgetId of existing.widgetIds) {
				const keys = this.memoKeysByWidgetId.get(widgetId);
				keys?.delete(id);
				if (keys?.size === 0) this.memoKeysByWidgetId.delete(widgetId);
			}
		}
		this.memoCache.delete(id);
		this.memoLastSeenFrame.delete(id);
	}

	private invalidateMemoForWidget(widgetId: string): void {
		const keys = this.memoKeysByWidgetId.get(widgetId);
		if (!keys) return;
		for (const key of [...keys]) this.deleteMemo(key);
	}

	isCapturingMemo(): boolean {
		return this.memoCaptureDepth > 0;
	}

	captureSubtree(memoId: string, drawClosure: () => void): FrameEntry[] {
		const scopeSnapshot = [...this.scopeStack];
		const prefixStackSnapshot = [...this.idPrefixStack];
		const prefixSnapshot = this.idPrefix;
		const contextSnapshot = cloneMapOfArrays(this.contextStack);
		const layerSnapshot = [...this.activeLayerStack];
		const frameRootSnapshot = new Map(this.frameRoot);
		const frameLengths = this.snapshotFrameLengths();
		const collisionSnapshot = new Map(this.collisionCounter);
		const usedSnapshot = new Set(this.usedFinalIds);
		const warnedSnapshot = new Set(this.duplicateWarned);
		const ownedSnapshot = new Set(this.ownedIds);
		const stateSnapshot = new Map(this.stateStore);
		const stateDefaultsSnapshot = new Map(this.stateDefaults);
		const persistenceSnapshot = new Map(this.persistenceById);
		const stateLastSeenFrameSnapshot = new Map(this.stateLastSeenFrame);
		const stateRevisionSnapshot = this.stateRevision;
		const memoCacheSnapshot = new Map(this.memoCache);
		const memoKeysByWidgetIdSnapshot = cloneMapOfSets(this.memoKeysByWidgetId);
		const memoLastSeenFrameSnapshot = new Map(this.memoLastSeenFrame);
		const dirtySnapshot = this.dirty;
		const pendingStorageSnapshot = this.frameTransaction
			? new Map(this.frameTransaction.pendingStorageMutations)
			: null;
		const detached: FrameEntry = {
			id: `__memo_capture__/${encodeIdSegment(memoId)}`,
			widgetName: "MemoCapture",
			args: [],
			children: [],
			renderState: null,
			persistence: null,
			widgetProps: {
				"data-ism-widget": "MemoCapture",
				"data-ism-id": "",
				className: "",
			},
			renderFn: () => null,
		};
		const sentinel: ScopeEntry = {
			id: detached.id,
			label: memoId,
			frameEntry: detached,
			previousIdPrefix: this.idPrefix,
		};

		this.scopeStack.push(sentinel);
		this.memoCaptureDepth++;
		let succeeded = false;
		try {
			drawClosure();
			const scopeBalanced =
				this.scopeStack.length === scopeSnapshot.length + 1 &&
				this.scopeStack[this.scopeStack.length - 1] === sentinel;
			const otherStacksBalanced =
				this.idPrefix === prefixSnapshot &&
				arraysEqual(this.idPrefixStack, prefixStackSnapshot) &&
				mapsOfArraysEqual(this.contextStack, contextSnapshot) &&
				arraysEqual(this.activeLayerStack, layerSnapshot);

			if (!scopeBalanced || !otherStacksBalanced) {
				throw errors.createISMError(
					"ISM_MEMO_UNBALANCED",
					errors.memoBlockUnbalancedState(memoId),
					{ details: { memoId } },
				);
			}

			succeeded = true;
			return this.cloneSubtree(detached.children);
		} finally {
			this.memoCaptureDepth--;
			this.restoreFrameSnapshot(frameRootSnapshot, frameLengths);
			this.scopeStack = [...scopeSnapshot];
			this.idPrefixStack = [...prefixStackSnapshot];
			this.idPrefix = prefixSnapshot;
			restoreMap(this.contextStack, contextSnapshot);
			this.activeLayerStack = [...layerSnapshot];

			if (!succeeded) {
				restoreMap(this.collisionCounter, collisionSnapshot);
				restoreSet(this.usedFinalIds, usedSnapshot);
				restoreSet(this.duplicateWarned, warnedSnapshot);
				restoreSet(this.ownedIds, ownedSnapshot);
				restoreMap(this.stateStore, stateSnapshot);
				restoreMap(this.stateDefaults, stateDefaultsSnapshot);
				restoreMap(this.persistenceById, persistenceSnapshot);
				restoreMap(this.stateLastSeenFrame, stateLastSeenFrameSnapshot);
				this.stateRevision = stateRevisionSnapshot;
				restoreMap(this.memoCache, memoCacheSnapshot);
				restoreMap(this.memoKeysByWidgetId, memoKeysByWidgetIdSnapshot);
				restoreMap(this.memoLastSeenFrame, memoLastSeenFrameSnapshot);
				this.dirty = dirtySnapshot;
				if (this.frameTransaction && pendingStorageSnapshot) {
					restoreMap(
						this.frameTransaction.pendingStorageMutations,
						pendingStorageSnapshot,
					);
				}
			}
		}
	}

	pushCachedSubtree(subtree: FrameEntry[]): boolean {
		const ids = this.collectSubtreeIds(subtree, true);
		if (ids.some((id) => this.usedFinalIds.has(id))) return false;
		for (const id of ids) this.reserveId(id);
		this.getCurrentParentChildren().push(...subtree);
		return true;
	}

	appendCapturedSubtree(subtree: FrameEntry[]): void {
		this.getCurrentParentChildren().push(...subtree);
	}

	setFocus(id: string | null): void {
		if (this.focusedId === id) return;
		this.focusedId = id;
		this.markDirty();
	}

	isFocused(id: string): boolean {
		return this.focusedId === id;
	}

	getFocusedId(): string | null {
		return this.focusedId;
	}

	getTree(): Map<string, FrameEntry[]> {
		return this.frameRoot;
	}

	getStateStore(): Map<string, unknown> {
		return this.stateStore;
	}

	getInspectionRevision(kind: "tree" | "state"): number {
		if (kind === "state") return this.stateRevision;
		if (this.lastInspectedTreeEpoch !== this.treeMutationEpoch) {
			this.refreshTreeInspectionRevision();
		}
		return this.treeRevision;
	}

	/** Keep tree revision tracking hot only while an inspector is actively open. */
	attachInspector(): () => void {
		this.inspectorSubscribers++;
		let attached = true;
		return () => {
			if (!attached) return;
			attached = false;
			this.inspectorSubscribers = Math.max(0, this.inspectorSubscribers - 1);
		};
	}

	pushScope(id: string, label: string, frameEntry: FrameEntry): void {
		this.scopeStack.push({
			id,
			label,
			frameEntry,
			previousIdPrefix: this.idPrefix,
		});
		this.idPrefix = `${id}/`;
	}

	popScope(): void {
		if (this.scopeStack.length === 0) {
			this.reportInvariant("ISM_END_WITHOUT_SCOPE", errors.endWithoutScope());
			return;
		}
		const scope = this.scopeStack.pop();
		this.idPrefix = scope?.previousIdPrefix ?? "";
	}

	acquireFrameEntry(): FrameEntry {
		return this.workingFramePool.acquire();
	}

	getCurrentParentChildren(): FrameEntry[] {
		const scope = this.scopeStack[this.scopeStack.length - 1];
		if (scope) return scope.frameEntry.children;
		const layer = this.getActiveLayer();
		let entries = this.frameRoot.get(layer);
		if (!entries) {
			entries = [];
			this.frameRoot.set(layer, entries);
		}
		return entries;
	}

	pushIdSegment(id: string): void {
		this.idPrefixStack.push(this.idPrefix);
		this.idPrefix = `${this.idPrefix}${encodeIdSegment(id)}/`;
	}

	popIdSegment(): void {
		if (this.idPrefixStack.length === 0) {
			this.reportInvariant("ISM_POP_ID_EMPTY", errors.popIdEmpty());
			return;
		}
		this.idPrefix = this.idPrefixStack.pop() ?? "";
	}

	markDirty(): void {
		if (this.dirty) return;
		this.dirty = true;
		// Draw/render work is speculative until React commits it. Do not schedule
		// observable React work from an uncommitted attempt.
		if (this.frameTransaction) return;
		this.scheduleRerender();
	}

	private scheduleRerender(): void {
		if (!this.rerenderFn) return;
		const trigger = this.rerenderFn;
		const lifecycleToken = this.lifecycleToken;
		queueMicrotask(() => {
			if (
				this.rerenderFn === trigger &&
				this.lifecycleToken === lifecycleToken &&
				this.dirty
			) {
				trigger();
			}
		});
	}

	private normalizePersistence<S>(
		persistent: PersistenceRequest<S>,
	): ResolvedPersistenceOptions | null {
		if (!persistent) return null;
		if (persistent === true) return { storageVersion: 1 };

		const storageVersion = persistent.storageVersion ?? 1;
		if (!Number.isSafeInteger(storageVersion) || storageVersion < 1) {
			throw new Error("[ism] storageVersion must be a positive safe integer.");
		}

		return {
			storageVersion,
			...(persistent.validateStoredState
				? {
						validateStoredState: (value: unknown) =>
							persistent.validateStoredState?.(value) ?? false,
					}
				: {}),
			...(persistent.migrateStoredState
				? {
						migrateStoredState: (
							value: unknown,
							fromVersion: number,
							toVersion: number,
						) => persistent.migrateStoredState?.(value, fromVersion, toVersion),
					}
				: {}),
			...(persistent.serialize
				? { serialize: (state: unknown) => persistent.serialize?.(state as S) }
				: {}),
			...(persistent.deserialize
				? { deserialize: persistent.deserialize }
				: {}),
		};
	}

	private resolvePersistenceForId(
		id: string,
		persistent: PersistenceRequest<unknown>,
	): ResolvedPersistenceOptions | null {
		const explicit = this.normalizePersistence(persistent);
		if (explicit) return explicit;
		return this.persistenceById.get(id) ?? null;
	}

	private getStorageKey(id: string): string {
		if (!this.storagePrefix) {
			throw new Error("[ism] No storage namespace is configured.");
		}
		return `${this.storagePrefix}${encodeURIComponent(id)}`;
	}

	private readPersistentState<S>(
		id: string,
		persistence: ResolvedPersistenceOptions,
	): StorageReadResult<S> {
		if (!this.storage) return { status: "missing" };
		const key = this.getStorageKey(id);

		let exists: boolean;
		try {
			exists = this.storage.has(key);
		} catch (error) {
			this.reportStorageFailure("has", key, error);
			return { status: "unavailable" };
		}
		if (!exists) return { status: "missing" };

		let raw: unknown;
		try {
			raw = this.storage.get(key);
		} catch (error) {
			this.reportStorageFailure("get", key, error);
			return { status: "unavailable" };
		}

		const currentVersion = persistence.storageVersion ?? 1;
		let storedVersion = currentVersion;
		let value = raw;
		let normalize = true;

		if (this.hasPersistedStateTag(raw)) {
			if (!this.isPersistedStateRecord(raw)) {
				this.reportStorageFailure(
					"validate",
					key,
					new Error("Stored state envelope is malformed."),
				);
				return { status: "invalid" };
			}
			storedVersion = raw.version;
			value = raw.value;
			normalize = false;
		}

		if (persistence.deserialize) {
			try {
				value = persistence.deserialize(value);
			} catch (error) {
				this.reportStorageFailure("deserialize", key, error);
				return { status: "invalid" };
			}
		}

		if (storedVersion !== currentVersion) {
			if (!persistence.migrateStoredState) {
				this.reportStorageFailure(
					"migrate",
					key,
					new Error(
						`Stored state version ${storedVersion} does not match ${currentVersion} and no migration hook is configured.`,
					),
				);
				return { status: "invalid" };
			}

			try {
				value = persistence.migrateStoredState(
					value,
					storedVersion,
					currentVersion,
				);
				normalize = true;
			} catch (error) {
				this.reportStorageFailure("migrate", key, error);
				return { status: "invalid" };
			}
		}

		if (persistence.validateStoredState) {
			let valid = false;
			try {
				valid = persistence.validateStoredState(value);
			} catch (error) {
				this.reportStorageFailure("validate", key, error);
				return { status: "invalid" };
			}

			if (!valid) {
				this.reportStorageFailure(
					"validate",
					key,
					new Error("Stored state failed validation."),
				);
				return { status: "invalid" };
			}
		}

		try {
			return {
				status: "found",
				value: structuredClone(value) as S,
				normalize,
			};
		} catch (error) {
			this.reportStorageFailure("validate", key, error);
			return { status: "invalid" };
		}
	}

	private writeStorage(
		id: string,
		value: unknown,
		persistence: ResolvedPersistenceOptions,
	): void {
		if (!this.storage) return;
		const key = this.getStorageKey(id);
		const mutation: PendingStorageSet = {
			kind: "set",
			value,
			persistence,
		};

		if (this.frameTransaction) {
			this.frameTransaction.pendingStorageMutations.set(key, mutation);
			return;
		}
		this.applyStorageMutation(key, mutation);
	}

	private deleteStorage(id: string): boolean {
		if (!this.storage) return false;
		return this.deleteStorageKey(this.getStorageKey(id));
	}

	private deleteStorageKey(key: string): boolean {
		if (!this.storage) return false;
		const mutation: PendingStorageDelete = { kind: "delete" };
		if (this.frameTransaction) {
			this.frameTransaction.pendingStorageMutations.set(key, mutation);
			return true;
		}
		return this.applyStorageMutation(key, mutation);
	}

	private applyStorageMutation(
		key: string,
		mutation: PendingStorageMutation,
	): boolean {
		if (!this.storage) return false;

		if (mutation.kind === "delete") {
			try {
				this.storage.delete(key);
				return true;
			} catch (error) {
				this.reportStorageFailure("delete", key, error);
				return false;
			}
		}

		let payload = mutation.value;
		if (mutation.persistence.serialize) {
			try {
				payload = mutation.persistence.serialize(payload);
			} catch (error) {
				this.reportStorageFailure("serialize", key, error);
				return false;
			}
		}

		const record: PersistedStateRecord = {
			__ismState: 1,
			version: mutation.persistence.storageVersion ?? 1,
			value: payload,
		};

		try {
			this.storage.set(key, record);
			return true;
		} catch (error) {
			this.reportStorageFailure("set", key, error);
			return false;
		}
	}

	private hasPersistedStateTag(value: unknown): boolean {
		return (
			value !== null &&
			typeof value === "object" &&
			(value as { __ismState?: unknown }).__ismState === 1
		);
	}

	private isPersistedStateRecord(
		value: unknown,
	): value is PersistedStateRecord {
		if (value === null || typeof value !== "object") return false;
		const record = value as Partial<PersistedStateRecord>;
		return (
			record.__ismState === 1 &&
			Number.isSafeInteger(record.version) &&
			(record.version ?? 0) >= 1 &&
			Object.hasOwn(record, "value")
		);
	}

	private reportStorageFailure(
		operation: StorageOperation,
		key: string | undefined,
		error: unknown,
	): void {
		const failure: StorageFailure = {
			operation,
			...(key === undefined ? {} : { key }),
			error,
		};

		let storageHookHandled = false;
		if (this.onStorageError) {
			try {
				this.onStorageError(failure);
				storageHookHandled = true;
			} catch (hookError) {
				this.emitRuntimeDiagnostic(
					"ISM_STORAGE_FAILURE",
					"error",
					"[ism] onStorageError hook threw while reporting a storage failure.",
					{ operation, ...(key ? { key } : {}) },
					hookError,
				);
			}
		}
		if (storageHookHandled && !this.onDiagnostic) return;

		this.emitRuntimeDiagnostic(
			"ISM_STORAGE_FAILURE",
			"error",
			`[ism] Storage ${operation} failed${key ? ` for "${key}"` : ""}.`,
			{ operation, ...(key ? { key } : {}) },
			error,
		);
	}

	private requireFrameTransaction(transactionId?: number): FrameTransaction {
		const transaction = this.frameTransaction;
		if (!transaction) {
			throw errors.createISMError(
				"ISM_FRAME_TRANSACTION",
				"[ism] No frame transaction is active.",
			);
		}
		if (transactionId !== undefined && transaction.id !== transactionId) {
			throw errors.createISMError(
				"ISM_FRAME_TRANSACTION",
				`[ism] Frame transaction ${transactionId} is no longer active.`,
				{ details: { transactionId, activeTransactionId: transaction.id } },
			);
		}
		return transaction;
	}

	/** Emit a structured diagnostic through this runtime's configured sink. @internal */
	reportDiagnostic(diagnostic: errors.ISMDiagnostic): void {
		errors.emitDiagnostic(this.onDiagnostic, {
			...diagnostic,
			runtimeId: diagnostic.runtimeId ?? this.instanceId,
		});
	}

	private emitRuntimeDiagnostic(
		code: errors.ISMErrorCode,
		level: errors.DiagnosticLevel,
		message: string,
		details?: Readonly<Record<string, unknown>>,
		cause?: unknown,
	): void {
		this.reportDiagnostic(
			errors.createDiagnostic(code, level, message, {
				...(details ? { details } : {}),
				...(cause !== undefined ? { cause } : {}),
			}),
		);
	}

	private reportInvariant(
		code: errors.ISMErrorCode,
		message: string,
		details?: Readonly<Record<string, unknown>>,
	): void {
		if (this.strictRuntime) {
			throw errors.createISMError(code, message, {
				...(details ? { details } : {}),
			});
		}
		this.emitRuntimeDiagnostic(code, "error", message, details);
	}

	private captureFrameTransactionSnapshot(): FrameTransactionSnapshot {
		return {
			frameRoot: this.frameRoot,
			stateStore: new Map(this.stateStore),
			stateDefaults: new Map(this.stateDefaults),
			persistenceById: new Map(this.persistenceById),
			contextStack: cloneMapOfArrays(this.contextStack),
			memoCache: this.cloneMemoCache(this.memoCache),
			memoKeysByWidgetId: cloneMapOfSets(this.memoKeysByWidgetId),
			memoLastSeenFrame: new Map(this.memoLastSeenFrame),
			memoCollisionCounter: new Map(this.memoCollisionCounter),
			idPrefixStack: [...this.idPrefixStack],
			idPrefix: this.idPrefix,
			collisionCounter: new Map(this.collisionCounter),
			usedFinalIds: new Set(this.usedFinalIds),
			duplicateWarned: new Set(this.duplicateWarned),
			activeLayerStack: [...this.activeLayerStack],
			focusedId: this.focusedId,
			ownedIds: new Set(this.ownedIds),
			stateLastSeenFrame: new Map(this.stateLastSeenFrame),
			frameGeneration: this.frameGeneration,
			treeMutationEpoch: this.treeMutationEpoch,
			lastInspectedTreeEpoch: this.lastInspectedTreeEpoch,
			scopeStack: [...this.scopeStack],
			dirty: this.dirty,
			treeRevision: this.treeRevision,
			stateRevision: this.stateRevision,
			lastTreeFingerprint: this.lastTreeFingerprint,
		};
	}

	private restoreFrameTransactionSnapshot(
		snapshot: FrameTransactionSnapshot,
	): void {
		this.frameRoot = snapshot.frameRoot;
		restoreMap(this.stateStore, snapshot.stateStore);
		restoreMap(this.stateDefaults, snapshot.stateDefaults);
		restoreMap(this.persistenceById, snapshot.persistenceById);
		restoreMap(this.contextStack, snapshot.contextStack);
		restoreMap(this.memoCache, snapshot.memoCache);
		restoreMap(this.memoKeysByWidgetId, snapshot.memoKeysByWidgetId);
		restoreMap(this.memoLastSeenFrame, snapshot.memoLastSeenFrame);
		restoreMap(this.memoCollisionCounter, snapshot.memoCollisionCounter);
		this.idPrefixStack = [...snapshot.idPrefixStack];
		this.idPrefix = snapshot.idPrefix;
		restoreMap(this.collisionCounter, snapshot.collisionCounter);
		restoreSet(this.usedFinalIds, snapshot.usedFinalIds);
		restoreSet(this.duplicateWarned, snapshot.duplicateWarned);
		this.activeLayerStack = [...snapshot.activeLayerStack];
		this.focusedId = snapshot.focusedId;
		restoreSet(this.ownedIds, snapshot.ownedIds);
		restoreMap(this.stateLastSeenFrame, snapshot.stateLastSeenFrame);
		this.frameGeneration = snapshot.frameGeneration;
		this.treeMutationEpoch = snapshot.treeMutationEpoch;
		this.lastInspectedTreeEpoch = snapshot.lastInspectedTreeEpoch;
		this.scopeStack = [...snapshot.scopeStack];
		this.dirty = snapshot.dirty;
		this.treeRevision = snapshot.treeRevision;
		this.stateRevision = snapshot.stateRevision;
		this.lastTreeFingerprint = snapshot.lastTreeFingerprint;
	}

	private cloneMemoCache(
		source: Map<string, MemoCacheEntry>,
	): Map<string, MemoCacheEntry> {
		return new Map(
			Array.from(source, ([key, value]) => [
				key,
				{
					deps: [...value.deps],
					subtree: this.cloneSubtree(value.subtree),
					widgetIds: [...value.widgetIds],
				},
			]),
		);
	}

	private refreshTreeInspectionRevision(): void {
		const treeFingerprint = this.computeTreeFingerprint();
		if (treeFingerprint !== this.lastTreeFingerprint) {
			this.lastTreeFingerprint = treeFingerprint;
			this.treeRevision++;
		}
		this.lastInspectedTreeEpoch = this.treeMutationEpoch;
	}

	private computeTreeFingerprint(): string {
		let firstHash = 0x811c9dc5;
		let secondHash = 0x9e3779b9;
		let nodeCount = 0;
		const mix = (value: string) => {
			for (let index = 0; index < value.length; index++) {
				const code = value.charCodeAt(index);
				firstHash = Math.imul(firstHash ^ code, 0x01000193);
				secondHash = Math.imul(secondHash ^ code, 0x85ebca6b);
			}
		};

		for (const [layer, entries] of this.frameRoot) {
			mix("<");
			mix(layer);
			mix("[");
			const stack: Array<{ entries: FrameEntry[]; index: number }> = [
				{ entries, index: 0 },
			];
			while (stack.length > 0) {
				const frame = stack[stack.length - 1];
				if (!frame) break;
				if (frame.index >= frame.entries.length) {
					mix("]");
					stack.pop();
					continue;
				}
				const entry = frame.entries[frame.index++];
				if (!entry) continue;
				nodeCount++;
				mix(entry.id);
				mix("[");
				stack.push({ entries: entry.children, index: 0 });
			}
			mix(">");
		}

		return `${nodeCount}:${firstHash >>> 0}:${secondHash >>> 0}`;
	}

	private reserveId(id: string): void {
		this.usedFinalIds.add(id);
		this.ownedIds.add(id);
		if (this.stateStore.has(id)) {
			this.stateLastSeenFrame.set(id, this.frameGeneration);
		}
	}

	private collectSubtreeIds(
		entries: FrameEntry[],
		refreshState = false,
	): string[] {
		const ids: string[] = [];
		const stack: FrameEntry[] = [];
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (entry) stack.push(entry);
		}
		while (stack.length > 0) {
			const entry = stack.pop();
			if (!entry) continue;
			ids.push(entry.id);
			if (refreshState && this.stateStore.has(entry.id)) {
				entry.renderState = this.stateStore.get(entry.id);
			}
			for (let index = entry.children.length - 1; index >= 0; index--) {
				const child = entry.children[index];
				if (child) stack.push(child);
			}
		}
		return ids;
	}

	private cloneSubtree(entries: FrameEntry[]): FrameEntry[] {
		const root: FrameEntry[] = [];
		const stack: Array<{
			source: FrameEntry[];
			target: FrameEntry[];
			index: number;
		}> = [{ source: entries, target: root, index: 0 }];

		while (stack.length > 0) {
			const frame = stack[stack.length - 1];
			if (!frame) break;
			if (frame.index >= frame.source.length) {
				stack.pop();
				continue;
			}
			const entry = frame.source[frame.index++];
			if (!entry) continue;
			const clone: FrameEntry = {
				...entry,
				args: [...entry.args],
				widgetProps: { ...entry.widgetProps },
				children: [],
			};
			frame.target.push(clone);
			if (entry.children.length > 0) {
				stack.push({
					source: entry.children,
					target: clone.children,
					index: 0,
				});
			}
		}
		return root;
	}

	private snapshotFrameLengths(): Map<FrameEntry[], number> {
		const snapshot = new Map<FrameEntry[], number>();
		const stack: FrameEntry[][] = Array.from(this.frameRoot.values());
		while (stack.length > 0) {
			const entries = stack.pop();
			if (!entries) continue;
			snapshot.set(entries, entries.length);
			for (const entry of entries) {
				if (entry.children.length > 0) stack.push(entry.children);
			}
		}
		return snapshot;
	}

	private restoreFrameSnapshot(
		rootSnapshot: Map<string, FrameEntry[]>,
		lengthSnapshot: Map<FrameEntry[], number>,
	): void {
		for (const [entries, length] of lengthSnapshot) entries.length = length;
		restoreMap(this.frameRoot, rootSnapshot);
	}
}

export function extractDisplayLabel(label: string): string {
	const tripleHashIndex = label.indexOf("###");
	if (tripleHashIndex !== -1) return label.slice(0, tripleHashIndex);
	const doubleHashIndex = label.indexOf("##");
	return doubleHashIndex === -1 ? label : label.slice(0, doubleHashIndex);
}

let activeRuntime: Runtime | null = null;
export const mountedRuntimes = new Set<Runtime>();

const MAX_CROSS_RUNTIME_WARNINGS = 256;
const crossRuntimeCollisionWarned = new Set<string>();

function rememberCrossRuntimeWarning(id: string): boolean {
	if (crossRuntimeCollisionWarned.has(id)) return false;
	if (crossRuntimeCollisionWarned.size >= MAX_CROSS_RUNTIME_WARNINGS) {
		const oldest = crossRuntimeCollisionWarned.values().next().value as
			| string
			| undefined;
		if (oldest !== undefined) crossRuntimeCollisionWarned.delete(oldest);
	}
	crossRuntimeCollisionWarned.add(id);
	return true;
}

export function getRuntimeForId(id: string): Runtime | undefined {
	let match: Runtime | undefined;
	for (const runtime of mountedRuntimes) {
		if (!runtime.ownsId(id)) continue;
		if (!match) {
			match = runtime;
			continue;
		}
		if (rememberCrossRuntimeWarning(id)) {
			match.reportDiagnostic(
				errors.createDiagnostic(
					"ISM_CROSS_RUNTIME_ID_COLLISION",
					"warning",
					`[ism] Multiple mounted apps produced the same widget id ('${id}'). Ids are unique within one createApp root, but routing for this id across roots is ambiguous.`,
					{ details: { id } },
				),
			);
		}
		break;
	}
	if (!match) crossRuntimeCollisionWarned.delete(id);
	return match;
}

export function getRuntimeByInstanceId(
	instanceId: string,
): Runtime | undefined {
	for (const runtime of mountedRuntimes) {
		if (runtime.getInstanceId() === instanceId) return runtime;
	}
	return undefined;
}

export function getActiveRuntime(): Runtime {
	if (!activeRuntime)
		throw errors.createISMError(
			"ISM_NO_ACTIVE_RUNTIME",
			errors.noActiveRuntime(),
		);
	return activeRuntime;
}

export function getActiveRuntimeOrNull(): Runtime | null {
	return activeRuntime;
}

export function setActiveRuntime(runtime: Runtime | null): void {
	activeRuntime = runtime;
}

export function withRuntime<T>(runtime: Runtime, fn: () => T): T {
	const previous = activeRuntime;
	activeRuntime = runtime;
	try {
		return fn();
	} finally {
		activeRuntime = previous;
	}
}
