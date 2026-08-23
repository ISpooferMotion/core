import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "happy-dom",
		globals: true,
		setupFiles: ["./src/__tests__/setup.ts"],
		exclude: ["tests/browser/**"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts", "src/**/*.tsx"],
			exclude: ["src/__tests__/**", "src/styles.css", "src/types.ts"],
			thresholds: {
				lines: 90,
				functions: 85,
				branches: 75,
			},
		},
	},
});
