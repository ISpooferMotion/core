/**
 * Immediate mode UI runtime for React.
 *
 * @packageDocumentation
 *
 * `createApp` runs a draw function and turns widget calls into a React tree.
 * `defineWidget` creates typed widgets with stable state and IDs.
 *
 * ## Quick start
 *
 * ```tsx
 * import { createApp, defineWidget } from "@ispoofermotion/core";
 * import "@ispoofermotion/core/styles.css";
 * import { createElement } from "react";
 *
 * const Counter = defineWidget<number, [label: string], void>({
 *   name: "Counter",
 *   defaultState: 0,
 *   render: ({ state, args, setState, widgetProps }) =>
 *     createElement(
 *       "button",
 *       {
 *         type: "button",
 *         ...widgetProps,
 *         onClick: () => setState((value) => value + 1),
 *       },
 *       `${args[0]}: ${state}`,
 *     ),
 *   getReturnValue: () => undefined,
 * });
 *
 * function draw() {
 *   Counter("Count");
 * }
 *
 * const App = createApp(draw);
 * ```
 *
 * Keep irreversible external side effects out of the draw pass. Runtime-owned
 * speculative state is committed only after React commits the frame.
 *
 * @since 1.0.0
 */

export type { IsmConfig, LayerMode } from "./config";
export {
	DEFAULT_LAYER_MODE,
	DEFAULT_LAYER_Z_INDEX,
	DEFAULT_SHOW_DEV_TOOLS,
	DEFAULT_STATE_RETENTION_FRAMES,
	DEFAULT_STRICT_IDS,
	DEFAULT_STRICT_RUNTIME,
	defineConfig,
} from "./config";
export type { AppHandle, AppOptions, IsmApp } from "./createApp";
export { createApp, useReactContext } from "./createApp";
export { defineWidget } from "./defineWidget";
export type {
	ErrorFallbackContext,
	ErrorFallbackProps,
	ISMCoreErrorBoundaryProps,
} from "./ErrorBoundary";
export {
	ErrorFallback,
	ISMCoreErrorBoundary,
	ISMLibErrorBoundary,
} from "./ErrorBoundary";
export type {
	DiagnosticLevel,
	DiagnosticSink,
	ISMDiagnostic,
	ISMErrorCode,
} from "./errors";
export { ISMError } from "./errors";
export { makeInteractive } from "./makeInteractive";
export { extractDisplayLabel } from "./runtime";
export type {
	PersistentStateOptions,
	StorageAdapter,
	StorageFailure,
	StorageOperation,
	WidgetA11y,
	WidgetConfig,
	WidgetProps,
	WidgetRenderProps,
} from "./types";
export { CORE_VERSION } from "./version";

import * as errors from "./errors";
import {
	getActiveRuntime,
	getActiveRuntimeOrNull,
	getRuntimeForId,
	mountedRuntimes,
} from "./runtime";
import type { FrameEntry } from "./types";

/**
 * Add a stable segment to widget IDs created after this call.
 *
 * Pair every call with {@link popId}. This is useful in loops where multiple
 * widgets have the same type and visible label.
 *
 * @param id Stable value for this part of the tree.
 *
 * @since 1.0.0
 */
export function pushId(id: string): void {
	const runtime = getActiveRuntime();

	if (!runtime.isDrawing()) {
		throw errors.createISMError(
			"ISM_ID_STACK_OUTSIDE_DRAW",
			errors.idStackOutsideDraw("pushId"),
		);
	}

	runtime.pushIdSegment(id);
}

/**
 * Remove the latest ID segment added by {@link pushId}.
 *
 * @since 1.0.0
 */
export function popId(): void {
	const runtime = getActiveRuntime();

	if (!runtime.isDrawing()) {
		throw errors.createISMError(
			"ISM_ID_STACK_OUTSIDE_DRAW",
			errors.idStackOutsideDraw("popId"),
		);
	}

	runtime.popIdSegment();
}

/** Run a draw closure under one stable ID segment and always restore the stack. */
export function withId<T>(id: string, drawClosure: () => T): T {
	pushId(id);
	try {
		return drawClosure();
	} finally {
		popId();
	}
}

/**
 * Add a value to the draw context stack for `key`.
 *
 * @since 2.0.0
 */
export function pushContext<T>(key: string, value: T): void {
	const runtime = getActiveRuntime();

	if (!runtime.isDrawing()) {
		throw errors.createISMError(
			"ISM_ID_STACK_OUTSIDE_DRAW",
			errors.idStackOutsideDraw("pushContext"),
		);
	}

	runtime.pushContext(key, value);
}

/**
 * Remove the latest draw context value for `key`.
 *
 * @since 2.0.0
 */
export function popContext(key: string): void {
	const runtime = getActiveRuntime();

	if (!runtime.isDrawing()) {
		throw errors.createISMError(
			"ISM_ID_STACK_OUTSIDE_DRAW",
			errors.idStackOutsideDraw("popContext"),
		);
	}

	runtime.popContext(key);
}

/**
 * Read the latest draw context value for `key`.
 *
 * @since 2.0.0
 */
