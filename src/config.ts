/** Positioning contract for named render layers. */
export type LayerMode = "root" | "viewport";

/**
 * Runtime configuration for @ispoofermotion/core.
 *
 * @since 3.2.0
 */
export interface IsmConfig {
	/**
	 * Base z index used by named layers such as modals and tooltips.
	 * Defaults to {@link DEFAULT_LAYER_Z_INDEX}.
	 */
	layerZIndex?: number;

	/**
	 * Mount the built in DevTools widget with the app.
	 * Defaults to {@link DEFAULT_SHOW_DEV_TOOLS}.
	 */
	showDevTools?: boolean;

	/**
	 * Throw when two widgets produce the same logical ID in one frame.
	 * Enable this in development to catch unstable identity early.
	 * Defaults to false for compatibility.
	 */
	strictIds?: boolean;

	/**
	 * Turn runtime invariant diagnostics into frame-aborting coded errors.
	 * Defaults to false so production applications can report and recover.
	 */
	strictRuntime?: boolean;

	/**
	 * Number of committed frames that absent widget state and memo entries are
	 * retained before in-memory cleanup. Defaults to 1.
	 */
	stateRetentionFrames?: number;

	/**
	 * Position named layers relative to the app root or the viewport.
	 * Defaults to `"root"`.
	 */
	layerMode?: LayerMode;
}

/**
 * Default value for {@link IsmConfig.layerZIndex}.
 * The runtime and CLI scaffold both use this constant.
 *
 * @since 3.3.0
 */
export const DEFAULT_LAYER_Z_INDEX = 100;

/**
 * Default value for {@link IsmConfig.showDevTools}.
 *
 * @since 3.3.0
 */
export const DEFAULT_SHOW_DEV_TOOLS = false;

/** Default value for {@link IsmConfig.strictIds}. */
export const DEFAULT_STRICT_IDS = false;

/** Default value for {@link IsmConfig.strictRuntime}. */
export const DEFAULT_STRICT_RUNTIME = false;

/** Default value for {@link IsmConfig.stateRetentionFrames}. */
export const DEFAULT_STATE_RETENTION_FRAMES = 1;

/** Default value for {@link IsmConfig.layerMode}. */
export const DEFAULT_LAYER_MODE: LayerMode = "root";

/** Canonical public configuration keys, used to keep scaffolds and schemas aligned. */
export const ISM_CONFIG_KEYS = [
	"layerZIndex",
	"layerMode",
	"showDevTools",
	"strictIds",
	"strictRuntime",
	"stateRetentionFrames",
] as const satisfies readonly (keyof IsmConfig)[];

/** Canonical default configuration used by the runtime and CLI scaffold. */
export const DEFAULT_ISM_CONFIG: Readonly<Required<IsmConfig>> = Object.freeze({
	layerZIndex: DEFAULT_LAYER_Z_INDEX,
	layerMode: DEFAULT_LAYER_MODE,
	showDevTools: DEFAULT_SHOW_DEV_TOOLS,
	strictIds: DEFAULT_STRICT_IDS,
	strictRuntime: DEFAULT_STRICT_RUNTIME,
	stateRetentionFrames: DEFAULT_STATE_RETENTION_FRAMES,
});

interface ResolvedIsmConfig {
	layerZIndex: number;
	showDevTools: boolean;
	strictIds: boolean;
	strictRuntime: boolean;
	stateRetentionFrames: number;
	layerMode: LayerMode;
}

/** Resolve and validate runtime configuration. @internal */
export function resolveConfig(config: IsmConfig = {}): ResolvedIsmConfig {
	if (
		config.layerZIndex !== undefined &&
		(typeof config.layerZIndex !== "number" ||
			!Number.isFinite(config.layerZIndex))
	) {
		throw new Error(
			`[ism] Configuration: "layerZIndex" must be a finite number, got ${JSON.stringify(config.layerZIndex)}.`,
		);
	}
	if (
		config.showDevTools !== undefined &&
		typeof config.showDevTools !== "boolean"
	) {
		throw new Error(
			`[ism] Configuration: "showDevTools" must be a boolean, got ${JSON.stringify(config.showDevTools)}.`,
		);
	}
	if (config.strictIds !== undefined && typeof config.strictIds !== "boolean") {
		throw new Error(
			`[ism] Configuration: "strictIds" must be a boolean, got ${JSON.stringify(config.strictIds)}.`,
		);
	}
	if (
		config.strictRuntime !== undefined &&
		typeof config.strictRuntime !== "boolean"
	) {
		throw new Error(
			`[ism] Configuration: "strictRuntime" must be a boolean, got ${JSON.stringify(config.strictRuntime)}.`,
		);
	}
	if (
		config.stateRetentionFrames !== undefined &&
		(!Number.isSafeInteger(config.stateRetentionFrames) ||
			config.stateRetentionFrames < 0)
	) {
		throw new Error(
			`[ism] Configuration: "stateRetentionFrames" must be a non-negative safe integer, got ${JSON.stringify(config.stateRetentionFrames)}.`,
		);
	}
	if (
		config.layerMode !== undefined &&
		config.layerMode !== "root" &&
		config.layerMode !== "viewport"
	) {
		throw new Error(
			`[ism] Configuration: "layerMode" must be "root" or "viewport", got ${JSON.stringify(config.layerMode)}.`,
		);
	}
	return {
		layerZIndex: config.layerZIndex ?? DEFAULT_LAYER_Z_INDEX,
		showDevTools: config.showDevTools ?? DEFAULT_SHOW_DEV_TOOLS,
		strictIds: config.strictIds ?? DEFAULT_STRICT_IDS,
		strictRuntime: config.strictRuntime ?? DEFAULT_STRICT_RUNTIME,
		stateRetentionFrames:
			config.stateRetentionFrames ?? DEFAULT_STATE_RETENTION_FRAMES,
		layerMode: config.layerMode ?? DEFAULT_LAYER_MODE,
	};
}

/**
 * Validate a configuration object and return it unchanged.
 *
 * @param config Configuration to validate.
 * @returns The same configuration object.
 * @throws {Error} When a value has the wrong type or is not finite.
 *
 * @since 3.2.0
 */
export function defineConfig(config: IsmConfig): IsmConfig {
	resolveConfig(config);
	return config;
}
