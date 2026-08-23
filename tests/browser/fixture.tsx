import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
	createApp,
	defineWidget,
	type IsmApp,
	makeInteractive,
	type StorageAdapter,
	withLayer,
} from "../../src/index";
import "../../src/styles.css";

interface FixtureControls {
	app: IsmApp;
	secondaryApp?: IsmApp;
	triggerError?: () => void;
	recover?: () => void;
}

declare global {
	interface Window {
		__ismFixture?: FixtureControls;
	}
}

const NativeCounter = defineWidget<{ count: number }, [label: string], void>({
	name: "BrowserNativeCounter",
	defaultState: { count: 0 },
	a11y: { label: ([label]) => label },
	render: ({ args, state, setState, widgetProps }) =>
		createElement(
			"button",
			{
				...widgetProps,
				type: "button",
				onClick: () => setState((previous) => ({ count: previous.count + 1 })),
			},
			`${args[0]}: ${state.count}`,
		),
	getReturnValue: () => undefined,
});

const PersistentCounter = defineWidget<
	{ count: number },
	[label: string],
	void
>({
	name: "BrowserPersistentCounter",
	defaultState: { count: 0 },
	persistent: true,
	a11y: { label: ([label]) => label },
	render: ({ args, state, setState, widgetProps }) =>
		createElement(
			"button",
			{
				...widgetProps,
				type: "button",
				onClick: () => setState((previous) => ({ count: previous.count + 1 })),
			},
			`${args[0]}: ${state.count}`,
		),
	getReturnValue: () => undefined,
});

const CustomCounter = defineWidget<{ count: number }, [label: string], void>({
	name: "BrowserCustomCounter",
	defaultState: { count: 0 },
	a11y: { label: ([label]) => label },
	render: ({ id, args, state, setState, widgetProps }) => {
		const activate = () =>
			setState((previous) => ({ count: previous.count + 1 }));
		return createElement(
			"div",
			{
				...widgetProps,
				...makeInteractive(activate, { id, role: "button" }),
				style: {
					...widgetProps.style,
					display: "inline-block",
					padding: "8px 12px",
					border: "1px solid currentColor",
				},
			},
			`${args[0]}: ${state.count}`,
		);
	},
	getReturnValue: () => undefined,
});

const SurfaceBox = defineWidget<null, [], void>({
	name: "BrowserSurface",
	defaultState: null,
	a11y: { role: "region", label: "Layer surface" },
	render: ({ widgetProps }) =>
		createElement("div", {
			...widgetProps,
			style: {
				...widgetProps.style,
				width: "320px",
				height: "180px",
				border: "1px solid transparent",
			},
		}),
	getReturnValue: () => undefined,
});

const LayerCounter = defineWidget<{ count: number }, [label: string], void>({
	name: "BrowserLayerCounter",
	defaultState: { count: 0 },
	a11y: { label: ([label]) => label },
	render: ({ args, state, setState, widgetProps }) =>
		createElement(
			"button",
			{
				...widgetProps,
				type: "button",
				onClick: () => setState((previous) => ({ count: previous.count + 1 })),
				style: {
					...widgetProps.style,
					position: "absolute",
					top: "12px",
					left: "12px",
				},
			},
			`${args[0]}: ${state.count}`,
		),
	getReturnValue: () => undefined,
});

let failWidgetRender = false;
const FaultyCounter = defineWidget<{ count: number }, [label: string], void>({
	name: "BrowserFaultyCounter",
	defaultState: { count: 0 },
	a11y: { label: ([label]) => label },
	render: ({ args, state, setState, widgetProps }) => {
		if (failWidgetRender) throw new Error("browser fixture render failure");
		return createElement(
			"button",
			{
				...widgetProps,
				type: "button",
				onClick: () => setState((previous) => ({ count: previous.count + 1 })),
			},
			`${args[0]}: ${state.count}`,
		);
	},
	getReturnValue: () => undefined,
});

const browserStorage: StorageAdapter = {
	has: (key) => localStorage.getItem(key) !== null,
	get: (key) => {
		const raw = localStorage.getItem(key);
		if (raw === null) return undefined;
		return JSON.parse(raw) as unknown;
	},
	set: (key, value) => {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) {
			throw new Error("Browser fixture storage could not serialize a value.");
		}
		localStorage.setItem(key, serialized);
	},
	delete: (key) => localStorage.removeItem(key),
	keys: () => {
		const keys: string[] = [];
		for (let index = 0; index < localStorage.length; index++) {
			const key = localStorage.key(index);
			if (key !== null) keys.push(key);
		}
		return keys;
	},
};

function getRoot(id = "root"): HTMLElement {
	const rootElement = document.getElementById(id);
	if (!rootElement) throw new Error(`Missing browser fixture root: ${id}.`);
	return rootElement;
}

function renderApp(app: IsmApp, rootId = "root", strict = false): void {
	const root = createRoot(getRoot(rootId));
	root.render(
		strict
			? createElement(StrictMode, null, createElement(app))
			: createElement(app),
	);
}

function mount(app: IsmApp, strict = false): void {
	renderApp(app, "root", strict);
	window.__ismFixture = { app };
}

function mountInteraction(strict = false): void {
	const App = createApp(() => {
		NativeCounter("Native counter");
		CustomCounter("Custom counter");
	});
	mount(App, strict);
}

function mountPersistence(): void {
	const App = createApp(() => PersistentCounter("Persistent counter"), {
		storage: browserStorage,
		storageNamespace: "browser-persistence",
	});
	mount(App);
}

function mountMultipleRoots(): void {
	const secondaryRoot = document.createElement("div");
	secondaryRoot.id = "root-secondary";
	getRoot("root").after(secondaryRoot);

	const PrimaryApp = createApp(() => NativeCounter("Shared root counter"));
	const SecondaryApp = createApp(() => NativeCounter("Shared root counter"));
	renderApp(PrimaryApp, "root");
	renderApp(SecondaryApp, "root-secondary");
	window.__ismFixture = { app: PrimaryApp, secondaryApp: SecondaryApp };
}

function mountLayers(mode: "root" | "viewport"): void {
	const App = createApp(
		() => {
			SurfaceBox();
			withLayer("overlay", () => LayerCounter("Overlay counter"));
		},
		{ layerMode: mode },
	);
	mount(App);
}

function mountDevTools(): void {
	const App = createApp(
		() => {
			NativeCounter("Inspected counter");
		},
		{ showDevTools: true },
	);
	mount(App);
}

function mountErrorRecovery(showErrorDetails = true): void {
	failWidgetRender = false;
	const App = createApp(() => FaultyCounter("Recoverable counter"), {
		showErrorDetails,
	});
	mount(App);
	window.__ismFixture = {
		app: App,
		triggerError: () => {
			failWidgetRender = true;
			App.markDirty();
		},
		recover: () => {
			failWidgetRender = false;
		},
	};
}

const scenario = new URLSearchParams(window.location.search).get("scenario");
switch (scenario) {
	case "interaction":
		mountInteraction();
		break;
	case "strict-mode":
		mountInteraction(true);
		break;
	case "persistence":
		mountPersistence();
		break;
	case "multiple-roots":
		mountMultipleRoots();
		break;
	case "root-layer":
		mountLayers("root");
		break;
	case "viewport-layer":
		mountLayers("viewport");
		break;
	case "devtools":
		mountDevTools();
		break;
	case "error-recovery":
		mountErrorRecovery(true);
		break;
	case "error-private":
		mountErrorRecovery(false);
		break;
	default:
		mountInteraction();
}
