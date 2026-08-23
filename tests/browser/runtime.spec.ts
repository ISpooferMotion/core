import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

interface ImpactViolation {
	impact?: string | null | undefined;
}

async function openScenario(page: Page, scenario: string): Promise<void> {
	await page.goto(`/?scenario=${scenario}`);
}

function seriousViolations<T extends ImpactViolation>(
	violations: readonly T[],
): T[] {
	return violations.filter(
		(violation) =>
			violation.impact === "critical" || violation.impact === "serious",
	);
}

test("native and custom controls activate exactly once per keyboard gesture", async ({
	page,
}) => {
	await openScenario(page, "interaction");

	const native = page.getByRole("button", { name: "Native counter" });
	await expect(native).toContainText("Native counter: 0");
	await native.focus();
	await page.keyboard.press("Enter");
	await expect(native).toContainText("Native counter: 1");
	await page.keyboard.press("Space");
	await expect(native).toContainText("Native counter: 2");

	const custom = page.getByRole("button", { name: "Custom counter" });
	await expect(custom).toContainText("Custom counter: 0");
	await custom.focus();
	await page.keyboard.press("Enter");
	await expect(custom).toContainText("Custom counter: 1");
	await page.keyboard.down("Space");
	await expect(custom).toContainText("Custom counter: 1");
	await page.keyboard.up("Space");
	await expect(custom).toContainText("Custom counter: 2");
});

test("custom-control focus is routed to the owning app only", async ({
	page,
}) => {
	await openScenario(page, "interaction");
	const custom = page.getByRole("button", { name: "Custom counter" });
	await custom.focus();

	const logicalId = await custom.getAttribute("data-ism-id");
	expect(logicalId).not.toBeNull();
	await expect
		.poll(() =>
			page.evaluate(() => window.__ismFixture?.app.getFocusedId() ?? null),
		)
		.toBe(logicalId);

	await page.getByRole("button", { name: "Native counter" }).focus();
	await expect
		.poll(() =>
			page.evaluate(() => window.__ismFixture?.app.getFocusedId() ?? null),
		)
		.toBeNull();
});

test("persistent state survives a real page reload", async ({ page }) => {
	await openScenario(page, "interaction");
	await page.evaluate(() => localStorage.clear());
	await openScenario(page, "persistence");

	const counter = page.getByRole("button", { name: "Persistent counter" });
	await expect(counter).toContainText("Persistent counter: 0");
	await counter.click();
	await expect(counter).toContainText("Persistent counter: 1");

	await page.reload();
	await expect(
		page.getByRole("button", { name: "Persistent counter" }),
	).toContainText("Persistent counter: 1");
});

test("multiple roots with identical logical widget IDs stay isolated", async ({
	page,
}) => {
	await openScenario(page, "multiple-roots");
	const counters = page.getByRole("button", { name: "Shared root counter" });
	await expect(counters).toHaveCount(2);
	await expect(counters.nth(0)).toContainText("Shared root counter: 0");
	await expect(counters.nth(1)).toContainText("Shared root counter: 0");

	const firstId = await counters.nth(0).getAttribute("data-ism-id");
	const secondId = await counters.nth(1).getAttribute("data-ism-id");
	expect(firstId).toBe(secondId);

	await counters.nth(0).click();
	await expect(counters.nth(0)).toContainText("Shared root counter: 1");
	await expect(counters.nth(1)).toContainText("Shared root counter: 0");
});

test("root-relative overlay fills its local layer host and remains clickable", async ({
	page,
}) => {
	await openScenario(page, "root-layer");
	const host = page.locator("[data-ism-layer-host]");
	const layer = page.locator('[data-ism-layer="overlay"]');
	const overlayButton = page.getByRole("button", { name: "Overlay counter" });

	await expect(host).toBeVisible();
	await expect(layer).toBeVisible();
	const hostBox = await host.boundingBox();
	const layerBox = await layer.boundingBox();
	expect(hostBox).not.toBeNull();
	expect(layerBox).not.toBeNull();
	if (!hostBox || !layerBox) throw new Error("Layer geometry was unavailable.");

	expect(Math.abs(hostBox.x - layerBox.x)).toBeLessThan(1);
	expect(Math.abs(hostBox.y - layerBox.y)).toBeLessThan(1);
	expect(Math.abs(hostBox.width - layerBox.width)).toBeLessThan(1);
	expect(Math.abs(hostBox.height - layerBox.height)).toBeLessThan(1);

	await overlayButton.click();
	await expect(overlayButton).toContainText("Overlay counter: 1");
});

