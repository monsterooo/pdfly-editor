/**
 * Messages the editor sends to the page that embeds it.
 * The editor is AGPL and the host page is not, so this is the whole
 * interface between them: plain data, one direction, no shared code.
 */
export const HOST_MESSAGE_TYPE = {
	height: "pdfly-editor:height",
	event: "pdfly-editor:event",
} as const;

/** Funnel events the host may forward to its analytics. */
export type EditorEventName = "edit_opened" | "edit_saved" | "edit_failed";

export type HostMessage =
	/**
	 * `workspace` asks the host for a viewport-tall frame: once a PDF is open
	 * the editor scrolls inside itself so its toolbar stays in view.
	 * Otherwise `height` is the content height in CSS pixels.
	 */
	| {
			type: typeof HOST_MESSAGE_TYPE.height;
			height: number;
			workspace: boolean;
	  }
	| { type: typeof HOST_MESSAGE_TYPE.event; name: EditorEventName };

/** The one method used from window.parent, so tests can pass a fake. */
export type MessageTarget = {
	postMessage(message: unknown, targetOrigin: string): void;
};

/**
 * Comma-separated list of origins allowed to embed the editor, from the
 * build environment. Anything that is not a bare origin is dropped, so a
 * typo cannot widen the list to "*".
 */
export function parseOrigins(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(",")
		.map((part) => part.trim())
		.filter((part) => {
			try {
				return new URL(part).origin === part;
			} catch {
				return false;
			}
		});
}

/**
 * Sends to each allowed origin. The browser drops a message whose target
 * origin does not match the parent, so an unknown embedder gets nothing.
 * No parent (the editor opened on its own) makes sending a no-op.
 */
export function createHostBridge(
	target: MessageTarget | null,
	origins: readonly string[],
) {
	return {
		send(message: HostMessage) {
			if (!target) return;
			for (const origin of origins) target.postMessage(message, origin);
		},
	};
}
