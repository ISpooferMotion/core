import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createElement, useEffect, useRef, useState } from "react";
import { installDevToolsProtocol } from "./devtoolsProtocol";
import {
	serializeInspectorState,
	serializeInspectorTree,
} from "./inspectorSerializer";
import type { Runtime } from "./runtime";

type Tab = "Elements" | "State";
const TABS: readonly Tab[] = ["Elements", "State"];

interface InspectorCache {
	elementsRevision: number;
	stateRevision: number;
	elements: string;
	state: string;
}

const snapshotCache = new WeakMap<Runtime, InspectorCache>();

function getInspectorText(runtime: Runtime, tab: Tab): string {
	let cache = snapshotCache.get(runtime);
	if (!cache) {
		cache = {
			elementsRevision: -1,
			stateRevision: -1,
			elements: "",
			state: "",
		};
		snapshotCache.set(runtime, cache);
	}

	if (tab === "Elements") {
		const revision = runtime.getInspectionRevision("tree");
		if (cache.elementsRevision !== revision) {
			cache.elements = Array.from(runtime.getTree().entries())
				.map(
					([layer, entries]) =>
						`[layer: ${layer}]\n${serializeInspectorTree(entries) || "  (empty)"}`,
				)
				.join("\n\n");
			cache.elementsRevision = revision;
		}
		return cache.elements || "(no widgets rendered)";
	}

	const revision = runtime.getInspectionRevision("state");
	if (cache.stateRevision !== revision) {
		const stateEntries = Array.from(runtime.getStateStore().entries()).map(
			([entryId, value]) => `${entryId}:\n${serializeInspectorState(value)}`,
		);
		cache.state =
			stateEntries.length > 0 ? stateEntries.join("\n---\n") : "(empty)";
		cache.stateRevision = revision;
	}
	return cache.state || "(empty)";
}

function DevToolsIcon(): ReactNode {
	return createElement(
		"svg",
		{
			viewBox: "0 0 16 16",
			width: 13,
			height: 13,
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.35,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			"aria-hidden": "true",
		},
		createElement("path", { d: "M2.5 3.5h11v9h-11z" }),
		createElement("path", { d: "m5 6 2 2-2 2M8.5 10h2.5" }),
	);
}

function CloseIcon(): ReactNode {
	return createElement(
		"svg",
		{
			viewBox: "0 0 16 16",
			width: 13,
			height: 13,
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.5,
			strokeLinecap: "round",
			"aria-hidden": "true",
		},
		createElement("path", { d: "m4.5 4.5 7 7m0-7-7 7" }),
	);
}

export interface DevToolsOverlayProps {
	runtime: Runtime;
	/** Stacking level supplied by the app rather than hard-coded by DevTools. */
	zIndex: number;
}

