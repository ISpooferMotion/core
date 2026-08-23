import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tarball = resolve(root, process.argv[2] ?? ".artifacts/package.tgz");
const temp = await mkdtemp(resolve(tmpdir(), "ism-package-"));
const extracted = resolve(temp, "package");

function run(command, args, cwd = root) {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
	run("tar", ["-xzf", tarball, "-C", temp]);
	run("npx", ["--yes", "publint@0.3.22", extracted]);
	run("npx", [
		"--yes",
		"@arethetypeswrong/cli@0.18.3",
		tarball,
		"--profile",
		"node16",
		"--exclude-entrypoints",
		"styles.css",
		"assets/ism-config.png",
		"assets/ism-config-dark.png",
		"assets/ism-config-light.png",
	]);
} finally {
	await rm(temp, { recursive: true, force: true });
}
