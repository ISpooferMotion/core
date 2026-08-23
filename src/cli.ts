#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_ISM_CONFIG } from "./config";
import { getErrorMessage } from "./errors";

const CONFIG_FILENAME = "ism.config.json";

function readVersion(): string {
	try {
		const pkgUrl = new URL("../package.json", import.meta.url);
		const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as {
			version?: string;
		};
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function printUsage(): void {
	console.log(`Usage: ism-core <command>

Commands:
  init            Scaffold ${CONFIG_FILENAME} in the current directory

Options:
  -h, --help      Show this help message
  -v, --version   Show the installed version
  --force         Overwrite an existing config (with 'init')`);
}

export interface CliDeps {
	writeFileSync: typeof writeFileSync;
	cwd: () => string;
	version: string;
}

export function runCli(argv: string[], deps: CliDeps): number {
	let command: string | undefined;
	let flags: { help?: boolean; version?: boolean; force?: boolean };

	try {
		const parsed = parseArgs({
			args: argv,
			allowPositionals: true,
			options: {
				help: { type: "boolean", short: "h" },
				version: { type: "boolean", short: "v" },
				force: { type: "boolean" },
			},
		});
		command = parsed.positionals[0];
		flags = parsed.values;
	} catch (err) {
		const message = getErrorMessage(err);
		console.error(`ism-core: ${message}`);
		printUsage();
		return 1;
	}

	if (flags.version) {
		console.log(deps.version);
		return 0;
	}

	if (flags.help || command === undefined) {
		printUsage();
		return 0;
	}

	if (command !== "init") {
		console.error(`Unknown command: '${command}'`);
		printUsage();
		return 1;
	}

	const configPath = join(deps.cwd(), CONFIG_FILENAME);
	const defaultConfig = `${JSON.stringify(
		{
			$schema: `https://unpkg.com/@ispoofermotion/core@${deps.version}/schema.json`,
			...DEFAULT_ISM_CONFIG,
		},
		null,
		2,
	)}\n`;

	try {
		deps.writeFileSync(configPath, defaultConfig, {
			flag: flags.force ? "w" : "wx",
		});
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "EEXIST") {
			console.error(
				`${CONFIG_FILENAME} already exists. Use --force to overwrite.`,
			);
		} else {
			const message = getErrorMessage(err);
			console.error(`Failed to write ${CONFIG_FILENAME}: ${message}`);
		}
		return 1;
	}

	console.log(`Created ${CONFIG_FILENAME}`);
	console.log(
		"This is a scaffold for editor autocomplete/validation via its $schema, " +
			"not something the library loads automatically. If your bundler " +
			`supports JSON imports (e.g. \`import config from "./${CONFIG_FILENAME}"\`), ` +
			"spread its fields into createApp's second argument yourself:",
	);
	console.log(
		'  createApp(draw, { ...config, storage: myStorageAdapter, storageNamespace: "my-app" })',
	);
	return 0;
}

const isMainModule =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
	process.exit(
		runCli(process.argv.slice(2), {
			writeFileSync,
			cwd: () => process.cwd(),
			version: readVersion(),
		}),
	);
}
