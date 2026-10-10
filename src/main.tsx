import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { EditorApp } from "./components/editor-app";
import { OrganizeApp } from "./components/organize-app";
import { appMode } from "./lib/app-mode";
import { createHostBridge, parseOrigins } from "./lib/host-bridge";
import "./styles.css";

/** Only talk to a parent page when there is one (the editor is embedded). */
const parent = window.parent !== window ? window.parent : null;
const bridge = createHostBridge(
	parent,
	parseOrigins(import.meta.env.VITE_HOST_ORIGINS),
);

/** `?mode=organize` shows the page organizer; anything else is the editor. */
const App =
	appMode(window.location.search) === "organize" ? OrganizeApp : EditorApp;

const container = document.getElementById("root");
if (container) {
	createRoot(container).render(
		<StrictMode>
			<App bridge={bridge} />
		</StrictMode>,
	);
}
