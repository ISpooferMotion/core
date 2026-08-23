import { build } from "esbuild";

const result = await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	splitting: true,
	write: false,
	metafile: true,
	outdir: ".tmp-architecture-check",
	external: ["react", "react/*", "react-dom", "react-dom/*"],
	logLevel: "silent",
});

const outputs = Object.entries(result.metafile.outputs);
const entry = outputs.find(([, value]) => value.entryPoint === "src/index.ts");
if (!entry)
	throw new Error("Could not find the bundled root entry in esbuild metadata.");

const [, entryMeta] = entry;
const forbidden = [
	"src/DevTools.ts",
	"src/devtoolsProtocol.ts",
	"src/inspectorSerializer.ts",
];

for (const source of forbidden) {
	if (source in entryMeta.inputs) {
		throw new Error(
			`${source} is statically reachable from the root Core bundle. DevTools must remain lazy.`,
		);
	}
}

const devToolsChunk = outputs.find(
	([, value]) => "src/DevTools.ts" in value.inputs,
);
if (!devToolsChunk) {
	throw new Error(
		"The DevTools lazy chunk was not emitted as a separate dependency.",
	);
}

console.log(
	"DevTools isolation verified: root bundle stays free of inspector implementation.",
);
