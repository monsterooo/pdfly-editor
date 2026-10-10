/**
 * Keyboard shortcuts, resolved from a key event to an action name so the
 * mapping can be tested without a DOM. ⌘ on macOS and Ctrl elsewhere are
 * treated alike.
 */
export type ShortcutAction =
	| "undo"
	| "redo"
	| "save"
	| "search"
	| "zoomIn"
	| "zoomOut"
	| "zoomFit"
	| "delete"
	| "selectAll"
	| "escape"
	| "nudgeLeft"
	| "nudgeRight"
	| "nudgeUp"
	| "nudgeDown";

export type KeyLike = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
};

const NUDGE: Record<string, ShortcutAction> = {
	ArrowLeft: "nudgeLeft",
	ArrowRight: "nudgeRight",
	ArrowUp: "nudgeUp",
	ArrowDown: "nudgeDown",
};

/**
 * `typing` is true while focus is in a text field: then only shortcuts that
 * cannot clash with editing text fire (Escape, and ⌘S/⌘F which fields
 * do not use).
 */
export function resolveShortcut(
	event: KeyLike,
	typing: boolean,
): ShortcutAction | null {
	const mod = event.metaKey || event.ctrlKey;
	const key = event.key.toLowerCase();

	if (event.key === "Escape") return "escape";
	if (mod && !event.altKey) {
		if (key === "s") return "save";
		if (key === "f") return "search";
		if (typing) return null;
		if (key === "z") return event.shiftKey ? "redo" : "undo";
		if (key === "y") return "redo";
		if (key === "=" || key === "+") return "zoomIn";
		if (key === "-") return "zoomOut";
		if (key === "0") return "zoomFit";
		if (key === "a") return "selectAll";
		return null;
	}
	if (typing || event.altKey) return null;
	if (event.key === "Delete" || event.key === "Backspace") return "delete";
	return NUDGE[event.key] ?? null;
}

/** Points an arrow key moves the selected item; Shift moves further. */
export const NUDGE_PT = 1;
export const NUDGE_FAR_PT = 10;