export function getContext<T>(key: string): T | undefined {
	const runtime = getActiveRuntime();

	if (!runtime.isDrawing()) {
		throw errors.createISMError(
			"ISM_ID_STACK_OUTSIDE_DRAW",
			errors.idStackOutsideDraw("getContext"),
		);
	}

	return runtime.getContext<T>(key);
}

/** Run a draw closure with one context value and always restore the stack. */
export function withContext<T, R>(
	key: string,
	value: T,
	drawClosure: () => R,
): R {
	pushContext(key, value);
	try {
		return drawClosure();
	} finally {
		popContext(key);
	}
}

/**
 * Send following widgets to a named render layer.
 *
 * @since 2.0.0
 */
export function pushLayer(layerName: string): void {
	const runtime = getActiveRuntime();

	if (!runtime.isDrawing()) {
		throw errors.createISMError(
			"ISM_ID_STACK_OUTSIDE_DRAW",
			errors.idStackOutsideDraw("pushLayer"),
		);
	}

	runtime.pushLayer(layerName);
}

/**
 * Return to the previous render layer.
 *
 * @since 2.0.0
 */
export function popLayer(): void {
	const runtime = getActiveRuntime();

	if (!runtime.isDrawing()) {
		throw errors.createISMError(
			"ISM_ID_STACK_OUTSIDE_DRAW",
			errors.idStackOutsideDraw("popLayer"),
		);
	}

	runtime.popLayer();
}

/** Run a draw closure in one named layer and always restore the layer stack. */
export function withLayer<T>(layerName: string, drawClosure: () => T): T {
	pushLayer(layerName);
	try {
		return drawClosure();
	} finally {
		popLayer();
	}
}

function shallowEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
	if (a.length !== b.length) {
		return false;
	}

	for (let index = 0; index < a.length; index++) {
		if (a[index] !== b[index]) {
			return false;
		}
	}

	return true;
}

/**
 * Reuse a widget subtree while its dependency values stay equal.
 *
 * The closure runs again when a dependency changes or the cached IDs can no
 * longer be inserted safely. React hooks must not be called inside it.
 *
 * @param id Stable name for this memo block.
 * @param deps Values checked with shallow equality.
 * @param drawClosure Function that records the subtree.
 *
 * @since 2.0.0
 */
export function memoBlock(
	id: string,
	deps: readonly unknown[],
	drawClosure: () => void,
): void {
	const runtime = getActiveRuntime();

	if (!runtime.isDrawing()) {
		throw errors.createISMError(
			"ISM_ID_STACK_OUTSIDE_DRAW",
			errors.idStackOutsideDraw("memoBlock"),
		);
	}

	const identity = runtime.buildMemoIdentity(id);
	const cached = runtime.getMemo(identity.cacheKey);

	if (
		cached &&
		shallowEqual(cached.deps, deps) &&
		runtime.pushCachedSubtree(cached.subtree)
	) {
		return;
	}

	runtime.pushIdSegment(identity.idSegment);

	let subtree: FrameEntry[];

	try {
		subtree = runtime.captureSubtree(id, drawClosure);
	} finally {
		runtime.popIdSegment();
	}

	runtime.appendCapturedSubtree(subtree);
	runtime.setMemo(identity.cacheKey, deps, subtree);
}

/**
 * Set the focused widget ID.
 *
 * Pass `null` to clear focus.
 *
 * @since 2.0.0
 */
export function setFocus(id: string | null): void {
	const active = getActiveRuntimeOrNull();

	if (active) {
		active.setFocus(id);
		return;
	}

	const owner = id !== null ? getRuntimeForId(id) : undefined;

	if (owner) {
		owner.setFocus(id);
		return;
	}

	if (id === null) {
		for (const runtime of mountedRuntimes) runtime.setFocus(null);
	}
}

/**
 * Check whether a widget ID is currently focused.
 *
 * @since 2.0.0
 */
export function isFocused(id: string): boolean {
	const active = getActiveRuntimeOrNull();

	if (active) {
		return active.isFocused(id);
	}

	const owner = getRuntimeForId(id);

	if (owner) {
		return owner.isFocused(id);
	}

	for (const runtime of mountedRuntimes) {
		if (runtime.isFocused(id)) {
			return true;
		}
	}

	return false;
}

/**
 * Return the focused widget ID for the active runtime.
 *
 * @since 3.3.0
 */
export function getFocusedId(): string | null {
	const runtime = getActiveRuntime();
	return runtime.getFocusedId();
}

/**
 * Close the most recently opened scoped widget.
 *
 * @since 1.0.0
 */
export function end(): void {
	const runtime = getActiveRuntime();

	if (!runtime.isDrawing()) {
		throw errors.createISMError(
			"ISM_END_OUTSIDE_DRAW",
			errors.endOutsideDraw(),
		);
	}

	runtime.popScope();
}

/**
 * Ask every mounted runtime to draw another frame.
 *
 * Prefer the app-local `App.markDirty()` handle returned by {@link createApp}.
 * This global compatibility helper intentionally broadcasts to every mounted app.
 *
 * @since 1.0.0
 */
export function markDirty(): void {
	for (const runtime of mountedRuntimes) {
		runtime.markDirty();
	}
}
