import type { CSSProperties, ErrorInfo, ReactNode } from "react";
import { Component, createElement, useEffect, useRef, useState } from "react";
import * as errors from "./errors";
import { CORE_VERSION } from "./version";

/** Context passed to a custom application error fallback. */
export interface ErrorFallbackContext {
	title: string;
	error: Error;
	info?: ErrorInfo;
	kind: "render" | "draw";
	errorCode: errors.ISMErrorCode;
	showErrorDetails: boolean;
	/** True when the latest recovery attempt immediately failed again. */
	retryFailed?: boolean;
	onRetry?: () => void | Promise<void>;
}

export interface ISMCoreErrorBoundaryProps {
	children: ReactNode;
	/** Called after the boundary catches a render error. */
	onError?: (error: Error, info: ErrorInfo) => void;
	/** Render a consumer-defined replacement instead of the built-in fallback. */
	renderFallback?: (context: ErrorFallbackContext) => ReactNode;
	/** Include message/stack/component details in the built-in fallback. */
	showErrorDetails?: boolean;
	/** Receive the structured render failure diagnostic. */
	onDiagnostic?: errors.DiagnosticSink;
}

interface State {
	error: Error | null;
	info: ErrorInfo | null;
	retrying: boolean;
	retryFailed: boolean;
}

/**
 * Default detailed-error policy.
 *
 * Details are shown only when a Node-style environment explicitly identifies
 * itself as non-production. Unknown/browser environments fail closed so a
 * missing `process` shim can never accidentally expose stack traces.
 */
export function shouldShowErrorDetailsByDefault(): boolean {
	return (
		typeof process !== "undefined" &&
		typeof process.env.NODE_ENV === "string" &&
		process.env.NODE_ENV !== "production"
	);
}

const fallbackStyles = {
	container: {
		display: "flex",
		flexDirection: "column",
		gap: "18px",
		padding: "20px",
		fontFamily:
			'Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
		color: "#ededed",
		backgroundColor: "#0a0a0a",
		border: "1px solid #2e2e2e",
		borderRadius: "10px",
		margin: "16px",
		boxShadow: "0 16px 48px rgba(0, 0, 0, 0.38)",
		maxWidth: "680px",
		boxSizing: "border-box",
		maxHeight: "calc(100vh - 32px)",
		overflowX: "hidden",
		overflowY: "auto",
		overscrollBehavior: "contain",
		colorScheme: "dark",
	},
	header: {
		display: "flex",
		alignItems: "flex-start",
		gap: "12px",
	},
	iconTile: {
		display: "grid",
		placeItems: "center",
		width: "34px",
		height: "34px",
		flexShrink: 0,
		border: "1px solid #3a1f21",
		borderRadius: "8px",
		backgroundColor: "#1a1011",
		color: "#ff6166",
	},
	icon: {
		width: "18px",
		height: "18px",
	},
	headerText: { minWidth: 0, flex: 1 },
	title: {
		margin: 0,
		fontSize: "16px",
		lineHeight: 1.35,
		fontWeight: 600,
		letterSpacing: "-0.01em",
		color: "#ededed",
	},
	subtitle: {
		margin: "4px 0 0",
		fontSize: "13px",
		lineHeight: 1.5,
		color: "#a1a1a1",
	},
	messageBox: {
		backgroundColor: "#111111",
		padding: "12px 14px",
		borderRadius: "8px",
		border: "1px solid #262626",
	},
	messageCode: {
		fontFamily:
			'"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
		fontSize: "12px",
		lineHeight: 1.55,
		color: "#d4d4d4",
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
	},
	metaRow: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
		flexWrap: "wrap",
		fontSize: "12px",
		color: "#888888",
	},
	codeBadge: {
		padding: "3px 7px",
		border: "1px solid #2e2e2e",
		borderRadius: "6px",
		backgroundColor: "#111111",
		fontFamily:
			'"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
		color: "#b8b8b8",
	},
	hint: {
		margin: 0,
		fontSize: "13px",
		lineHeight: 1.55,
		color: "#a1a1a1",
	},
	status: {
		padding: "9px 11px",
		border: "1px solid #422225",
		borderRadius: "7px",
		backgroundColor: "#160e0f",
		fontSize: "12px",
		lineHeight: 1.45,
		color: "#ff8b8f",
	},
	actions: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
		flexWrap: "wrap",
	},
	primaryButton: {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		gap: "7px",
		minHeight: "32px",
		color: "#0a0a0a",
		borderRadius: "7px",
		padding: "6px 12px",
		fontSize: "13px",
		fontWeight: 550,
		cursor: "pointer",
		userSelect: "none",
	},
	secondaryButton: {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		minHeight: "32px",
		color: "#ededed",
		borderRadius: "7px",
		padding: "6px 12px",
		fontSize: "13px",
		fontWeight: 500,
		cursor: "pointer",
		userSelect: "none",
	},
	spinner: {
		width: "11px",
		height: "11px",
		border: "1.5px solid rgba(10, 10, 10, 0.3)",
		borderTopColor: "#0a0a0a",
		borderRadius: "999px",
	},
	details: {
		borderTop: "1px solid #242424",
		paddingTop: "14px",
	},
	detailsSummary: {
		cursor: "pointer",
		fontSize: "12px",
		fontWeight: 500,
		userSelect: "none",
	},
	tipsList: {
		margin: "12px 0 0",
		paddingLeft: "20px",
		fontSize: "12px",
		color: "#a1a1a1",
		lineHeight: 1.55,
	},
	stackBox: {
		marginTop: "12px",
		backgroundColor: "#050505",
		padding: "12px",
		borderRadius: "7px",
		border: "1px solid #202020",
		overflowX: "auto",
	},
	stackPre: {
		margin: 0,
		fontFamily:
			'"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
		fontSize: "11px",
		lineHeight: 1.55,
		color: "#8f8f8f",
		whiteSpace: "pre",
	},
} satisfies Record<string, CSSProperties>;

