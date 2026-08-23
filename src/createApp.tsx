import type * as React from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
	createElement,
	Fragment,
	lazy,
	Suspense,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
} from "react";
import type { IsmConfig, LayerMode } from "./config";
import { resolveConfig } from "./config";
import {
	type ErrorFallbackContext,
	ISMCoreErrorBoundary,
	SafeErrorFallback,
	shouldShowErrorDetailsByDefault,
} from "./ErrorBoundary";
import * as errors from "./errors";
import { getActiveRuntimeOrNull, Runtime, withRuntime } from "./runtime";
import type { FrameEntry, StorageAdapter, StorageFailure } from "./types";

const LazyDevToolsOverlay = lazy(async () => {
	const module = await import("./DevTools");
	return { default: module.DevToolsOverlay };
});

/**
 * Render one frame entry and its children.
 *
 * @internal
 */
function renderEntry(runtime: Runtime, entry: FrameEntry): ReactNode {
	const setState = (updater: unknown) => {
		runtime.setState(entry.id, updater, entry.persistence ?? false);
	};

	const children =
		entry.children.length > 0
			? createElement(
					Fragment,
					null,
					...entry.children.map((child) =>
						createElement(
							Fragment,
							{ key: child.id },
							renderEntry(runtime, child),
						),
					),
				)
			: null;

	const widget = entry.renderFn({
		id: entry.id,
		state: entry.renderState,
		runtimeId: runtime.getInstanceId(),
		setState,
		args: entry.args,
		children,
		widgetProps: entry.widgetProps,
	});

	if (!entry.a11yDescription) return widget;

	return createElement(
		Fragment,
		null,
		widget,
		createElement(
			"span",
			{
				id: runtime.getDomId("description", entry.id),
				style: {
					position: "absolute",
					width: "1px",
					height: "1px",
					padding: 0,
					margin: "-1px",
					overflow: "hidden",
					clip: "rect(0, 0, 0, 0)",
					whiteSpace: "nowrap",
					border: 0,
				},
			},
			entry.a11yDescription,
		),
	);
}

/**
 * Convert the frame buffer into a React tree.
 * Named layers are wrapped separately so their z index can be applied.
 *
 * @internal
 */
function renderFrameBuffer(
	runtime: Runtime,
	layers: Map<string, FrameEntry[]>,
	layerZIndex: number,
	layerMode: LayerMode,
): ReactNode {
	const layerElements: ReactNode[] = [];

	for (const [layerName, entries] of layers.entries()) {
		if (entries.length === 0) continue;

		const namedLayer = layerName !== "default";
		layerElements.push(
			createElement(
				"div",
				{
					key: `layer-${layerName}`,
					"data-ism-layer": layerName,
					style: namedLayer
						? {
								position: layerMode === "viewport" ? "fixed" : "absolute",
								inset: 0,
								pointerEvents: "none",
								zIndex: layerZIndex,
							}
						: { display: "contents" },
				},
				...entries.map((entry) =>
					createElement(
						Fragment,
						{ key: entry.id },
						renderEntry(runtime, entry),
					),
				),
			),
		);
	}

	return createElement(
		"div",
		{
			"data-ism-root": "",
			"data-ism-layer-host": "",
			style:
				layerMode === "root"
					? { position: "relative", isolation: "isolate" }
					: { position: "static" },
		},
		...layerElements,
	);
}

/**
 * Read a React context from the draw function passed to `createApp`.
 *
 * This calls React's `useContext` directly, so the normal Rules of Hooks still
 * apply. Call it on every frame and in the same order. Do not place it inside
 * a condition or inside `memoBlock`, since a memo cache hit can skip the call.
 */
export function useReactContext<T>(context: React.Context<T>): T {
	const runtime = getActiveRuntimeOrNull();
	if (runtime?.isCapturingMemo()) {
		throw errors.createISMError(
			"ISM_REACT_CONTEXT_IN_MEMO",
			errors.reactContextInsideMemoBlock(),
		);
	}
	return useContext(context);
}

/**
 * Options accepted by {@link createApp}.
 *
 * @since 3.2.0
 */
export interface AppOptions extends IsmConfig {
	/** Synchronous storage used by widgets with `persistent: true`. */
	storage?: StorageAdapter;
	/** Stable application namespace used to isolate persistent storage keys. */
	storageNamespace?: string;
	/** Receive recoverable adapter, serialization, validation, or migration failures. */
	onStorageError?: (failure: StorageFailure) => void;
	/** Receive every structured runtime diagnostic. */
	onDiagnostic?: errors.DiagnosticSink;
	/** Receive draw and widget-render errors. */
	onError?: (error: Error, info?: ErrorInfo) => void;
	/** Replace the built-in draw/render error panel. */
	renderErrorFallback?: (context: ErrorFallbackContext) => ReactNode;
	/** Reveal messages/stacks in the error panel. Defaults off in production. */
	showErrorDetails?: boolean;
}

