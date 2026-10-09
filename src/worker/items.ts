import * as mupdf from "mupdf";

import {
	mapPoint,
	type Point,
	type Rect,
	translateRect,
} from "../lib/geometry";
import {
	DA_FONT,
	MARKUP_KINDS,
	richTextXhtml,
	TEXT_LINE_HEIGHT,
} from "../lib/item-style";
import type {
	ItemKind,
	ItemStyle,
	NewItem,
	PageItem,
	TextStyle,
} from "../lib/protocol";

/**
 * Key on each annotation the editor creates, holding its kind and style as
 * JSON. It tells our items from annotations the PDF already had (only ours
 * are listed, moved and flattened on save) and keeps the style the UI chose
 * even where the annotation has no field for it.
 */
export const ITEM_KEY = "PdflyItem";

/** Annotation subtype for each kind. */
const SUBTYPE: Record<ItemKind, mupdf.PDFAnnotationType> = {
	text: "FreeText",
	whiteout: "Square",
	rect: "Square",
	ellipse: "Circle",
	line: "Line",
	arrow: "Line",
	ink: "Ink",
	highlight: "Highlight",
	underline: "Underline",
	strikeout: "StrikeOut",
	image: "Stamp",
};

/** Kinds positioned by /Rect, as opposed to by line points or ink paths. */
const RECT_KINDS: ReadonlySet<ItemKind> = new Set([
	"text",
	"whiteout",
	"rect",
	"ellipse",
	"image",
]);

const ARROW_HEAD: mupdf.PDFAnnotationLineEndingStyle = "OpenArrow";
const NO_ENDING: mupdf.PDFAnnotationLineEndingStyle = "None";
const WHITE: mupdf.Color = [1, 1, 1];

type ItemMeta = { kind: ItemKind; style: ItemStyle };

export function readMeta(annot: mupdf.PDFAnnotation): ItemMeta | null {
	const value = annot.getObject().get(ITEM_KEY);
	if (value.isNull()) return null;
	try {
		return JSON.parse(value.asString()) as ItemMeta;
	} catch {
		return null;
	}
}

function writeMeta(
	doc: mupdf.PDFDocument,
	annot: mupdf.PDFAnnotation,
	meta: ItemMeta,
) {
	annot.getObject().put(ITEM_KEY, doc.newString(JSON.stringify(meta)));
}

/** Identity of an annotation that survives reloading the page and undo. */
export function itemId(annot: mupdf.PDFAnnotation): number {
	return annot.getObject().asIndirect();
}

export function ourAnnotations(page: mupdf.PDFPage): mupdf.PDFAnnotation[] {
	return page.getAnnotations().filter((annot) => readMeta(annot) !== null);
}

export function toPageItem(annot: mupdf.PDFAnnotation): PageItem | null {
	const meta = readMeta(annot);
	if (!meta) return null;
	return {
		id: itemId(annot),
		kind: meta.kind,
		bounds: [...annot.getBounds()] as Rect,
		text: meta.kind === "text" ? annot.getContents() : "",
		style: meta.style,
	};
}

/** Measures text in the font MuPDF will lay it out in. */
export type TextMeasure = (text: string, style: TextStyle) => number;

/**
 * Extra width on a text box, in font sizes, so MuPDF's layout never wraps
 * a line the measurement says fits (its HTML engine rounds differently).
 */
const TEXT_BOX_SLACK_EM = 0.5;

/** Box for a text item whose top-left corner is `at`, sized to its lines. */
export function textBoxRect(
	at: Point,
	text: string,
	style: TextStyle,
	measure: TextMeasure,
): Rect {
	const lines = text.split("\n");
	const width =
		Math.max(...lines.map((line) => measure(line, style))) +
		style.size * TEXT_BOX_SLACK_EM;
	const height = lines.length * style.size * TEXT_LINE_HEIGHT;
	return [at[0], at[1], at[0] + width, at[1] + height];
}

function setText(
	annot: mupdf.PDFAnnotation,
	text: string,
	style: TextStyle,
	measure: TextMeasure,
	at: Point,
) {
	annot.setDefaultAppearance(DA_FONT[style.family], style.size, style.color);
	annot.setRichContents(text, richTextXhtml(text, style));
	annot.setRect(textBoxRect(at, text, style, measure));
}

/** Applies the style fields a kind uses. */
function applyStyle(
	annot: mupdf.PDFAnnotation,
	kind: ItemKind,
	style: ItemStyle,
) {
	switch (kind) {
		case "whiteout":
			/** No border colour: nothing is stroked, the box is fill only. */
			annot.setColor([]);
			annot.setInteriorColor(WHITE);
			annot.setBorderWidth(0);
			return;
		case "rect":
		case "ellipse":
			annot.setColor(style.color);
			annot.setInteriorColor(style.fill ?? []);
			annot.setBorderWidth(style.strokeWidth);
			annot.setOpacity(style.opacity);
			return;
		case "line":
		case "arrow":
		case "ink":
			annot.setColor(style.color);
			annot.setBorderWidth(style.strokeWidth);
			annot.setOpacity(style.opacity);
			return;
		case "highlight":
		case "underline":
		case "strikeout":
			annot.setColor(style.color);
			return;
		case "text":
			annot.setBorderWidth(0);
			return;
		case "image":
			return;
	}
}

export class ItemError extends Error {
	constructor(readonly code: "no_text_selected" | "unsupported_image") {
		super(code);
	}
}

