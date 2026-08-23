import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../createApp";
import { defineWidget } from "../defineWidget";
import {
	DEVTOOLS_PROTOCOL_SYMBOL,
	getDevToolsProtocol,
} from "../devtoolsProtocol";
import { mountedRuntimes } from "../runtime";
import { cleanupTestRoots, createTestRoot } from "./reactTestUtils";

let container: HTMLDivElement;
beforeEach(() => {
	delete (globalThis as unknown as Record<PropertyKey, unknown>)[
		DEVTOOLS_PROTOCOL_SYMBOL
	];
	container = document.createElement("div");
	document.body.appendChild(container);
});
afterEach(() => {
	cleanupTestRoots();
	expect(mountedRuntimes.size).toBe(0);
	delete (globalThis as unknown as Record<PropertyKey, unknown>)[
		DEVTOOLS_PROTOCOL_SYMBOL
	];
	document.body.replaceChildren();
});

const Button = defineWidget<{ clicked: boolean }, [label: string], boolean>({
	name: "Button",
	defaultState: { clicked: false },
	a11y: { role: "button", label: ([label]) => label },
	render: ({ id, args, setState, widgetProps }) =>
		createElement(
			"button",
			{
				key: id,
				type: "button" as const,
				...widgetProps,
				onClick: () => setState({ clicked: true }),
			},
			args[0],
		),
	getReturnValue: (state) => state.clicked,
	consumeState: (state) => ({ ...state, clicked: false }),
});

