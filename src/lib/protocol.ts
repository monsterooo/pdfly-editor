import type { Point, Rect } from "./geometry";

/**
 * Size of text added with "Add text", in points. Shared here so the UI can
 * size its input box without importing the engine (and MuPDF with it).
 */
export const NEW_TEXT_SIZE = 12;

/** One line of text MuPDF found on a page, in page space (points, y-down). */
export type TextLine = {
	/** Index on its page; only stable until the page changes. */
	index: number;
	text: string;
	bbox: Rect;
	/** Baseline start of the first glyph. */
	origin: Point;
	/** Reading direction as a unit vector. */
	direction: Point;
	fontName: string;
	size: number;
	color: number[];
	/** Vertical writing is shown but not editable yet. */
	editable: boolean;
};

/**
 * Page bounds in page space. x/y are usually 0 but follow the MediaBox
 * origin, so overlays subtract them to line up with the rendered image.
 */
export type PageSize = { x: number; y: number; width: number; height: number };

/** Why the engine refused something. Stable codes; the UI words them. */
export type EditorErrorCode =
	| "not_pdf"
	| "encrypted"
	| "unsupported_character"
	| "no_line"
	| "pending_redactions"
	| "nothing_to_undo"
	| "internal";

export type EditorError = {
	code: EditorErrorCode;
	/** The offending character for unsupported_character. */
	detail?: string;
};

export type HistoryState = { canUndo: boolean; canRedo: boolean };

export const EMPTY_HISTORY: HistoryState = { canUndo: false, canRedo: false };

/** Requests the UI sends the worker. Every one carries a reply id. */
export type EditorRequest =
	| { type: "open"; bytes: ArrayBuffer }
	| { type: "render"; page: number; scale: number }
	| { type: "lines"; page: number }
	| { type: "replace"; page: number; line: number; text: string }
	| { type: "add"; page: number; origin: Point; text: string }
	| { type: "undo" }
	| { type: "redo" }
	| { type: "save" };

/** What each request resolves to. */
export type EditorResponseMap = {
	open: { pages: PageSize[] };
	render: { png: Uint8Array };
	lines: { lines: TextLine[] };
	replace: HistoryState;
	add: HistoryState;
	undo: HistoryState;
	redo: HistoryState;
	save: { bytes: Uint8Array };
};

export type EditorRequestEnvelope = { id: number; request: EditorRequest };

export type EditorReply =
	| { id: number; ok: true; value: unknown }
	| { id: number; ok: false; error: EditorError };
