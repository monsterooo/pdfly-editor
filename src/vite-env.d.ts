/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Comma-separated origins allowed to embed the editor and get its messages. */
	readonly VITE_HOST_ORIGINS?: string;
	/** Public repository with this editor's source code. */
	readonly VITE_SOURCE_URL?: string;
}