async function click(el: Element | null) {
	await act(async () => {
		el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

describe("DevTools", () => {
	it("installs the inspector protocol only when the lazy overlay actually mounts", async () => {
		const PlainApp = createApp(() => Button("Plain"));
		const root = createTestRoot(container);
		await act(async () => {
			root.render(createElement(PlainApp));
		});
		expect(getDevToolsProtocol()).toBeUndefined();

		act(() => root.unmount());
		const DevApp = createApp(() => Button("Inspected"), { showDevTools: true });
		const devRoot = createTestRoot(container);
		await act(async () => {
			devRoot.render(createElement(DevApp));
			await Promise.resolve();
		});
		expect(getDevToolsProtocol()).toBeDefined();
	});
	it("renders collapsed by default, showing only the open button", async () => {
		const App = createApp(
			() => {
				Button("Save");
			},
			{ showDevTools: true },
		);

		const root = createTestRoot(container);
		await act(async () => {
			root.render(createElement(App));
		});

		expect(
			container.querySelector('[aria-label="Open DevTools"]'),
		).not.toBeNull();
		expect(container.querySelector('[role="tablist"]')).toBeNull();
	});

	it("expands to show tabs when the open button is clicked", async () => {
		const App = createApp(
			() => {
				Button("Save");
			},
			{ showDevTools: true },
		);

		const root = createTestRoot(container);
		await act(async () => {
			root.render(createElement(App));
		});

		await click(container.querySelector('[aria-label="Open DevTools"]'));

		const tablist = container.querySelector('[role="tablist"]');
		expect(tablist).not.toBeNull();
		expect(container.querySelectorAll('[role="tab"]').length).toBe(2);
		// The Elements tab starts active.
		// Its snapshot should include the widget drawn by the host app.
		expect(container.textContent).toContain("Button");
	});

	it("wires the tab/tabpanel ARIA relationship correctly", async () => {
		const App = createApp(
			() => {
				Button("Save");
			},
			{ showDevTools: true },
		);

		const root = createTestRoot(container);
		await act(async () => {
			root.render(createElement(App));
		});
		await click(container.querySelector('[aria-label="Open DevTools"]'));

		const tabpanel = container.querySelector('[role="tabpanel"]');
		expect(tabpanel).not.toBeNull();
		const tabpanelId = tabpanel?.getAttribute("id");
		expect(tabpanelId).toBeTruthy();

		const elementsTab = Array.from(
			container.querySelectorAll('[role="tab"]'),
		).find((el) => el.textContent === "Elements");
		expect(elementsTab?.getAttribute("aria-controls")).toBe(tabpanelId);
		expect(tabpanel?.getAttribute("aria-labelledby")).toBe(
			elementsTab?.getAttribute("id"),
		);
	});

	it("switches to the State tab and shows the live state store", async () => {
		const App = createApp(
			() => {
				Button("Save");
			},
			{ showDevTools: true },
		);

		const root = createTestRoot(container);
		await act(async () => {
			root.render(createElement(App));
		});
		await click(container.querySelector('[aria-label="Open DevTools"]'));

		const stateTab = Array.from(
			container.querySelectorAll('[role="tab"]'),
		).find((el) => el.textContent === "State");
		await click(stateTab ?? null);

		expect(container.textContent).toContain("clicked");
	});

	it("refreshes the State panel immediately when widget state changes", async () => {
		const Counter = defineWidget<{ count: number }, [], void>({
			name: "Counter",
			defaultState: { count: 0 },
			render: ({ id, state, setState, widgetProps }) =>
				createElement(
					"button",
					{
						key: id,
						type: "button" as const,
						...widgetProps,
						onClick: () => setState({ count: state.count + 1 }),
					},
					`Count: ${state.count}`,
				),
			getReturnValue: () => undefined,
		});
		const App = createApp(() => Counter(), { showDevTools: true });
		const root = createTestRoot(container);
		await act(async () => {
			root.render(createElement(App));
		});
		await click(container.querySelector('[aria-label="Open DevTools"]'));

		const stateTab = Array.from(
			container.querySelectorAll('[role="tab"]'),
		).find((el) => el.textContent === "State");
		await click(stateTab ?? null);
		expect(container.textContent).toContain('"count": 0');

		await click(container.querySelector('[data-ism-widget="Counter"]'));
		expect(container.textContent).toContain('"count": 1');
		act(() => {
			root.unmount();
		});
	});

	it("supports Home and End keyboard navigation", async () => {
		const App = createApp(() => Button("Save"), { showDevTools: true });
		const root = createTestRoot(container);

		await act(async () => {
			root.render(createElement(App));
		});
		await click(container.querySelector('[aria-label="Open DevTools"]'));

		const tabs = Array.from(
			container.querySelectorAll<HTMLElement>('[role="tab"]'),
		);
		const elementsTab = tabs.find(
			(element) => element.textContent === "Elements",
		);
		const stateTab = tabs.find((element) => element.textContent === "State");

		stateTab?.focus();
		await act(async () => {
			stateTab?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
			);
		});
		expect(document.activeElement).toBe(elementsTab);

		await act(async () => {
			elementsTab?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "End", bubbles: true }),
			);
		});
		expect(document.activeElement).toBe(stateTab);

		act(() => {
			root.unmount();
		});
	});

	it("isolates DOM ids and keyboard focus across multiple app roots", async () => {
		const secondContainer = document.createElement("div");
		document.body.appendChild(secondContainer);
		const AppA = createApp(() => Button("A"), { showDevTools: true });
		const AppB = createApp(() => Button("B"), { showDevTools: true });
		const rootA = createTestRoot(container);
		const rootB = createTestRoot(secondContainer);

		await act(async () => {
			rootA.render(createElement(AppA));
			rootB.render(createElement(AppB));
		});
		await click(container.querySelector('[aria-label="Open DevTools"]'));
		await click(secondContainer.querySelector('[aria-label="Open DevTools"]'));

		const allIds = Array.from(document.querySelectorAll("[id]"))
			.map((element) => element.id)
			.filter(Boolean);
		expect(new Set(allIds).size).toBe(allIds.length);

		const firstElementsTab = Array.from(
			container.querySelectorAll<HTMLElement>('[role="tab"]'),
		).find((element) => element.textContent === "Elements");
		await act(async () => {
			firstElementsTab?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
			);
		});
		expect(container.contains(document.activeElement)).toBe(true);
		expect(secondContainer.contains(document.activeElement)).toBe(false);

		act(() => {
			rootA.unmount();
			rootB.unmount();
		});
		document.body.removeChild(secondContainer);
	});

	it("collapses again when the close button is clicked", async () => {
		const App = createApp(
			() => {
				Button("Save");
			},
			{ showDevTools: true },
		);

		const root = createTestRoot(container);
		await act(async () => {
			root.render(createElement(App));
		});
		await click(container.querySelector('[aria-label="Open DevTools"]'));
		expect(container.querySelector('[role="tablist"]')).not.toBeNull();

		await click(container.querySelector('[aria-label="Close DevTools"]'));
		expect(container.querySelector('[role="tablist"]')).toBeNull();
		expect(
			container.querySelector('[aria-label="Open DevTools"]'),
		).not.toBeNull();
	});
	it("closes on Escape and restores focus to the opener", async () => {
		const App = createApp(() => Button("Save"), { showDevTools: true });
		const root = createTestRoot(container);
		await act(async () => {
			root.render(createElement(App));
		});
		await click(container.querySelector('[aria-label="Open DevTools"]'));

		const region = container.querySelector<HTMLElement>(
			'[role="region"][aria-label="ISM DevTools"]',
		);
		const stateTab = Array.from(
			container.querySelectorAll<HTMLElement>('[role="tab"]'),
		).find((element) => element.textContent === "State");
		stateTab?.focus();
		await act(async () => {
			region?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});

		const opener = container.querySelector<HTMLElement>(
			'[aria-label="Open DevTools"]',
		);
		expect(opener).not.toBeNull();
		expect(document.activeElement).toBe(opener);
	});
});