/** App-local controls attached to the component returned by {@link createApp}. */
export interface AppHandle {
	/** Request another frame only for runtimes created by this app factory. */
	markDirty(): void;
	/** Set or clear focus within this app. Returns false when no local runtime can own the ID. */
	setFocus(id: string | null): boolean;
	/** Check focus within this app without consulting unrelated app roots. */
	isFocused(id: string): boolean;
	/** Return this app's focused logical ID, or null when none is focused/mounted. */
	getFocusedId(): string | null;
	/** Reset a live widget to its declared default state. */
	resetState(id: string): boolean;
	/** Clear persistence for persistent widgets known to this app. */
	clearPersistentState(): number;
	/** Clear every storage key under this app's stable namespace. */
	clearStorageNamespace(): number;
}

/** React component plus app-local runtime controls. */
export type IsmApp = React.FC & AppHandle;

/**
 * Create the React component that runs an immediate mode draw function.
 *
 * Each render records and prepares a speculative frame, then converts the
 * recorded widgets into React elements. Runtime-owned changes become committed
 * only after React commits that render; abandoned frames are aborted. The
 * returned component owns its runtime and clears that runtime when it unmounts.
 *
 * Widget calls belong inside `drawFn`. `useReactContext` is the only supported
 * React hook in that function, and it must follow the normal Rules of Hooks.
 *
 * @param drawFn Function that describes one UI frame.
 * @param options Runtime configuration and optional storage.
 * @returns A React component ready to mount.
 *
 * @since 1.0.0
 *
 * @example
 * ```ts
 * import { createApp } from "@ispoofermotion/core";
 * import { Button, Text } from "./widgets";
 *
 * function draw() {
 *   Text("Settings");
 *   Button("Save");
 * }
 *
 * const App = createApp(draw);
 * ```
 *
 * Keep irreversible external side effects out of `drawFn`. Runtime-owned
 * speculative changes are committed only after React commits the frame.
 */

