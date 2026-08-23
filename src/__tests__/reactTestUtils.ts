import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const mountedRoots = new Set<Root>();

export function createTestRoot(container: Element | DocumentFragment): Root {
	const root = createRoot(container);
	let mounted = true;

	const trackedRoot: Root = {
		render(children) {
			root.render(children);
		},
		unmount() {
			if (!mounted) return;
			mounted = false;
			mountedRoots.delete(trackedRoot);
			root.unmount();
		},
	};

	mountedRoots.add(trackedRoot);
	return trackedRoot;
}

export function cleanupTestRoots(): void {
	act(() => {
		for (const root of Array.from(mountedRoots)) root.unmount();
	});
}

export async function waitForCondition(
	condition: () => boolean,
	timeoutMs = 2000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() >= deadline) {
			throw new Error("Timed out waiting for the expected React state.");
		}
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
	}
}
