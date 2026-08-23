import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ErrorFallback,
	ISMCoreErrorBoundary,
	shouldShowErrorDetailsByDefault,
} from "../ErrorBoundary";
import { ISMError } from "../errors";
import { cleanupTestRoots, createTestRoot } from "./reactTestUtils";

let container: HTMLDivElement;
beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
});
afterEach(() => {
	cleanupTestRoots();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
	if (shouldThrow) throw new Error("kaboom");
	return createElement("div", { "data-testid": "ok" }, "fine");
}

function buttonNamed(name: string): HTMLButtonElement | null {
	return (
		Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
			(button) => button.textContent === name,
		) ?? null
	);
}

async function clickAndFlush(button: HTMLButtonElement | null): Promise<void> {
	await act(async () => {
		button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 120));
	});
}

describe("ISMCoreErrorBoundary", () => {
	it("renders children normally when nothing throws", () => {
		const root = createTestRoot(container);
		act(() => {
			root.render(
				createElement(
					ISMCoreErrorBoundary,
					null,
					createElement(Bomb, { shouldThrow: false }),
				),
			);
		});
		expect(container.textContent).toContain("fine");
	});

	it("catches a thrown error and renders the fallback instead of crashing", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const root = createTestRoot(container);
		act(() => {
			root.render(
				createElement(
					ISMCoreErrorBoundary,
					null,
					createElement(Bomb, { shouldThrow: true }),
				),
			);
		});

		expect(container.querySelector("[data-ism-error]")).not.toBeNull();
		expect(container.textContent).toContain("kaboom");
		consoleError.mockRestore();
	});

	it("calls onError with the caught error and component stack", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const onError = vi.fn();
		const root = createTestRoot(container);
		act(() => {
			root.render(
				<ISMCoreErrorBoundary onError={onError}>
					<Bomb shouldThrow={true} />
				</ISMCoreErrorBoundary>,
			);
		});

		expect(onError).toHaveBeenCalledTimes(1);
		const [error, info] = onError.mock.calls[0] as [
			Error,
			{ componentStack?: string },
		];
		expect(error.message).toBe("kaboom");
		expect(typeof info.componentStack).toBe("string");
		consoleError.mockRestore();
	});

	it("contains a consumer onError hook that throws", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const onDiagnostic = vi.fn();
		const root = createTestRoot(container);
		act(() => {
			root.render(
				<ISMCoreErrorBoundary
					onError={() => {
						throw new Error("logging failed");
					}}
					onDiagnostic={onDiagnostic}
				>
					<Bomb shouldThrow={true} />
				</ISMCoreErrorBoundary>,
			);
		});

		expect(container.querySelector("[data-ism-error]")).not.toBeNull();
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				code: "ISM_WIDGET_RENDER_ERROR",
				message: expect.stringContaining("onError hook threw"),
			}),
		);
		consoleError.mockRestore();
	});

	it("falls back to Core's built-in error UI when a custom fallback throws", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const onDiagnostic = vi.fn();
		const root = createTestRoot(container);
		act(() => {
			root.render(
				<ISMCoreErrorBoundary
					onDiagnostic={onDiagnostic}
					renderFallback={() => {
						throw new Error("fallback exploded");
					}}
				>
					<Bomb shouldThrow={true} />
				</ISMCoreErrorBoundary>,
			);
		});

		expect(container.querySelector("[data-ism-error]")).not.toBeNull();
		expect(container.textContent).toContain("Widget render error");
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("Custom error fallback threw"),
			}),
		);
		consoleError.mockRestore();
	});

	it("reports an immediate failed retry, then recovers when the child becomes safe", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let shouldThrow = true;

		function Wrapper() {
			return createElement(
				ISMCoreErrorBoundary,
				null,
				createElement(Bomb, { shouldThrow }),
			);
		}

		const root = createTestRoot(container);
		act(() => root.render(createElement(Wrapper)));
		expect(container.querySelector("[data-ism-error]")).not.toBeNull();

		await clickAndFlush(buttonNamed("Try again"));
		expect(container.textContent).toContain("Retry failed");
		expect(document.activeElement).toBe(buttonNamed("Try again"));
		expect(
			container.querySelector("[data-ism-retry-state='failed']"),
		).not.toBeNull();
		expect(buttonNamed("Try again")).not.toBeNull();

		shouldThrow = false;
		await clickAndFlush(buttonNamed("Try again"));
		expect(container.querySelector("[data-ism-error]")).toBeNull();
		expect(container.textContent).toContain("fine");
		consoleError.mockRestore();
	});
});

