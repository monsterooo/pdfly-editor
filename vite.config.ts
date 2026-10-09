import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** Next to the main site's 3001, so both can run at once. */
const DEV_PORT = 3002;

/**
 * Cloudflare static-asset headers. frame-ancestors limits who may embed the
 * editor to the configured host origins; with none set, only itself.
 */
function frameAncestorsHeaders(origins: string | undefined): Plugin {
	const allowed = (origins ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
	return {
		name: "pdfly-editor-headers",
		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: "_headers",
				source: `/*\n  Content-Security-Policy: frame-ancestors 'self' ${allowed.join(" ")}\n  X-Content-Type-Options: nosniff\n`,
			});
		},
	};
}

export default defineConfig(({ command, mode }) => {
	/**
	 * The AGPL obliges every deployed copy to offer its source, and the UI
	 * links to it. A build without the link would ship a non-compliant copy.
	 */
	const env = loadEnv(mode, process.cwd(), "VITE_");
	if (command === "build" && !env.VITE_SOURCE_URL) {
		throw new Error(
			"Set VITE_SOURCE_URL to the public repository of this editor before building.",
		);
	}

	return {
		plugins: [
			react(),
			tailwindcss(),
			frameAncestorsHeaders(env.VITE_HOST_ORIGINS),
		],
		server: { port: DEV_PORT, strictPort: true },
		/** MuPDF's ESM loads its own .wasm; pre-bundling breaks that path. */
		optimizeDeps: { exclude: ["mupdf"] },
		/** MuPDF uses top-level await. */
		build: { target: "esnext" },
		worker: { format: "es" },
	};
});