export function createApp(drawFn: () => void, options?: AppOptions): IsmApp {
	const config = resolveConfig(options);
	const storage = options?.storage;
	const storageNamespace = options?.storageNamespace?.trim();
	const onStorageError = options?.onStorageError;
	const onDiagnostic = options?.onDiagnostic;
	const onError = options?.onError;
	const renderErrorFallback = options?.renderErrorFallback;
	const showErrorDetails =
		options?.showErrorDetails ?? shouldShowErrorDetailsByDefault();
	const localRuntimes = new Set<Runtime>();

	if (storage && !storageNamespace) {
		throw errors.createISMError(
			"ISM_STORAGE_FAILURE",
			"[ism] storageNamespace is required when a storage adapter is configured.",
			{ details: { operation: "namespace" } },
		);
	}

	function ISMCoreRenderer({ runtime }: { runtime: Runtime }) {
		const [drawRetryAttempt, requestDrawRetry] = useReducer(
			(attempt: number) => attempt + 1,
			0,
		);
		const lastSuccessfulRetryAttempt = useRef(0);

		// Record the current frame as plain runtime data. withRuntime always
		// restores the previous active runtime, including on failure.
		let drawError: Error | null = null;
		let frameTransactionId: number | null = null;

		withRuntime(runtime, () => {
			frameTransactionId = runtime.beginFrame(true);
			try {
				drawFn();
				runtime.prepareFrame(frameTransactionId);
			} catch (err: unknown) {
				runtime.abortFrame(frameTransactionId);
				drawError = err instanceof Error ? err : new Error(String(err));
				errors.emitDiagnostic(
					onDiagnostic,
					errors.createDiagnostic(
						errors.getErrorCode(drawError, "ISM_DRAW_ERROR"),
						"error",
						"[ism] Uncaught error in draw function.",
						{ cause: drawError, runtimeId: runtime.getInstanceId() },
					),
				);
				try {
					onError?.(drawError);
				} catch (hookError) {
					errors.emitDiagnostic(
						onDiagnostic,
						errors.createDiagnostic(
							errors.getErrorCode(drawError, "ISM_DRAW_ERROR"),
							"error",
							"[ism] onError hook threw while handling a draw failure.",
							{ cause: hookError, runtimeId: runtime.getInstanceId() },
						),
					);
				}
			}
		});

		// Runtime mutations made while drawing remain speculative until React
		// commits this render. Abandoned/replayed renders never run this effect.
		useLayoutEffect(() => {
			if (frameTransactionId !== null && drawError === null) {
				runtime.commitFrame(frameTransactionId);
				lastSuccessfulRetryAttempt.current = drawRetryAttempt;
			}
			return () => {
				if (frameTransactionId !== null) {
					runtime.abortFrame(frameTransactionId);
				}
			};
		});

		if (drawError) {
			const context: ErrorFallbackContext = {
				title: "Draw function error",
				error: drawError,
				kind: "draw",
				errorCode: errors.getErrorCode(drawError, "ISM_DRAW_ERROR"),
				showErrorDetails,
				retryFailed: drawRetryAttempt > lastSuccessfulRetryAttempt.current,
				onRetry: requestDrawRetry,
			};
			return createElement(SafeErrorFallback, {
				context,
				...(renderErrorFallback ? { renderFallback: renderErrorFallback } : {}),
				...(onDiagnostic ? { onDiagnostic } : {}),
			});
		}

		const frameBuffer = runtime.getFrameBuffer();
		const renderedFrame = withRuntime(runtime, () =>
			renderFrameBuffer(
				runtime,
				frameBuffer,
				config.layerZIndex,
				config.layerMode,
			),
		);
		if (!config.showDevTools) return renderedFrame;
		return createElement(
			Fragment,
			null,
			renderedFrame,
			createElement(
				Suspense,
				{ fallback: null },
				createElement(LazyDevToolsOverlay, {
					runtime,
					zIndex: config.layerZIndex + 1,
				}),
			),
		);
	}

	ISMCoreRenderer.displayName = "ISMCoreRenderer";

	// Own the Runtime above the error boundary. Replacing a failed renderer with
	// the boundary fallback must never destroy the application's committed state.
	function ISMCoreApp() {
		const runtime = useMemo(
			() =>
				new Runtime(
					storage,
					storageNamespace,
					onStorageError,
					config.strictIds,
					config.strictRuntime,
					onDiagnostic,
					config.stateRetentionFrames,
				),
			[],
		);
		const [, forceRender] = useReducer((x: number) => x + 1, 0);

		useEffect(() => {
			runtime.registerApp(forceRender);
			localRuntimes.add(runtime);
			return () => {
				localRuntimes.delete(runtime);
				runtime.unregisterApp();
			};
		}, [runtime]);

		return (
			<ISMCoreErrorBoundary
				{...(onError
					? { onError: (error: Error, info: ErrorInfo) => onError(error, info) }
					: {})}
				{...(renderErrorFallback
					? { renderFallback: renderErrorFallback }
					: {})}
				showErrorDetails={showErrorDetails}
				{...(onDiagnostic ? { onDiagnostic } : {})}
			>
				<ISMCoreRenderer runtime={runtime} />
			</ISMCoreErrorBoundary>
		);
	}
	ISMCoreApp.displayName = "ISMCoreApp";

	const app = ISMCoreApp as unknown as IsmApp;
	app.markDirty = () => {
		for (const runtime of localRuntimes) runtime.markDirty();
	};
	app.setFocus = (id: string | null) => {
		if (id === null) {
			for (const runtime of localRuntimes) runtime.setFocus(null);
			return localRuntimes.size > 0;
		}

		for (const runtime of localRuntimes) {
			if (runtime.ownsId(id)) {
				runtime.setFocus(id);
				return true;
			}
		}

		if (localRuntimes.size === 1) {
			const runtime = localRuntimes.values().next().value as Runtime;
			runtime.setFocus(id);
			return true;
		}
		return false;
	};
	app.isFocused = (id: string) => {
		for (const runtime of localRuntimes) {
			if (runtime.isFocused(id)) return true;
		}
		return false;
	};
	app.getFocusedId = () => {
		let focused: string | null = null;
		for (const runtime of localRuntimes) {
			const candidate = runtime.getFocusedId();
			if (candidate === null) continue;
			if (focused !== null && focused !== candidate) {
				throw new Error(
					"[ism] This createApp component is mounted more than once with different focused widgets.",
				);
			}
			focused = candidate;
		}
		return focused;
	};
	app.resetState = (id: string) => {
		for (const runtime of localRuntimes) {
			if (runtime.ownsId(id)) return runtime.resetState(id);
		}
		return false;
	};
	app.clearPersistentState = () => {
		let cleared = 0;
		for (const runtime of localRuntimes)
			cleared += runtime.clearPersistentState();
		return cleared;
	};
	app.clearStorageNamespace = () => {
		let cleared = 0;
		for (const runtime of localRuntimes)
			cleared += runtime.clearStorageNamespace();
		return cleared;
	};

	return app;
}
