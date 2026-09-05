import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(root, "fixtures/consumers");
const tarball = resolve(root, process.argv[2] ?? ".artifacts/package.tgz");
const tempRoot = await mkdtemp(resolve(tmpdir(), "ism-consumers-"));

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: "inherit",
		shell: true,
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
	const entries = (await readdir(fixtureRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		const source = resolve(fixtureRoot, entry.name);
		const target = resolve(tempRoot, entry.name);
		await cp(source, target, { recursive: true });
		console.log(`\n==> ${basename(target)}`);
		run(
			"npm",
			["install", "--no-audit", "--no-fund", "--package-lock=false"],
			target,
		);
		run(
			"npm",
			[
				"install",
				"--ignore-scripts",
				"--no-save",
				"--no-audit",
				"--no-fund",
				tarball,
			],
			target,
		);
		run("npm", ["run", "verify"], target);
	}
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}