export interface ErrorFallbackProps {
	title: string;
	error: Error | string;
	info?: ErrorInfo;
	/** Select the tips shown for this error source. */
	kind?: "render" | "draw";
	/** Stable code displayed even when sensitive details are hidden. */
	errorCode?: errors.ISMErrorCode;
	/** Hide messages/stacks in production-safe mode. */
	showErrorDetails?: boolean;
	/** Indicates that the latest retry immediately reached an error again. */
	retryFailed?: boolean;
	/** Show a retry button when a recovery callback is available. */
	onRetry?: () => void | Promise<void>;
}

function recoveryTips(
	errorCode: errors.ISMErrorCode,
	kind: "render" | "draw",
): readonly string[] {
	switch (errorCode) {
		case "ISM_DUPLICATE_ID":
		case "ISM_DUPLICATE_ID_STRICT":
			return [
				"Give repeated widgets stable unique IDs with withId(), pushId(), or an explicit ##/### suffix.",
				"Verify loops do not render the same logical widget identity more than once in a scope.",
			];
		case "ISM_UNCLOSED_SCOPES":
		case "ISM_END_WITHOUT_SCOPE":
			return [
				"Match every scoped widget with exactly one end() call.",
				"Prefer structured helpers around conditional branches so scope cleanup cannot be skipped.",
			];
		case "ISM_UNBALANCED_ID_STACK":
		case "ISM_POP_ID_EMPTY":
			return [
				"Match every pushId() with popId(), or use withId() so cleanup is automatic.",
			];
		case "ISM_UNBALANCED_CONTEXT":
			return [
				"Match every pushContext() with popContext(), or use withContext() for automatic cleanup.",
			];
		case "ISM_UNBALANCED_LAYER_STACK":
		case "ISM_POP_DEFAULT_LAYER":
			return [
				"Match every pushLayer() with popLayer(), or use withLayer() for automatic cleanup.",
			];
		case "ISM_STORAGE_FAILURE":
			return [
				"Check the configured storage adapter and storageNamespace, then verify reads/writes do not throw.",
			];
		case "ISM_DEFAULT_STATE_CLONE_FAILURE":
		case "ISM_DEFAULT_STATE_NOT_CLONEABLE":
		case "ISM_INVALID_DEFAULT_STATE":
			return [
				"Use structured-cloneable default state and avoid functions, DOM nodes, Symbols, or class instances.",
			];
		case "ISM_REACT_CONTEXT_IN_MEMO":
			return [
				"Read React context before memoBlock() and include the value in the memo dependency list.",
			];
		default:
			return kind === "render"
				? [
						"Check the widget render function named by the stack and make sure it returns valid React content without throwing.",
						"If the failure depends on external state, fix that condition and retry without remounting the app.",
					]
				: [
						"Check the draw function for thrown exceptions, invalid state, or undefined values.",
						"Verify every scope, ID, context, and layer push has a matching cleanup operation.",
					];
	}
}