/** Lazily loaded React inspector used by `createApp({ showDevTools: true })`. */
export function DevToolsOverlay({
	runtime,
	zIndex,
}: DevToolsOverlayProps): ReturnType<typeof createElement> {
	const [expanded, setExpanded] = useState(false);
	const [activeTab, setActiveTab] = useState<Tab>("Elements");
	const openButtonRef = useRef<HTMLButtonElement | null>(null);
	const restoreOpenerFocus = useRef(false);
	const runtimeId = runtime.getInstanceId();
	const panelId = `${runtimeId}-devtools-panel`;
	const tabId = (tab: Tab) => `${runtimeId}-devtools-tab-${tab}`;
	const inspectorText = expanded ? getInspectorText(runtime, activeTab) : "";

	useEffect(() => {
		installDevToolsProtocol();
	}, []);

	useEffect(() => {
		if (!expanded && restoreOpenerFocus.current) {
			restoreOpenerFocus.current = false;
			openButtonRef.current?.focus();
		}
	}, [expanded]);

	useEffect(() => {
		if (!expanded) return;
		return runtime.attachInspector();
	}, [expanded, runtime]);

	const close = () => {
		restoreOpenerFocus.current = true;
		setExpanded(false);
	};

	if (!expanded) {
		return createElement(
			"button",
			{
				ref: openButtonRef,
				type: "button" as const,
				"aria-label": "Open DevTools",
				onClick: () => setExpanded(true),
				className: "ism-devtools-button",
				style: {
					position: "fixed",
					bottom: "10px",
					left: "10px",
					display: "inline-flex",
					alignItems: "center",
					gap: "6px",
					backgroundColor: "#0a0a0a",
					color: "#ededed",
					fontSize: "11px",
					fontFamily:
						'Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
					fontWeight: 500,
					padding: "6px 9px",
					borderRadius: "7px",
					border: "1px solid #2e2e2e",
					zIndex,
					cursor: "pointer",
					boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
				},
			},
			createElement(DevToolsIcon),
			"DevTools",
		);
	}

	const handleTabKeyDown = (
		event: ReactKeyboardEvent<HTMLButtonElement>,
		tab: Tab,
	) => {
		const current = TABS.indexOf(tab);
		let next = current;
		if (event.key === "ArrowRight") next = (current + 1) % TABS.length;
		else if (event.key === "ArrowLeft")
			next = (current - 1 + TABS.length) % TABS.length;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = TABS.length - 1;
		else return;
		event.preventDefault();
		const nextTab = TABS[next];
		if (!nextTab) return;
		setActiveTab(nextTab);
		const tablist = event.currentTarget.closest('[role="tablist"]');
		tablist?.querySelector<HTMLElement>(`#${tabId(nextTab)}`)?.focus();
	};

	return createElement(
		"div",
		{
			role: "region",
			"aria-label": "ISM DevTools",
			"data-ism-devtools-runtime": runtimeId,
			className: "ism-devtools-panel",
			onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
				if (event.key === "Escape") {
					event.preventDefault();
					close();
				}
			},
			style: {
				position: "fixed",
				bottom: 0,
				left: 0,
				right: 0,
				height: "35vh",
				backgroundColor: "#0a0a0a",
				color: "#ededed",
				fontSize: "12px",
				fontFamily:
					'"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
				borderTop: "1px solid #2e2e2e",
				zIndex,
				display: "flex",
				flexDirection: "column",
				boxShadow: "0 -16px 48px rgba(0, 0, 0, 0.3)",
			},
		},
		createElement(
			"div",
			{
				style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					backgroundColor: "#0a0a0a",
					borderBottom: "1px solid #242424",
					padding: "0 8px",
					minHeight: "34px",
				},
			},
			createElement(
				"div",
				{
					role: "tablist",
					"aria-label": "DevTools views",
					style: { display: "flex", gap: "2px", alignSelf: "stretch" },
				},
				TABS.map((tab) =>
					createElement(
						"button",
						{
							type: "button",
							key: tab,
							id: tabId(tab),
							role: "tab",
							tabIndex: activeTab === tab ? 0 : -1,
							"aria-selected": activeTab === tab,
							"aria-controls": panelId,
							onClick: () => setActiveTab(tab),
							onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) =>
								handleTabKeyDown(event, tab),
							className: "ism-devtools-tab",
							style: {
								color: activeTab === tab ? "#ededed" : "#8f8f8f",
								padding: "7px 10px 6px",
								cursor: "pointer",
								backgroundColor: "transparent",
								border: "none",
								borderBottom:
									activeTab === tab
										? "1px solid #ededed"
										: "1px solid transparent",
								userSelect: "none",
								font: "inherit",
							},
						},
						tab,
					),
				),
			),
			createElement(
				"button",
				{
					type: "button",
					onClick: close,
					"aria-label": "Close DevTools",
					className: "ism-devtools-button ism-devtools-close",
					style: {
						display: "grid",
						placeItems: "center",
						width: "26px",
						height: "26px",
						color: "#a1a1a1",
						backgroundColor: "transparent",
						border: "1px solid transparent",
						borderRadius: "6px",
						cursor: "pointer",
						padding: 0,
						userSelect: "none",
					},
				},
				createElement(CloseIcon),
			),
		),
		createElement(
			"div",
			{
				role: "tabpanel",
				id: panelId,
				"aria-labelledby": tabId(activeTab),
				style: {
					flex: 1,
					overflow: "hidden",
					position: "relative",
					padding: "10px 12px",
				},
			},
			createElement(
				"div",
				{ style: { overflowY: "auto", height: "100%" } },
				createElement(
					"pre",
					{
						style: {
							color: "#c7c7c7",
							margin: 0,
							lineHeight: 1.55,
						},
					},
					inspectorText,
				),
			),
		),
	);
}