describe("ErrorFallback", () => {
	it("announces only the concise summary and hides the decorative icon", () => {
		const root = createTestRoot(container);
		act(() => {
			root.render(
				createElement(ErrorFallback, {
					title: "Something broke",
					error: "oops",
				}),
			);
		});

		const alertEl = container.querySelector('[role="alert"]');
		expect(alertEl).not.toBeNull();
		expect(alertEl?.textContent).toContain("Something broke");
		expect(alertEl?.textContent).not.toContain("oops");
		expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
	});

	it("keeps long error content accessible with viewport-bounded scrolling", () => {
		const root = createTestRoot(container);
		act(() => {
			root.render(
				createElement(ErrorFallback, {
					title: "Long error",
					error: new Error("x".repeat(10_000)),
				}),
			);
		});

		const fallback = container.querySelector<HTMLElement>("[data-ism-error]");
		expect(fallback?.style.maxHeight).toBe("calc(100vh - 32px)");
		expect(fallback?.style.overflowY).toBe("auto");
		expect(fallback?.style.overflowX).toBe("hidden");
	});

	it("uses render-specific and draw-specific recovery guidance", () => {
		const root = createTestRoot(container);
		act(() => {
			root.render(
				createElement(ErrorFallback, {
					title: "Render error",
					error: "x",
					kind: "render",
				}),
			);
		});
		expect(container.textContent).toContain("widget render function");

		act(() => {
			root.render(
				createElement(ErrorFallback, {
					title: "Draw error",
					error: "x",
					kind: "draw",
				}),
			);
		});
		expect(container.textContent).toContain("draw function");
	});

	it("keeps technical details collapsed by default while retaining the stack", () => {
		const root = createTestRoot(container);
		act(() => {
			root.render(
				createElement(ErrorFallback, {
					title: "t",
					error: new Error("with stack"),
				}),
			);
		});
		const details = container.querySelector("details");
		expect(details).not.toBeNull();
		expect(details?.hasAttribute("open")).toBe(false);
		expect(container.textContent).toContain("Technical details");
		expect(container.textContent).toContain("with stack");
	});

	it("gives immediate retry feedback before calling the recovery callback", async () => {
		const onRetry = vi.fn();
		const root = createTestRoot(container);
		act(() => {
			root.render(
				createElement(ErrorFallback, { title: "t", error: "x", onRetry }),
			);
		});

		const button = buttonNamed("Try again");
		act(() => {
			button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(container.textContent).toContain("Retrying...");
		expect(onRetry).not.toHaveBeenCalled();

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
		});
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("copies diagnostics without leaking hidden production details", async () => {
		const originalClipboard = Object.getOwnPropertyDescriptor(
			navigator,
			"clipboard",
		);
		const writeText = vi.fn(async (_text: string) => {});
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});

		try {
			const root = createTestRoot(container);
			act(() => {
				root.render(
					createElement(ErrorFallback, {
						title: "Production error",
						error: new Error("secret path C:/private/source.ts"),
						showErrorDetails: false,
						errorCode: "ISM_WIDGET_RENDER_ERROR",
					}),
				);
			});

			await act(async () => {
				buttonNamed("Copy details")?.dispatchEvent(
					new MouseEvent("click", { bubbles: true }),
				);
				await Promise.resolve();
			});

			expect(writeText).toHaveBeenCalledTimes(1);
			const copied = writeText.mock.calls[0]?.[0] ?? "";
			expect(copied).toContain("ISM Core 4.1.0");
			expect(copied).toContain("ISM_WIDGET_RENDER_ERROR");
			expect(copied).not.toContain("secret path");
		} finally {
			if (originalClipboard) {
				Object.defineProperty(navigator, "clipboard", originalClipboard);
			} else {
				Reflect.deleteProperty(navigator, "clipboard");
			}
		}
	});
});

describe("production-safe error disclosure", () => {
	it("fails closed when process is unavailable", () => {
		vi.stubGlobal("process", undefined);
		expect(shouldShowErrorDetailsByDefault()).toBe(false);
	});

	it("fails closed when NODE_ENV is unknown", () => {
		vi.stubGlobal("process", { env: {} });
		expect(shouldShowErrorDetailsByDefault()).toBe(false);
	});

	it("hides sensitive message and stack details when showErrorDetails is false", () => {
		const root = createTestRoot(container);
		const secretError = new Error(
			"secret filesystem path C:/private/source.ts",
		);
		act(() => {
			root.render(
				createElement(ErrorFallback, {
					title: "Production error",
					error: secretError,
					errorCode: "ISM_WIDGET_RENDER_ERROR",
					showErrorDetails: false,
				}),
			);
		});
		expect(container.textContent).toContain(
			"Core could not render the current widget tree.",
		);
		expect(container.textContent).toContain("Error code");
		expect(container.textContent).toContain("ISM_WIDGET_RENDER_ERROR");
		expect(container.textContent).not.toContain("secret filesystem path");
		expect(container.querySelector("details")).toBeNull();
	});

	it("emits the stable code carried by an ISMError", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const onDiagnostic = vi.fn();
		const root = createTestRoot(container);
		function ThrowsCoded(): never {
			throw new ISMError("ISM_DUPLICATE_ID_STRICT", "coded");
		}
		act(() => {
			root.render(
				<ISMCoreErrorBoundary onDiagnostic={onDiagnostic}>
					<ThrowsCoded />
				</ISMCoreErrorBoundary>,
			);
		});
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				code: "ISM_DUPLICATE_ID_STRICT",
				level: "error",
			}),
		);
		consoleError.mockRestore();
	});
});
