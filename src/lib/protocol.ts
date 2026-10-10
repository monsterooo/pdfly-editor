import type { Point, Rect } from "./geometry";

/** Standard font classes the editor writes with. */
export type FontFamily = "sans" | "serif" | "mono";

/** Colour as RGB components, 0–1, the way MuPDF takes them. */
export type Rgb = [number, number, number];

/** How a run of text looks: used for edited lines and added text boxes. */
export type TextStyle = {
	family: FontFamily;
	bold: boolean;
	italic: boolean;
	/** Points. */
	size: number;
	color: Rgb;
};

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
	/** Closest standard style, the starting point of the format bar. */
	style: TextStyle;
	/** Vertical writing is shown but not editable yet. */
	editable: boolean;
};

/**
 * Page bounds in page space. x/y are usually 0 but follow the MediaBox
 * origin, so overlays subtract them to line up with the rendered image.
 */
export type PageSize = { x: number; y: number; width: number; height: number };

/**
 * Things the editor adds on top of a page. Each one is a PDF annotation
 * while editing, so it can be selected, moved and restyled; Download
 * flattens them into the page content.
 */
export type ItemKind =
	| "text"
	| "whiteout"
	| "rect"
	| "ellipse"
	| "line"
	| "arrow"
	| "ink"
	| "highlight"
	| "underline"
	| "strikeout"
	| "image";

/**
 * Look of an added item. Every item carries the whole style and uses the
 * fields that apply to its kind (see STYLE_FIELDS in item-style.ts), which
 * keeps one shape for the UI to edit.
 */
export type ItemStyle = {
	/** Text colour, stroke colour or markup colour. */
	color: Rgb;
	/** Interior of rectangles and ellipses; null is no fill. */
	fill: Rgb | null;
	/** Stroke width in points. */
	strokeWidth: number;
	/** 0–1. */
	opacity: number;
	text: TextStyle;
};

/** An added item as the UI sees it. */
export type PageItem = {
	/** PDF object number of the annotation: stable across moves and undo. */
	id: number;
	kind: ItemKind;
	/** Visual bounds in page space, strokes included. */
	bounds: Rect;
	/** Text items only. */
	text: string;
	style: ItemStyle;
};

/** What the UI asks the engine to create. Coordinates are page space. */
export type NewItem =
	| { kind: "text"; at: Point; text: string }
	| { kind: "whiteout" | "rect" | "ellipse"; rect: Rect }
	| { kind: "line" | "arrow"; from: Point; to: Point }
	| { kind: "ink"; strokes: Point[][] }
	/** Marks the text between two points in reading order. */
	| { kind: "highlight" | "underline" | "strikeout"; from: Point; to: Point }
	/** PNG or JPEG bytes. */
	| { kind: "image"; rect: Rect; bytes: Uint8Array };

/** Changes to an existing item. `bounds` moves or resizes it. */
export type ItemPatch = { bounds?: Rect; text?: string; style?: ItemStyle };

/**
 * Form fields the editor can fill. Push buttons and signature fields are
 * left out: there is nothing to type into or tick.
 */
export type FormFieldKind = "text" | "checkbox" | "radio" | "combo" | "list";

/**
 * One widget of an AcroForm field, in page space. Radio groups list one
 * widget per button; they share `name` and `value`, `checked` tells them apart.
 */
export type FormField = {
	/** PDF object number of the widget: stable across fills and undo. */
	id: number;
	kind: FormFieldKind;
	/** Fully qualified field name. */
	name: string;
	/** Tooltip (/TU) when the author gave one, otherwise the name. */
	label: string;
	bounds: Rect;
	value: string;
	/** Checkboxes and radio buttons: whether this widget is on. */
	checked: boolean;
	/**
	 * Combo and list boxes: each choice's export value (what is stored) and
	 * label (what is shown). They are the same unless the author paired them.
	 */
	options: { value: string; label: string }[];
	multiline: boolean;
	/** Text fields; 0 is no limit. */
	maxLength: number;
	readOnly: boolean;
};