test("viewport overlay fills the browser viewport", async ({ page }) => {
	await openScenario(page, "viewport-layer");
	const layer = page.locator('[data-ism-layer="overlay"]');
	const layerBox = await layer.boundingBox();
	expect(layerBox).not.toBeNull();
	if (!layerBox) throw new Error("Viewport layer geometry was unavailable.");

	expect(Math.abs(layerBox.x)).toBeLessThan(1);
	expect(Math.abs(layerBox.y)).toBeLessThan(1);
	expect(Math.abs(layerBox.width - 800)).toBeLessThan(1);
	expect(Math.abs(layerBox.height - 600)).toBeLessThan(1);
});

test("DevTools tabs follow browser focus and keyboard navigation", async ({
	page,
}) => {
	await openScenario(page, "devtools");
	await page.getByRole("button", { name: "Open DevTools" }).click();

	const devTools = page.getByRole("region", { name: "ISM DevTools" });
	await expect(devTools).toBeVisible();
	const elementsTab = page.getByRole("tab", { name: "Elements" });
	const stateTab = page.getByRole("tab", { name: "State" });
	await elementsTab.focus();
	await page.keyboard.press("ArrowRight");
	await expect(stateTab).toHaveAttribute("aria-selected", "true");
	await expect(stateTab).toBeFocused();
	const stateTabId = await stateTab.getAttribute("id");
	if (!stateTabId) throw new Error("State tab is missing its DOM ID.");
	await expect(page.getByRole("tabpanel")).toHaveAttribute(
		"aria-labelledby",
		stateTabId,
	);
	await page.getByRole("button", { name: "Close DevTools" }).click();
	await expect(
		page.getByRole("button", { name: "Open DevTools" }),
	).toBeVisible();
});

test("widget render retry reports a failed attempt and preserves committed state", async ({
	page,
}) => {
	await openScenario(page, "error-recovery");
	const counter = page.getByRole("button", { name: "Recoverable counter" });
	await counter.click();
	await expect(counter).toContainText("Recoverable counter: 1");

	await page.evaluate(() => window.__ismFixture?.triggerError?.());
	const fallback = page.locator("[data-ism-error]");
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(fallback).toContainText("browser fixture render failure");

	const retry = page.getByRole("button", { name: "Try again" });
	await retry.focus();
	await page.keyboard.press("Enter");
	await expect(fallback).toHaveAttribute("data-ism-retry-state", "failed");
	await expect(fallback).toContainText("Retry failed");
	await expect(retry).toBeFocused();

	await page.evaluate(() => window.__ismFixture?.recover?.());
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(counter).toContainText("Recoverable counter: 1");
});

test("browser defaults do not expose render error details", async ({
	page,
}) => {
	await openScenario(page, "error-private");
	await page.evaluate(() => window.__ismFixture?.triggerError?.());
	const fallback = page.locator("[data-ism-error]");
	await expect(fallback).toBeVisible();
	await expect(fallback).not.toContainText("browser fixture render failure");
	await expect(fallback).toContainText("ISM_WIDGET_RENDER_ERROR");
	await expect(fallback.locator("details")).toHaveCount(0);
});

test("StrictMode does not duplicate native state updates", async ({ page }) => {
	await openScenario(page, "strict-mode");
	const native = page.getByRole("button", { name: "Native counter" });
	await native.focus();
	await page.keyboard.press("Enter");
	await expect(native).toContainText("Native counter: 1");
});

test("interactive runtime surface has no serious automated accessibility violations", async ({
	page,
}) => {
	await openScenario(page, "interaction");
	const results = await new AxeBuilder({ page })
		.include("#surface")
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	expect(seriousViolations(results.violations)).toEqual([]);
});

test("error fallback has no serious automated accessibility violations", async ({
	page,
}) => {
	await openScenario(page, "error-recovery");
	await page.evaluate(() => window.__ismFixture?.triggerError?.());
	await expect(page.getByRole("alert")).toBeVisible();
	const results = await new AxeBuilder({ page })
		.include("[data-ism-error]")
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	expect(seriousViolations(results.violations)).toEqual([]);
});

test("open DevTools has no serious automated accessibility violations", async ({
	page,
}) => {
	await openScenario(page, "devtools");
	await page.getByRole("button", { name: "Open DevTools" }).click();
	const results = await new AxeBuilder({ page })
		.include("[data-ism-devtools-runtime]")
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	expect(seriousViolations(results.violations)).toEqual([]);
});