/** Creates one item on the page. The caller wraps it in a journal operation. */
export function createItem(
	doc: mupdf.PDFDocument,
	page: mupdf.PDFPage,
	item: NewItem,
	style: ItemStyle,
	measure: TextMeasure,
): mupdf.PDFAnnotation {
	/** Validate before creating anything, so a refusal leaves no stub behind. */
	let quads: mupdf.Quad[] = [];
	let image: mupdf.Image | undefined;
	if (MARKUP_KINDS.has(item.kind) && "from" in item) {
		quads = page.toStructuredText("").highlight(item.from, item.to);
		if (quads.length === 0) throw new ItemError("no_text_selected");
	}
	if (item.kind === "image") {
		try {
			image = new mupdf.Image(item.bytes);
		} catch {
			throw new ItemError("unsupported_image");
		}
	}

	const annot = page.createAnnotation(SUBTYPE[item.kind]);
	writeMeta(doc, annot, { kind: item.kind, style });
	switch (item.kind) {
		case "text":
			setText(annot, item.text, style.text, measure, item.at);
			break;
		case "whiteout":
		case "rect":
		case "ellipse":
			annot.setRect(item.rect);
			break;
		case "line":
		case "arrow":
			annot.setLine(item.from, item.to);
			annot.setLineEndingStyles(
				NO_ENDING,
				item.kind === "arrow" ? ARROW_HEAD : NO_ENDING,
			);
			break;
		case "ink":
			annot.setInkList(item.strokes);
			break;
		case "highlight":
		case "underline":
		case "strikeout":
			annot.setQuadPoints(quads);
			break;
		case "image":
			annot.setRect(item.rect);
			if (image) annot.setStampImage(image);
			break;
	}
	applyStyle(annot, item.kind, style);
	annot.update();
	return annot;
}

/** Restyles an item; text boxes are laid out again for the new style. */
export function restyleItem(
	doc: mupdf.PDFDocument,
	annot: mupdf.PDFAnnotation,
	style: ItemStyle,
	measure: TextMeasure,
) {
	const meta = readMeta(annot);
	if (!meta) return;
	writeMeta(doc, annot, { kind: meta.kind, style });
	if (meta.kind === "text") {
		const [x0, y0] = annot.getRect();
		setText(annot, annot.getContents(), style.text, measure, [x0, y0]);
	}
	applyStyle(annot, meta.kind, style);
	annot.update();
}

export function retextItem(
	annot: mupdf.PDFAnnotation,
	text: string,
	measure: TextMeasure,
) {
	const meta = readMeta(annot);
	if (meta?.kind !== "text") return;
	const [x0, y0] = annot.getRect();
	setText(annot, text, meta.style.text, measure, [x0, y0]);
	annot.update();
}

/**
 * Moves or resizes an item so its visual bounds become `bounds`.
 * Geometry is mapped from the old bounds to the new, which covers moving
 * (pure offset) and resizing alike for every kind. Text boxes only move:
 * their size follows the text. Markup stays on its text.
 */
export function placeItem(annot: mupdf.PDFAnnotation, bounds: Rect) {
	const meta = readMeta(annot);
	if (!meta || MARKUP_KINDS.has(meta.kind)) return;
	const from = annot.getBounds();
	const to =
		meta.kind === "text"
			? translateRect(from, bounds[0] - from[0], bounds[1] - from[1])
			: bounds;
	const map = (point: Point) => mapPoint(from, to, point);

	if (RECT_KINDS.has(meta.kind)) {
		/**
		 * Bounds include the stroke drawn around /Rect; that margin stays the
		 * same width whatever the size, so carry it over instead of scaling it.
		 */
		const rect = annot.getRect();
		annot.setRect([
			to[0] + (rect[0] - from[0]),
			to[1] + (rect[1] - from[1]),
			to[2] + (rect[2] - from[2]),
			to[3] + (rect[3] - from[3]),
		]);
	} else if (meta.kind === "ink") {
		annot.setInkList(annot.getInkList().map((stroke) => stroke.map(map)));
	} else {
		const [a, b] = annot.getLine();
		annot.setLine(map(a), map(b));
	}
	annot.update();
}

/**
 * Flattens the editor's items into page content and leaves every other
 * annotation (comments, links, form fields) as it was. MuPDF's bake works
 * on all annotations of a page, so the others are set aside for the bake
 * and put back after it.
 */
export function flattenItems(doc: mupdf.PDFDocument): boolean {
	const split = new Map<
		number,
		{ ours: mupdf.PDFObject[]; others: mupdf.PDFObject[] }
	>();
	for (let index = 0; index < doc.countPages(); index++) {
		const annots = doc.findPage(index).get("Annots");
		if (!annots.isArray()) continue;
		const parts = {
			ours: [] as mupdf.PDFObject[],
			others: [] as mupdf.PDFObject[],
		};
		annots.forEach((annot) => {
			(annot.get(ITEM_KEY).isNull() ? parts.others : parts.ours).push(annot);
		});
		split.set(index, parts);
	}
	if (![...split.values()].some((parts) => parts.ours.length > 0)) return false;

	for (const [index, { ours }] of split) {
		const annots = doc.newArray();
		for (const annot of ours) annots.push(annot);
		doc.findPage(index).put("Annots", annots);
	}
	doc.bake(true, false);
	const setAside = new Map(
		[...split].map(([index, parts]) => [index, parts.others] as const),
	);
	for (const [index, others] of setAside) {
		const pageObject = doc.findPage(index);
		if (others.length === 0) {
			pageObject.delete("Annots");
			continue;
		}
		const annots = doc.newArray();
		for (const annot of others) annots.push(annot);
		pageObject.put("Annots", annots);
	}
	return true;
}
