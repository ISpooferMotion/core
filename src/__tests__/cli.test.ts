import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../cli";
import { runCli } from "../cli";

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
	return {
		writeFileSync: vi.fn(),
		cwd: () => join("fake", "project"),
		version: "9.9.9",
		...overrides,
	};
}

describe("runCli", () => {
	it("prints the version and exits 0 for --version", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const deps = makeDeps({ version: "1.2.3" });

		const code = runCli(["--version"], deps);

		expect(code).toBe(0);
		expect(logSpy).toHaveBeenCalledWith("1.2.3");
		logSpy.mockRestore();
	});

	it("prints usage and exits 0 for --help", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const code = runCli(["--help"], makeDeps());

		expect(code).toBe(0);
		expect(logSpy).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("prints usage and exits 0 when no command is given", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const code = runCli([], makeDeps());

		expect(code).toBe(0);
		expect(logSpy).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("errors and exits 1 for an unknown command", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const code = runCli(["frobnicate"], makeDeps());

		expect(code).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith("Unknown command: 'frobnicate'");
		errorSpy.mockRestore();
		logSpy.mockRestore();
	});

	it("writes ism.config.json with default values on init", () => {
		const writeFileSync = vi.fn();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const code = runCli(
			["init"],
			makeDeps({ writeFileSync, version: "3.3.0" }),
		);

		expect(code).toBe(0);
		expect(writeFileSync).toHaveBeenCalledTimes(1);
		const [path, contents, opts] = writeFileSync.mock.calls[0] as [
			string,
			string,
			{ flag: string },
		];
		expect(path).toBe(join("fake", "project", "ism.config.json"));
		expect(opts.flag).toBe("wx");

		const parsed = JSON.parse(contents);
		expect(parsed.$schema).toBe(
			"https://unpkg.com/@ispoofermotion/core@3.3.0/schema.json",
		);
		expect(parsed.layerZIndex).toBe(100);
		expect(parsed.layerMode).toBe("root");
		expect(parsed.showDevTools).toBe(false);
		expect(parsed.strictIds).toBe(false);
		expect(parsed.strictRuntime).toBe(false);
		expect(parsed.stateRetentionFrames).toBe(1);
		logSpy.mockRestore();
	});

	it("uses the 'w' flag instead of 'wx' when --force is passed", () => {
		const writeFileSync = vi.fn();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		runCli(["init", "--force"], makeDeps({ writeFileSync }));

		const opts = writeFileSync.mock.calls[0]?.[2] as { flag: string };
		expect(opts.flag).toBe("w");
		logSpy.mockRestore();
	});

	it("reports a friendly error and exits 1 when the config already exists", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const writeFileSync = vi.fn(() => {
			const err = new Error("EEXIST") as NodeJS.ErrnoException;
			err.code = "EEXIST";
			throw err;
		});

		const code = runCli(["init"], makeDeps({ writeFileSync }));

		expect(code).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(
			"ism.config.json already exists. Use --force to overwrite.",
		);
		errorSpy.mockRestore();
	});

	it("reports the underlying error for non-EEXIST write failures", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const writeFileSync = vi.fn(() => {
			throw new Error("disk full");
		});

		const code = runCli(["init"], makeDeps({ writeFileSync }));

		expect(code).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(
			"Failed to write ism.config.json: disk full",
		);
		errorSpy.mockRestore();
	});

	it("errors and exits 1 for an unrecognized flag", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const code = runCli(["--nonexistent-flag"], makeDeps());

		expect(code).toBe(1);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
		logSpy.mockRestore();
	});
});