function buildDiagnosticText({
	error,
	info,
	kind,
	errorCode,
	showErrorDetails,
}: {
	error: Error | string;
	info?: ErrorInfo;
	kind: "render" | "draw";
	errorCode: errors.ISMErrorCode;
	showErrorDetails: boolean;
}): string {
	const lines = [
		`ISM Core ${CORE_VERSION}`,
		`Error code: ${errorCode}`,
		`Source: ${kind}`,
	];
	if (showErrorDetails) {
		const message = error instanceof Error ? error.message : String(error);
		lines.push(`Message: ${message}`);
		if (error instanceof Error && error.stack) {
			lines.push("", "Stack:", error.stack);
		}
		if (info?.componentStack) {
			lines.push("", "Component stack:", info.componentStack);
		}
	}
	return lines.join("\n");
}

async function copyText(text: string): Promise<void> {
	if (
		typeof navigator !== "undefined" &&
		navigator.clipboard &&
		typeof navigator.clipboard.writeText === "function"
	) {
		await navigator.clipboard.writeText(text);
		return;
	}

	if (typeof document === "undefined") {
		throw new Error("Clipboard access is unavailable in this environment.");
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	document.body.appendChild(textarea);
	textarea.select();
	const copied =
		typeof document.execCommand === "function" && document.execCommand("copy");
	textarea.remove();
	if (!copied) throw new Error("Clipboard access was rejected.");
}

function ErrorIcon(): ReactNode {
	return createElement(
		"span",
		{ style: fallbackStyles.iconTile, "aria-hidden": "true" },
		createElement(
			"svg",
			{
				viewBox: "0 0 20 20",
				fill: "none",
				style: fallbackStyles.icon,
			},
			createElement("path", {
				d: "M6.4 3.5h7.2l2.9 2.9v7.2l-2.9 2.9H6.4l-2.9-2.9V6.4l2.9-2.9Z",
				fill: "currentColor",
				opacity: "0.16",
			}),
			createElement("path", {
				d: "m7.25 7.25 5.5 5.5m0-5.5-5.5 5.5",
				stroke: "currentColor",
				strokeWidth: "1.55",
				strokeLinecap: "round",
			}),
		),
	);
}

/** Render the error panel used for draw and widget render failures. */
export function ErrorFallback({
	title,
	error,
	info,
	kind = "render",
	errorCode = kind === "draw" ? "ISM_DRAW_ERROR" : "ISM_WIDGET_RENDER_ERROR",
	showErrorDetails = shouldShowErrorDetailsByDefault(),
	retryFailed = false,
	onRetry,
}: ErrorFallbackProps): ReactNode {
	const [isRetrying, setIsRetrying] = useState(false);
	const [retryInvocationFailed, setRetryInvocationFailed] = useState(false);
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
		"idle",
	);
	const mounted = useRef(true);
	const retryButtonRef = useRef<HTMLButtonElement | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			if (timer.current !== null) clearTimeout(timer.current);
			if (copyTimer.current !== null) clearTimeout(copyTimer.current);
		};
	}, []);

	useEffect(() => {
		if (!retryFailed) return;
		setIsRetrying(false);
		retryButtonRef.current?.focus();
	}, [retryFailed]);

	const originalMessage =
		error instanceof Error ? error.message : String(error);
	const errorMessage = showErrorDetails
		? originalMessage
		: kind === "draw"
			? "Core could not complete the current draw frame."
			: "Core could not render the current widget tree.";
	const stackTrace =
		showErrorDetails && error instanceof Error ? error.stack : undefined;
	const tips = recoveryTips(errorCode, kind);
	const failedRetry = retryFailed || retryInvocationFailed;

	const handleRetry = () => {
		if (!onRetry || isRetrying) return;
		setRetryInvocationFailed(false);
		setIsRetrying(true);
		if (timer.current !== null) clearTimeout(timer.current);

		// Give the pressed/retrying state a chance to paint before the recovery
		// render begins. This avoids a successful or immediate re-failure looking
		// like the button never reacted.
		timer.current = setTimeout(() => {
			timer.current = null;
			if (!mounted.current) return;
			try {
				const result = onRetry();
				Promise.resolve(result).then(
					() => {
						if (!mounted.current) return;
						timer.current = setTimeout(() => {
							timer.current = null;
							if (mounted.current) setIsRetrying(false);
						}, 240);
					},
					() => {
						if (!mounted.current) return;
						setIsRetrying(false);
						setRetryInvocationFailed(true);
						retryButtonRef.current?.focus();
					},
				);
			} catch {
				setIsRetrying(false);
				setRetryInvocationFailed(true);
				retryButtonRef.current?.focus();
			}
		}, 80);
	};

	const handleCopy = async () => {
		if (copyState === "copied") return;
		try {
			await copyText(
				buildDiagnosticText({
					error,
					...(info ? { info } : {}),
					kind,
					errorCode,
					showErrorDetails,
				}),
			);
			if (!mounted.current) return;
			setCopyState("copied");
		} catch {
			if (!mounted.current) return;
			setCopyState("failed");
		}
		if (copyTimer.current !== null) clearTimeout(copyTimer.current);
		copyTimer.current = setTimeout(() => {
			copyTimer.current = null;
			if (mounted.current) setCopyState("idle");
		}, 1600);
	};

	return createElement(
		"div",
		{
			"data-ism-error": "",
			"data-ism-error-code": errorCode,
			"data-ism-retry-state": failedRetry
				? "failed"
				: isRetrying
					? "retrying"
					: "idle",
			className: "ism-error-fallback",
			style: fallbackStyles.container,
		},
		createElement(
			"div",
			{ style: fallbackStyles.header },
			createElement(ErrorIcon),
			createElement(
				"div",
				{ style: fallbackStyles.headerText },
				createElement(
					"div",
					{ role: "alert", "aria-atomic": "true" },
					createElement("h2", { style: fallbackStyles.title }, title),
					createElement(
						"p",
						{ style: fallbackStyles.subtitle },
						"Core stopped this frame before the failure could corrupt committed UI state.",
					),
				),
			),
		),
		createElement(
			"div",
			{ style: fallbackStyles.messageBox },
			createElement(
				"code",
				{ style: fallbackStyles.messageCode },
				errorMessage,
			),
		),
		createElement(
			"div",
			{ style: fallbackStyles.metaRow },
			createElement("span", null, "Error code"),
			createElement("code", { style: fallbackStyles.codeBadge }, errorCode),
		),
		createElement("p", { style: fallbackStyles.hint }, tips[0]),
		failedRetry
			? createElement(
					"div",
					{
						role: "status",
						"aria-live": "polite",
						style: fallbackStyles.status,
					},
					retryInvocationFailed
						? "Retry failed because the recovery callback threw. Fix the callback or underlying condition, then try again."
						: "Retry failed. The same error is still present. Fix the underlying condition, then try again.",
				)
			: null,
		createElement(
			"div",
			{ style: fallbackStyles.actions },
			onRetry
				? createElement(
						"button",
						{
							ref: retryButtonRef,
							type: "button" as const,
							onClick: handleRetry,
							disabled: isRetrying,
							className: "ism-error-action ism-error-action-primary",
							style: {
								...fallbackStyles.primaryButton,
								...(isRetrying ? { cursor: "wait", opacity: 0.78 } : {}),
							},
						},
						isRetrying
							? createElement("span", {
									className: "ism-error-spinner",
									style: fallbackStyles.spinner,
									"aria-hidden": "true",
								})
							: null,
						isRetrying ? "Retrying..." : "Try again",
					)
				: null,
			createElement(
				"button",
				{
					type: "button" as const,
					onClick: handleCopy,
					className: "ism-error-action ism-error-action-secondary",
					style: fallbackStyles.secondaryButton,
					"aria-label": "Copy error details",
				},
				copyState === "copied"
					? "Copied"
					: copyState === "failed"
						? "Copy failed"
						: "Copy details",
			),
		),
		showErrorDetails
			? createElement(
					"details",
					{ style: fallbackStyles.details },
					createElement(
						"summary",
						{
							className: "ism-error-details-summary",
							style: fallbackStyles.detailsSummary,
						},
						"Technical details",
					),
					createElement(
						"ul",
						{ style: fallbackStyles.tipsList },
						...tips.map((tip) => createElement("li", { key: tip }, tip)),
					),
					stackTrace || info?.componentStack
						? createElement(
								"div",
								{ style: fallbackStyles.stackBox },
								createElement(
									"pre",
									{ style: fallbackStyles.stackPre },
									stackTrace ?? "",
									info?.componentStack
										? `${stackTrace ? "\n\n" : ""}Component stack:\n${info.componentStack}`
										: "",
								),
							)
						: null,
				)
			: null,
	);
}

