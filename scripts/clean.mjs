import { rm } from "node:fs/promises";

const all = process.argv.includes("--all");
const paths = ["dist", ".typedoc"];

if (all) {
	paths.push(
		"coverage",
		".artifacts",
		"playwright-report",
		"test-results",
		"tests/browser/.tmp",
	);
}

await Promise.all(
	paths.map((path) =>
		rm(new URL(`../${path}`, import.meta.url), {
			recursive: true,
			force: true,
		}),
	),
);
