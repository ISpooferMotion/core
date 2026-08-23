import { act, createContext, createElement, StrictMode, Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, useReactContext } from "../createApp";
import { defineWidget } from "../defineWidget";
import { markDirty, memoBlock, popLayer, pushLayer } from "../index";
import { makeInteractive } from "../makeInteractive";
import { mountedRuntimes } from "../runtime";
import {
	cleanupTestRoots,
	createTestRoot,
	waitForCondition,
} from "./reactTestUtils";

let container: HTMLDivElement;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
});

afterEach(() => {
	cleanupTestRoots();
	expect(mountedRuntimes.size).toBe(0);
	document.body.replaceChildren();
});

const Text = defineWidget<Record<string, never>, [text: string], void>({
	name: "Text",
	defaultState: {},
	render: ({ id, args }) => createElement("span", { key: id }, args[0]),
	getReturnValue: () => undefined,
});

const Button = defineWidget<{ clicked: boolean }, [label: string], boolean>({
	name: "Button",
	defaultState: { clicked: false },
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

describe("createApp", () => {
	it("requires a stable namespace when storage is configured", () => {
		const storage = {
			has: () => false,
			get: () => undefined,
			set: () => {},
			delete: () => {},
			keys: () => [] as string[],
		};

		expect(() => createApp(() => {}, { storage })).toThrow("storageNamespace");
		expect(() =>
			createApp(() => {}, { storage, storageNamespace: "   " }),
		).toThrow("storageNamespace");
	});

	it("renders widgets called from the draw function", () => {
		const App = createApp(() => {
			Text("hello world");
		});

		const root = createTestRoot(container);

		act(() => {
			root.render(createElement(App));
		});

		expect(container.textContent).toContain("hello world");
	});

	it("exposes app-local handles that do not dirty unrelated roots", async () => {
		let drawsA = 0;
		let drawsB = 0;
		const AppA = createApp(() => {
			drawsA++;
			Text("A");
		});
		const AppB = createApp(() => {
			drawsB++;
			Text("B");
		});
		const secondContainer = document.createElement("div");
		document.body.appendChild(secondContainer);
		const rootA = createTestRoot(container);
		const rootB = createTestRoot(secondContainer);

		act(() => {
			rootA.render(createElement(AppA));
			rootB.render(createElement(AppB));
		});
		const beforeA = drawsA;
		const beforeB = drawsB;

		await act(async () => {
			AppA.markDirty();
			await Promise.resolve();
		});

		expect(drawsA).toBeGreaterThan(beforeA);
		expect(drawsB).toBe(beforeB);

		act(() => {
			rootA.unmount();
			rootB.unmount();
		});
		document.body.removeChild(secondContainer);
	});

	it("re-renders after a click handler updates widget state and calls markDirty", async () => {
		let clickCount = 0;

		const App = createApp(() => {
			if (Button("Click me")) {
				clickCount++;
				markDirty();
			}

			Text(`count: ${clickCount}`);
		});

		const root = createTestRoot(container);

		act(() => {
			root.render(createElement(App));
		});

		expect(container.textContent).toContain("count: 0");

		const button = container.querySelector("button");

		await act(async () => {
			button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(container.textContent).toContain("count: 1");
	});

	it("handles one-shot widget events exactly once in React StrictMode", async () => {
		let clickCount = 0;

		const App = createApp(() => {
			if (Button("Strict click")) {
				clickCount++;
				markDirty();
			}

			Text(`strict count: ${clickCount}`);
		});

		const root = createTestRoot(container);

		await act(async () => {
			root.render(createElement(StrictMode, null, createElement(App)));
		});

		await act(async () => {
			container
				.querySelector("button")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

			await Promise.resolve();
		});

		expect(clickCount).toBe(1);
		expect(container.textContent).toContain("strict count: 1");
	});

	it("routes focus to the correct runtime when app roots share a widget ID", () => {
		const Focusable = defineWidget<
			Record<string, never>,
			[label: string],
			void
		>({
			name: "Focusable",
			defaultState: {},
			render: ({ id, runtimeId, args, widgetProps }) =>
				createElement(
					"div",
					{
						...widgetProps,
						...makeInteractive(() => {}, { id, role: "button" }),
						"data-runtime-id": runtimeId,
					},
					args[0],
				),
			getReturnValue: () => undefined,
		});

		const secondContainer = document.createElement("div");
		document.body.appendChild(secondContainer);

		const AppA = createApp(() => Focusable("same"));
		const AppB = createApp(() => Focusable("same"));
		const rootA = createTestRoot(container);
		const rootB = createTestRoot(secondContainer);

		act(() => {
			rootA.render(createElement(AppA));
			rootB.render(createElement(AppB));
		});

		const firstButton = container.querySelector(
			'[role="button"]',
		) as HTMLElement | null;
		const widgetId = firstButton?.getAttribute("data-ism-id") ?? "";
		const runtimeId = firstButton?.getAttribute("data-runtime-id");

		act(() => {
			firstButton?.focus();
		});

		const runtimes = Array.from(mountedRuntimes);
		const owner = runtimes.find(
			(runtime) => runtime.getInstanceId() === runtimeId,
		);
		const other = runtimes.find((runtime) => runtime !== owner);

		expect(owner?.isFocused(widgetId)).toBe(true);
		expect(other?.isFocused(widgetId)).toBe(false);

		act(() => {
			AppA.setFocus(null);
			AppB.setFocus(null);
			AppA.setFocus(widgetId);
		});

		expect(AppA.isFocused(widgetId)).toBe(true);
		expect(AppB.isFocused(widgetId)).toBe(false);
		expect(AppA.getFocusedId()).toBe(widgetId);

		act(() => {
			rootA.unmount();
			rootB.unmount();
		});

		document.body.removeChild(secondContainer);
	});

	it("surfaces duplicate IDs as draw errors when strictIds is enabled", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const App = createApp(
			() => {
				Text("duplicate");
				Text("duplicate");
			},
			{ strictIds: true },
		);
		const root = createTestRoot(container);

		act(() => {
			root.render(createElement(App));
		});

		expect(container.textContent).toContain("strictIds");
		consoleError.mockRestore();
	});

	it("renders a real element for a11y descriptions", () => {
		const Described = defineWidget<Record<string, never>, [], void>({
			name: "Described",
			defaultState: {},
			a11y: { description: "Helpful description" },
			render: ({ widgetProps }) =>
				createElement(
					"button",
					{
						type: "button" as const,
						...widgetProps,
					},
					"Described button",
				),
			getReturnValue: () => undefined,
		});

		const App = createApp(() => Described());
		const root = createTestRoot(container);

		act(() => {
			root.render(createElement(App));
		});

		const button = container.querySelector("button");
		const descriptionId = button?.getAttribute("aria-describedby");

		expect(descriptionId).toBeTruthy();
		expect(document.getElementById(descriptionId ?? "")?.textContent).toBe(
			"Helpful description",
		);
	});

	it("shows draw retry feedback, reports an immediate re-failure, and then recovers", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let shouldThrow = true;

		const App = createApp(() => {
			if (shouldThrow) throw new Error("draw exploded");
			Text("recovered");
		});
		const root = createTestRoot(container);
		act(() => root.render(createElement(App)));

		expect(container.querySelector("[data-ism-error]")).not.toBeNull();
		expect(container.textContent).toContain("draw exploded");

		await act(async () => {
			Array.from(container.querySelectorAll("button"))
				.find((button) => button.textContent === "Try again")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await waitForCondition(
			() => container.querySelector("[data-ism-retry-state='failed']") !== null,
		);
		expect(container.textContent).toContain("Retry failed");

		shouldThrow = false;
		await act(async () => {
			Array.from(container.querySelectorAll("button"))
				.find((button) => button.textContent === "Try again")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await waitForCondition(
			() => container.querySelector("[data-ism-error]") === null,
		);

		expect(container.querySelector("[data-ism-error]")).toBeNull();
		expect(container.textContent).toContain("recovered");
		consoleError.mockRestore();
	});

	it("restores the built-in draw fallback when a custom fallback throws", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const onDiagnostic = vi.fn();
		const App = createApp(
			() => {
				throw new Error("draw exploded");
			},
			{
				onDiagnostic,
				renderErrorFallback: () => {
					throw new Error("fallback exploded");
				},
			},
		);
		const root = createTestRoot(container);
		act(() => root.render(createElement(App)));

		expect(container.querySelector("[data-ism-error]")).not.toBeNull();
		expect(container.textContent).toContain("Draw function error");
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("Custom error fallback threw"),
			}),
		);
		consoleError.mockRestore();
	});

	it("preserves widget state across a render error and boundary retry", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let shouldThrow = false;

		const Stateful = defineWidget<{ count: number }, [], void>({
			name: "StatefulRecovery",
			defaultState: { count: 0 },
			render: ({ state, setState }) => {
				if (shouldThrow) throw new Error("widget exploded");
				return createElement(
					"button",
					{
						type: "button" as const,
						"data-count": state.count,
						onClick: () =>
							setState((previous) => ({ count: previous.count + 1 })),
					},
					`count: ${state.count}`,
				);
			},
			getReturnValue: () => undefined,
		});

		const App = createApp(() => Stateful());
		const root = createTestRoot(container);
		await act(async () => {
			root.render(createElement(App));
		});

		shouldThrow = true;
		await act(async () => {
			container
				.querySelector("button")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});

		expect(container.querySelector("[data-ism-error]")).not.toBeNull();
		expect(container.textContent).toContain("widget exploded");

		shouldThrow = false;
		await act(async () => {
			Array.from(container.querySelectorAll("[data-ism-error] button"))
				.find((button) => button.textContent === "Try again")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await waitForCondition(
			() => container.querySelector("[data-ism-error]") === null,
		);

		expect(container.querySelector("[data-ism-error]")).toBeNull();
		expect(container.querySelector("[data-count='1']")).not.toBeNull();
		expect(container.textContent).toContain("count: 1");

		consoleError.mockRestore();
	});

	it("does not duplicate a consumed event when Suspense replays a frame", async () => {
		let shouldSuspend = false;
		let resolveSuspense: (() => void) | undefined;
		const suspended = new Promise<void>((resolve) => {
			resolveSuspense = resolve;
		});
		const observations: boolean[] = [];

		const Suspender = defineWidget<Record<string, never>, [], void>({
			name: "Suspender",
			defaultState: {},
			render: () => {
				if (shouldSuspend) throw suspended;
				return createElement("span", null, "ready");
			},
			getReturnValue: () => undefined,
		});

		const App = createApp(() => {
			observations.push(Button("Suspend click"));
			Suspender();
		});
		const root = createTestRoot(container);

		await act(async () => {
			root.render(
				createElement(
					Suspense,
					{ fallback: createElement("span", null, "suspended") },
					createElement(App),
				),
			);
		});

		shouldSuspend = true;
		await act(async () => {
			container
				.querySelector("button")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});

		expect(container.textContent).toContain("suspended");
		shouldSuspend = false;
		await act(async () => {
			resolveSuspense?.();
			await suspended;
		});

		expect(observations.filter(Boolean)).toHaveLength(1);
		expect(container.textContent).toContain("ready");
	});

	it("rolls back one-shot consumption when a draw attempt throws", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let throwAfterClick = true;
		const observations: boolean[] = [];

		const App = createApp(() => {
			const clicked = Button("Transactional click");
			observations.push(clicked);
			if (clicked && throwAfterClick) throw new Error("abort this frame");
			Text(clicked ? "clicked committed" : "idle");
		});

		const root = createTestRoot(container);
		await act(async () => {
			root.render(createElement(App));
		});

		await act(async () => {
			container
				.querySelector("button")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});

		expect(container.querySelector("[data-ism-error]")).not.toBeNull();
		throwAfterClick = false;

		await act(async () => {
			container
				.querySelector("[data-ism-error] button")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});
		await waitForCondition(() => observations.filter(Boolean).length === 2);

		expect(observations.filter(Boolean)).toHaveLength(2);
		expect(container.textContent).toContain("clicked committed");
		consoleError.mockRestore();
	});

	it("mounts DevTools when showDevTools is true, and not when false or omitted", async () => {
		const AppWith = createApp(
			() => {
				Text("hi");
			},
			{ showDevTools: true },
		);

		const AppWithout = createApp(() => {
			Text("hi");
		});

		const rootWith = createTestRoot(container);

		await act(async () => {
			rootWith.render(createElement(AppWith));
		});
		await waitForCondition(
			() => container.querySelector('[aria-label="Open DevTools"]') !== null,
		);

		expect(
			container.querySelector('[aria-label="Open DevTools"]'),
		).not.toBeNull();

		act(() => {
			rootWith.unmount();
		});

		const secondContainer = document.createElement("div");
		document.body.appendChild(secondContainer);

		const rootWithout = createTestRoot(secondContainer);

		act(() => {
			rootWithout.render(createElement(AppWithout));
		});

		expect(
			secondContainer.querySelector('[aria-label="Open DevTools"]'),
		).toBeNull();

		act(() => {
			rootWithout.unmount();
		});

		document.body.removeChild(secondContainer);
	});

	it("creates a real root-relative layer host with CSS-independent pointer routing", () => {
		const App = createApp(
			() => {
				pushLayer("modal");
				Button("in a modal");
				popLayer();
			},
			{ layerZIndex: 555 },
		);

		const root = createTestRoot(container);

		act(() => {
			root.render(createElement(App));
		});

		const host = container.querySelector(
			"[data-ism-layer-host]",
		) as HTMLElement | null;
		const layerElement = container.querySelector(
			'[data-ism-layer="modal"]',
		) as HTMLElement | null;
		const button = layerElement?.querySelector("button") as HTMLElement | null;

		expect(host?.hasAttribute("data-ism-root")).toBe(true);
		expect(host?.style.position).toBe("relative");
		expect(host?.style.isolation).toBe("isolate");
		expect(layerElement?.style.position).toBe("absolute");
		expect(layerElement?.style.zIndex).toBe("555");
		expect(layerElement?.style.pointerEvents).toBe("none");
		expect(button?.style.pointerEvents).toBe("auto");
	});

	it("supports viewport-positioned named layers explicitly", () => {
		const App = createApp(
			() => {
				pushLayer("tooltip");
				Text("viewport tooltip");
				popLayer();
			},
			{ layerMode: "viewport" },
		);
		const root = createTestRoot(container);

		act(() => {
			root.render(createElement(App));
		});

		const layerElement = container.querySelector(
			'[data-ism-layer="tooltip"]',
		) as HTMLElement | null;
		expect(layerElement?.style.position).toBe("fixed");
	});

	it("cleans up the runtime from mountedRuntimes on unmount", () => {
		const App = createApp(() => {
			Text("hi");
		});

		const root = createTestRoot(container);

		act(() => {
			root.render(createElement(App));
		});

		expect(mountedRuntimes.size).toBe(1);

		act(() => {
			root.unmount();
		});

		expect(mountedRuntimes.size).toBe(0);
	});
});

describe("useReactContext", () => {
	it("rejects useReactContext inside memoBlock before hook order can diverge", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const TestContext = createContext("default-value");

		const App = createApp(() => {
			memoBlock("context", [], () => {
				useReactContext(TestContext);
			});
		});

		const root = createTestRoot(container);

		act(() => {
			root.render(createElement(App));
		});

		expect(container.textContent).toContain(
			"useReactContext() cannot be called inside memoBlock()",
		);

		consoleError.mockRestore();
	});

	it("passes through the current context value", () => {
		const TestContext = createContext("default-value");
		let observed = "";

		const App = createApp(() => {
			observed = useReactContext(TestContext);
			Text(observed);
		});

		const root = createTestRoot(container);

		act(() => {
			root.render(
				createElement(
					TestContext.Provider,
					{ value: "provided-value" },
					createElement(App),
				),
			);
		});

		expect(observed).toBe("provided-value");
		expect(container.textContent).toContain("provided-value");
	});
});

describe("createApp diagnostics and production error handling", () => {
	it("emits a coded draw diagnostic while hiding details when configured", () => {
		const onDiagnostic = vi.fn();
		const App = createApp(
			() => {
				throw new Error("secret draw details C:/private/source.ts");
			},
			{ onDiagnostic, showErrorDetails: false },
		);
		const root = createTestRoot(container);
		act(() => {
			root.render(createElement(App));
		});

		const fallback = container.querySelector("[data-ism-error]");
		expect(fallback?.getAttribute("data-ism-error-code")).toBe(
			"ISM_DRAW_ERROR",
		);
		expect(container.textContent).toContain(
			"Core could not complete the current draw frame.",
		);
		expect(container.textContent).not.toContain("secret draw details");
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ code: "ISM_DRAW_ERROR", level: "error" }),
		);
	});

	it("supports a custom fallback for draw failures", () => {
		const App = createApp(
			() => {
				throw new Error("boom");
			},
			{
				onDiagnostic: () => {},
				renderErrorFallback: (context) =>
					createElement(
						"div",
						{ "data-custom-error": context.errorCode },
						"custom fallback",
					),
			},
		);
		const root = createTestRoot(container);
		act(() => {
			root.render(createElement(App));
		});
		expect(
			container.querySelector('[data-custom-error="ISM_DRAW_ERROR"]'),
		).not.toBeNull();
	});
});