interface SafeErrorFallbackProps {
	context: ErrorFallbackContext;
	renderFallback?: (context: ErrorFallbackContext) => ReactNode;
	onDiagnostic?: errors.DiagnosticSink;
}

interface FallbackSafetyBoundaryProps {
	children?: ReactNode;
	fallback: ReactNode;
	context: ErrorFallbackContext;
	onDiagnostic?: errors.DiagnosticSink;
}

class FallbackSafetyBoundary extends Component<
	FallbackSafetyBoundaryProps,
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: true } {
		return { failed: true };
	}

	componentDidCatch(error: Error): void {
		errors.emitDiagnostic(
			this.props.onDiagnostic,
			errors.createDiagnostic(
				this.props.context.errorCode,
				"error",
				"[ism] Custom error fallback threw while handling an existing failure. The built-in fallback was restored.",
				{ cause: error },
			),
		);
	}

	render(): ReactNode {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

function CustomFallbackRenderer({
	renderFallback,
	context,
}: Required<Pick<SafeErrorFallbackProps, "renderFallback" | "context">>) {
	return renderFallback(context);
}

/**
 * Render a consumer fallback behind a second safety boundary so an error in the
 * custom fallback itself can never replace Core's last-resort error UI.
 *
 * @internal
 */
export function SafeErrorFallback({
	context,
	renderFallback,
	onDiagnostic,
}: SafeErrorFallbackProps): ReactNode {
	const builtin = createElement(ErrorFallback, context);
	if (!renderFallback) return builtin;
	return createElement(
		FallbackSafetyBoundary,
		{ fallback: builtin, context, ...(onDiagnostic ? { onDiagnostic } : {}) },
		createElement(CustomFallbackRenderer, { renderFallback, context }),
	);
}

/** React error boundary used by `@ispoofermotion/core` apps. */
export class ISMCoreErrorBoundary extends Component<
	ISMCoreErrorBoundaryProps,
	State
> {
	state: State = {
		error: null,
		info: null,
		retrying: false,
		retryFailed: false,
	};

	static getDerivedStateFromError(error: Error): Pick<State, "error"> {
		return { error };
	}

	componentDidCatch = (error: Error, info: ErrorInfo): void => {
		const retryFailed = this.state.retrying;
		this.setState({ info, retrying: false, retryFailed });
		try {
			this.props.onError?.(error, info);
		} catch (hookError) {
			errors.emitDiagnostic(
				this.props.onDiagnostic,
				errors.createDiagnostic(
					errors.getErrorCode(error, "ISM_WIDGET_RENDER_ERROR"),
					"error",
					"[ism] onError hook threw while handling a widget render failure.",
					{ cause: hookError },
				),
			);
		}
		errors.emitDiagnostic(
			this.props.onDiagnostic,
			errors.createDiagnostic(
				errors.getErrorCode(error, "ISM_WIDGET_RENDER_ERROR"),
				"error",
				"[ism] Uncaught error in widget render.",
				{
					cause: error,
					details: { componentStack: info.componentStack },
				},
			),
		);
	};

	componentDidUpdate(
		_previousProps: ISMCoreErrorBoundaryProps,
		previousState: State,
	) {
		if (
			previousState.error !== null &&
			this.state.error === null &&
			this.state.retrying
		) {
			this.setState({ retrying: false, retryFailed: false });
		}
	}

	private resetError = (): void => {
		this.setState({
			error: null,
			info: null,
			retrying: true,
			retryFailed: false,
		});
	};

	render(): ReactNode {
		if (this.state.error) {
			const context: ErrorFallbackContext = {
				title: "Widget render error",
				error: this.state.error,
				...(this.state.info ? { info: this.state.info } : {}),
				kind: "render",
				errorCode: errors.getErrorCode(
					this.state.error,
					"ISM_WIDGET_RENDER_ERROR",
				),
				showErrorDetails:
					this.props.showErrorDetails ?? shouldShowErrorDetailsByDefault(),
				retryFailed: this.state.retryFailed,
				onRetry: this.resetError,
			};
			return createElement(SafeErrorFallback, {
				context,
				...(this.props.renderFallback
					? { renderFallback: this.props.renderFallback }
					: {}),
				...(this.props.onDiagnostic
					? { onDiagnostic: this.props.onDiagnostic }
					: {}),
			});
		}
		return this.props.children;
	}
}

/** @deprecated Since 3.0.0. Use `ISMCoreErrorBoundary`. */
export { ISMCoreErrorBoundary as ISMLibErrorBoundary };
