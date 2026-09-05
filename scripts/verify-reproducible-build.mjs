import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { createPublishStage } from "./package-utils.mjs";

const root = process.cwd();

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: root,
		stdio: "inherit",
		shell: true,
	});
	if (result.status !== 0) {
		console.error(
			`Command ${command} ${args.join(" ")} failed with status ${result.status} (error: ${result.error?.message})`,
		);
		process.exit(result.status ?? 1);
	}
}

async function walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const path = resolve(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(path)));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

async function hashManifest(base) {
	const paths = await walk(base);
	const output = [];
	for (const path of paths) {
		const bytes = await readFile(path);
		const info = await stat(path);
		output.push({
			path: relative(base, path).replaceAll("\\", "/"),
			size: info.size,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	return output;
}

async function packSnapshot(stageDir) {
	const destination = await mkdtemp(resolve(tmpdir(), "ism-pack-"));
	try {
		const result = spawnSync(
			"npm",
			[
				"pack",
				stageDir,
				"--ignore-scripts",
				"--json",
				"--pack-destination",
				destination,
			],
			{
				cwd: root,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "inherit"],
				shell: true,
			},
		);
		if (result.status !== 0) {
			console.error(
				`npm pack failed with status ${result.status} (error: ${result.error?.message})`,
			);
			process.exit(result.status ?? 1);
		}
		const payload = JSON.parse(result.stdout)?.[0];
		if (!payload?.filename)
			throw new Error("npm pack returned an unexpected result.");
		const tarball = resolve(destination, payload.filename);
		const bytes = await readFile(tarball);
		return {
			sha256: createHash("sha256").update(bytes).digest("hex"),
			files: (payload.files ?? [])
				.map(({ path, size, mode }) => ({ path, size, mode }))
				.sort((a, b) => a.path.localeCompare(b.path)),
		};
	} finally {
		await rm(destination, { recursive: true, force: true });
	}
}

async function buildSnapshot() {
	run("bun", ["run", "clean"]);
	run("bun", ["run", "build"]);
	const temp = await mkdtemp(resolve(tmpdir(), "ism-publish-stage-"));
	try {
		await createPublishStage(root, temp);
		return {
			dist: await hashManifest(resolve(root, "dist")),
			stage: await hashManifest(temp),
			pack: await packSnapshot(temp),
		};
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}

try {
	const first = await buildSnapshot();
	const second = await buildSnapshot();

	if (JSON.stringify(first) !== JSON.stringify(second)) {
		console.error("Build/package manifest changed between clean builds.");
		import("node:fs").then((fs) =>
			fs.writeFileSync(
				"repro-diff.json",
				JSON.stringify({ first, second }, null, 2),
			),
		);
		process.exit(1);
	}

	console.log(
		`Reproducible build verified (${second.dist.length} dist files, ${second.pack.files.length} packed files, byte-identical tarball).`,
	);
} catch (e) {
	console.error("Caught error:", e);
	import("node:fs").then((fs) =>
		fs.writeFileSync("repro-err.txt", String(e.stack || e)),
	);
	process.exit(1);
}
