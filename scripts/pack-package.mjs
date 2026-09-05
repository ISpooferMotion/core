import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublishStage } from "./package-utils.mjs";

const root = process.cwd();
const artifactDir = resolve(process.argv[2] ?? ".artifacts");
const stageDir = resolve(artifactDir, "stage");
await rm(artifactDir, { recursive: true, force: true });
await mkdir(artifactDir, { recursive: true });
await createPublishStage(root, stageDir);

const result = spawnSync(
	"npm",
	[
		"pack",
		stageDir,
		"--ignore-scripts",
		"--json",
		"--pack-destination",
		artifactDir,
	],
	{ encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: true },
);

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

function normalizePackEntries(payload) {
	if (Array.isArray(payload)) return payload;
	if (!payload || typeof payload !== "object") return [];

	// npm <=11 returns an array, while npm 12 returns an object keyed by
	// package name. Also accept a direct result object so this stays tolerant
	// of future single-package output changes.
	if (typeof payload.filename === "string") return [payload];
	return Object.values(payload);
}

let payload;
try {
	payload = JSON.parse(result.stdout);
} catch (error) {
	throw new Error("npm pack returned invalid JSON.", { cause: error });
}

const entries = normalizePackEntries(payload).filter(
	(entry) =>
		entry &&
		typeof entry === "object" &&
		typeof entry.filename === "string" &&
		entry.filename.length > 0,
);

if (entries.length !== 1) {
	throw new Error(
		`npm pack returned an unexpected result shape (${entries.length} package entries).`,
	);
}

const packResult = entries[0];
const generatedPath = resolve(artifactDir, packResult.filename);
const tarballPath = resolve(artifactDir, "package.tgz");
await rename(generatedPath, tarballPath);

const bytes = await readFile(tarballPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(
	resolve(artifactDir, "package.sha256"),
	`${sha256}  package.tgz\n`,
);
await writeFile(
	resolve(artifactDir, "npm-pack.json"),
	`${JSON.stringify(packResult, null, 2)}\n`,
);
await rm(stageDir, { recursive: true, force: true });

console.log(tarballPath);