/**
 * What kind of form a document has. XFA-only forms keep their fields in XML
 * MuPDF does not lay out, so they show no fillable widgets.
 */
export type FormSummary = { fields: number; xfaOnly: boolean };

/** A search hit: one rectangle per line the match spans. */
export type SearchHit = { page: number; rects: Rect[] };

/** Why the engine refused something. Stable codes; the UI words them. */
export type EditorErrorCode =
	| "not_pdf"
	| "encrypted"
	| "unsupported_character"
	| "unsupported_image"
	| "no_line"
	| "no_item"
	| "no_text_selected"
	| "last_page"
	| "no_page"
	| "pending_redactions"
	| "no_field"
	| "field_read_only"
	| "invalid_option"
	| "nothing_to_undo"
	| "internal";

export type EditorError = {
	code: EditorErrorCode;
	/** The offending character for unsupported_character. */
	detail?: string;
};

export type HistoryState = { canUndo: boolean; canRedo: boolean };

export const EMPTY_HISTORY: HistoryState = { canUndo: false, canRedo: false };

/**
 * What every change answers with. Undo and page operations can change the
 * page list, so it always comes back with the history.
 */
export type EditResult = { history: HistoryState; pages: PageSize[] };

/** Requests the UI sends the worker. Every one carries a reply id. */
export type EditorRequest =
	| { type: "open"; bytes: ArrayBuffer }
	/** `hideItems` leaves added items out; the UI draws them itself. */
	| { type: "render"; page: number; scale: number; hideItems: boolean }
	| { type: "lines"; page: number }
	| { type: "items"; page: number }
	| { type: "fields"; page: number }
	/** Text, combo and list fields. */
	| { type: "setField"; page: number; id: number; value: string }
	/** Checkboxes and radio buttons. */
	| { type: "toggleField"; page: number; id: number }
	| { type: "renderItem"; page: number; id: number; scale: number }
	| {
			type: "replace";
			page: number;
			line: number;
			text: string;
			style?: TextStyle;
	  }
	| { type: "addItem"; page: number; item: NewItem; style: ItemStyle }
	| { type: "updateItem"; page: number; id: number; patch: ItemPatch }
	| { type: "deleteItem"; page: number; id: number }
	| { type: "rotatePage"; page: number; degrees: number }
	| { type: "deletePage"; page: number }
	| { type: "rotatePages"; pages: number[]; degrees: number }
	| { type: "deletePages"; pages: number[] }
	/** `before` counts in the current order; the page count means the end. */
	| { type: "movePages"; pages: number[]; before: number }
	| { type: "extractPages"; pages: number[] }
	| { type: "insertPage"; after: number }
	| { type: "search"; needle: string }
	| { type: "undo" }
	| { type: "redo" }
	| { type: "save" };

/** What each request resolves to. */
export type EditorResponseMap = {
	open: { pages: PageSize[]; form: FormSummary };
	render: { png: Uint8Array };
	lines: { lines: TextLine[] };
	items: { items: PageItem[] };
	fields: { fields: FormField[] };
	setField: EditResult;
	toggleField: EditResult;
	renderItem: { png: Uint8Array };
	replace: EditResult;
	addItem: EditResult & { id: number };
	updateItem: EditResult;
	deleteItem: EditResult;
	rotatePage: EditResult;
	deletePage: EditResult;
	rotatePages: EditResult;
	deletePages: EditResult;
	movePages: EditResult;
	extractPages: { bytes: Uint8Array };
	insertPage: EditResult;
	search: { hits: SearchHit[] };
	undo: EditResult;
	redo: EditResult;
	save: { bytes: Uint8Array };
};

export type EditorRequestEnvelope = { id: number; request: EditorRequest };

export type EditorReply =
	| { id: number; ok: true; value: unknown }
	| { id: number; ok: false; error: EditorError };
