import * as mupdf from "mupdf";

import { fontResourceName, textRunOperators } from "../lib/content-stream";
import {
	FALLBACK_FONT_NAME,
	type FontTraits,
	matchStandardFont,
	textStyleFor,
} from "../lib/font-match";
import {
	insetAcrossText,
	type Matrix,
	type Point,
	quadToRect,
	type Rect,
	textMatrix,
} from "../lib/geometry";
import { standardFontName } from "../lib/item-style";
import {
	isIdentity,
	moveOrder,
	moveStart,
	normalizePages,
} from "../lib/organize";
import type {
	EditorErrorCode,
	EditResult,
	FormField,
	FormSummary,
	HistoryState,
	ItemPatch,
	ItemStyle,
	NewItem,
	PageItem,
	PageSize,
	SearchHit,
	TextLine,
	TextStyle,
} from "../lib/protocol";
import { fieldKind, findWidget, pageFields } from "./fields";
import {
	createItem,
	flattenItems,
	ItemError,
	itemId,
	ourAnnotations,
	placeItem,
	restyleItem,
	retextItem,
	type TextMeasure,
	toPageItem,
} from "./items";

const PDF_MIME = "application/pdf";

/** Keep spaces as characters so a replaced line keeps its spacing. */
const STEXT_OPTIONS = "preserve-whitespace";

/** MuPDF's writing mode for vertical text. */
const VERTICAL_WMODE = 1;

/**
 * Share of a line's height trimmed from top and bottom before redacting.
 * Enough to stay clear of the next line under tight leading, while the
 * middle band still crosses every glyph of this line.
 */
const REDACT_INSET_RATIO = 0.2;

/** A quarter turn; pages only rotate in quarter turns. */
const QUARTER_TURN = 90;
const FULL_TURN = 360;

/** Search stops after this many hits so a common word cannot stall the UI. */
const MAX_SEARCH_HITS = 500;
/** "Résumé" finds "resume" and "RESUME", like a browser's find. */
const SEARCH_OPTIONS = "ignore-case,ignore-diacritics";

/**
 * Wrapper around the page's original content. Producers may end their
 * content with an unbalanced `q` or a changed matrix; wrapping it in q/Q
 * means appended runs always start from the default graphics state. The
 * comment marks a page as already wrapped so repeated edits do not nest.
 */
const WRAP_OPEN = "q\n%pdfly-wrap\n";
const WRAP_CLOSE = "Q\n";

/**
 * Save options: drop unused objects, merge duplicate font objects added
 * per page, and compress streams.
 */
const SAVE_OPTIONS = "garbage=deduplicate,compress";

/** A refusal with a stable code. The worker forwards code and detail. */
export class EngineError extends Error {
	constructor(
		readonly code: EditorErrorCode,
		readonly detail?: string,
	) {
		super(detail ? `${code}: ${detail}` : code);
	}
}

/** A line plus the font facts only the engine needs. */
type ScannedLine = Omit<TextLine, "style"> & { traits: FontTraits };

/**
 * Owns one open PDF and every edit to it.
 * Plain MuPDF calls with no worker or DOM, so Node tests drive it directly.
 * Every edit is one journal operation, which gives undo/redo for free and
 * keeps a failed edit from leaving half its changes behind.
 */
export class EditorEngine {
	private readonly fonts = new Map<string, mupdf.Font>();
	private embeddedFonts = false;

	private constructor(private readonly doc: mupdf.PDFDocument) {}

	static open(bytes: Uint8Array): EditorEngine {
		let doc: mupdf.Document;
		try {
			doc = mupdf.Document.openDocument(bytes, PDF_MIME);
		} catch {
			throw new EngineError("not_pdf");
		}
		if (doc.needsPassword()) throw new EngineError("encrypted");
		const pdf = doc.asPDF();
		if (!pdf) throw new EngineError("not_pdf");
		pdf.enableJournal();
		return new EditorEngine(pdf);
	}

	pageSizes(): PageSize[] {
		const sizes: PageSize[] = [];
		for (let index = 0; index < this.doc.countPages(); index++) {
			const [x0, y0, x1, y1] = this.doc.loadPage(index).getBounds();
			sizes.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
		}
		return sizes;
	}

	/**
	 * PNG of one page at `scale` pixels per point, annotations included.
	 * With `hideItems`, the editor's own items are left out: the UI draws
	 * each one separately so it can move them live. Hidden-for-editing is a
	 * runtime flag, not part of the file or the undo journal.
	 */
	render(pageIndex: number, scale: number, hideItems = false): Uint8Array {
		const page = this.doc.loadPage(pageIndex);
		const hidden = hideItems ? ourAnnotations(page) : [];
		for (const annot of hidden) annot.setHiddenForEditing(true);
		try {
			const matrix = mupdf.Matrix.scale(scale, scale);
			return page
				.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
				.asPNG();
		} finally {
			for (const annot of hidden) annot.setHiddenForEditing(false);
		}
	}

	/** Transparent PNG of one item, covering its bounds at `scale`. */
	renderItem(pageIndex: number, id: number, scale: number): Uint8Array {
		const annot = this.findItem(this.doc.loadPage(pageIndex), id);
		return annot
			.toPixmap(
				mupdf.Matrix.scale(scale, scale),
				mupdf.ColorSpace.DeviceRGB,
				true,
			)
			.asPNG();
	}

	items(pageIndex: number): PageItem[] {
		return ourAnnotations(this.doc.loadPage(pageIndex)).flatMap((annot) => {
			const item = toPageItem(annot);
			return item ? [item] : [];
		});
	}

	fields(pageIndex: number): FormField[] {
		return pageFields(this.doc.loadPage(pageIndex));
	}

	/** How many fillable fields the document has, and whether it is XFA only. */
	formSummary(): FormSummary {
		let fields = 0;
		for (let index = 0; index < this.doc.countPages(); index++) {
			fields += this.fields(index).length;
		}
		/** get() on a null object throws, so stop at a missing /AcroForm. */
		const acroForm = this.doc.getTrailer().get("Root").get("AcroForm");
		const xfaOnly =
			fields === 0 && acroForm.isDictionary() && !acroForm.get("XFA").isNull();
		return { fields, xfaOnly };
	}

	/**
	 * Fills a text field, or picks a choice in a combo or list box. MuPDF
	 * regenerates the field's appearance, and the field stays a field, so
	 * the downloaded PDF can still be filled in other apps. Text over the
	 * field's length limit is cut to it, as a PDF viewer would.
	 */
	setField(pageIndex: number, id: number, value: string): EditResult {
		const widget = this.findField(this.doc.loadPage(pageIndex), id);
		const kind = fieldKind(widget);
		this.operation("Fill field", () => {
			if (kind === "text") {
				const limit = widget.getMaxLen();
				widget.setTextValue(
					limit > 0 ? [...value].slice(0, limit).join("") : value,
				);
			} else if (kind === "combo" || kind === "list") {
				if (!widget.getOptions(true).includes(value)) {
					throw new EngineError("invalid_option");
				}
				widget.setChoiceValue(value);
			} else {
				throw new EngineError("no_field");
			}
			widget.update();
		});
		return this.result();
	}

	/**
	 * Ticks or unticks a checkbox, or picks a radio button. MuPDF switches
	 * the other buttons of a radio group off.
	 */
	toggleField(pageIndex: number, id: number): EditResult {
		const widget = this.findField(this.doc.loadPage(pageIndex), id);
		const kind = fieldKind(widget);
		if (kind !== "checkbox" && kind !== "radio") {
			throw new EngineError("no_field");
		}
		this.operation("Toggle field", () => {
			widget.toggle();
			widget.update();
		});
		return this.result();
	}

	lines(pageIndex: number): TextLine[] {
		return scanLines(this.doc.loadPage(pageIndex)).map(
			({ traits, ...line }) => ({
				...line,
				style: textStyleFor(traits, line.size, line.color),
			}),
		);
	}

	/**
	 * Replaces one line in place: the original glyphs are removed from the
	 * content stream (not covered), then the new text is drawn from the same
	 * baseline in the closest standard font, size and colour.
	 * Blank text deletes the line. `style` overrides the matched font, size
	 * and colour.
	 */
	replaceLine(
		pageIndex: number,
		lineIndex: number,
		text: string,
		style?: TextStyle,
	): EditResult {
		const page = this.doc.loadPage(pageIndex);
		const line = scanLines(page)[lineIndex];
		if (!line?.editable) throw new EngineError("no_line");
		refusePendingRedactions(page);

		const blank = text.trim() === "";
		const fontName = style
			? standardFontName(style)
			: matchStandardFont(line.traits);
		/** Encode before touching the page so a bad character changes nothing. */
		const encoded = blank ? undefined : this.encode(text, fontName);

		this.operation("Replace text", () => {
			redactText(
				page,
				insetAcrossText(line.bbox, line.direction, REDACT_INSET_RATIO),
			);
			if (encoded) {
				this.drawRun(page, {
					...encoded,
					size: style?.size ?? line.size,
					color: style?.color ?? line.color,
					matrix: textMatrix(line.direction, line.origin),
				});
			}
		});
		return this.result();
	}

	/** Adds a text box, shape, mark-up, drawing or image. */
	addItem(
		pageIndex: number,
		item: NewItem,
		style: ItemStyle,
	): EditResult & { id: number } {
		const page = this.doc.loadPage(pageIndex);
		let id = 0;
		this.operation(`Add ${item.kind}`, () => {
			id = itemId(
				this.guardItem(() =>
					createItem(this.doc, page, item, style, this.measure),
				),
			);
		});
		return { ...this.result(), id };
	}

	/** Moves, resizes, restyles or retypes an item. Blank text deletes a text box. */
	updateItem(pageIndex: number, id: number, patch: ItemPatch): EditResult {
		const page = this.doc.loadPage(pageIndex);
		const annot = this.findItem(page, id);
		if (patch.text !== undefined && patch.text.trim() === "") {
			return this.deleteItem(pageIndex, id);
		}
		this.operation("Change item", () => {
			if (patch.style) restyleItem(this.doc, annot, patch.style, this.measure);
			if (patch.text !== undefined) retextItem(annot, patch.text, this.measure);
			if (patch.bounds) placeItem(annot, patch.bounds);
		});
		return this.result();
	}

	deleteItem(pageIndex: number, id: number): EditResult {
		const page = this.doc.loadPage(pageIndex);
		const annot = this.findItem(page, id);
		this.operation("Delete item", () => page.deleteAnnotation(annot));
		return this.result();
	}

	/** Turns a page by a multiple of 90°, clockwise for positive degrees. */
	rotatePage(pageIndex: number, degrees: number): EditResult {
		return this.rotatePages([pageIndex], degrees);
	}

	/** Turns several pages at once; one undo step brings them all back. */
	rotatePages(indices: readonly number[], degrees: number): EditResult {
		const pages = this.pagesOf(indices);
		const turns = Math.round(degrees / QUARTER_TURN) * QUARTER_TURN;
		this.operation("Rotate pages", () => {
			for (const index of pages) {
				const pageObject = this.doc.loadPage(index).getObject();
				const current = pageObject.getInheritable("Rotate");
				const from = current.isNumber() ? current.asNumber() : 0;
				const to = (((from + turns) % FULL_TURN) + FULL_TURN) % FULL_TURN;
				pageObject.put("Rotate", to);
			}
		});
		return this.result();
	}

	deletePage(pageIndex: number): EditResult {
		return this.deletePages([pageIndex]);
	}

	/** Deletes several pages in one undo step. At least one page must stay. */
	deletePages(indices: readonly number[]): EditResult {
		const pages = this.pagesOf(indices);
		if (pages.length >= this.doc.countPages()) {
			throw new EngineError("last_page");
		}
		this.operation("Delete pages", () => {
			/** From the end, so earlier indices stay valid while deleting. */
			for (const index of [...pages].reverse()) this.doc.deletePage(index);
		});
		return this.result();
	}

	/**
	 * Moves pages, keeping their own order, so they sit before page `before`
	 * (counted in the current order; the page count means "to the end").
	 * The page objects themselves move, so content and rotation go along.
	 */
	movePages(indices: readonly number[], before: number): EditResult {
		const pages = this.pagesOf(indices);
		const count = this.doc.countPages();
		const target = Math.max(0, Math.min(before, count));
		if (isIdentity(moveOrder(count, pages, target))) return this.result();
		const start = moveStart(pages, target);
		this.operation("Move pages", () => {
			const objects = pages.map((index) => this.doc.findPage(index));
			for (const index of [...pages].reverse()) this.doc.deletePage(index);
			objects.forEach((object, offset) =>
				this.doc.insertPage(start + offset, object),
			);
		});
		return this.result();
	}

	/**
	 * A new PDF of only these pages, in document order, saved like Download.
	 * The open document is left as it is.
	 */
	extractPages(indices: readonly number[]): Uint8Array {
		const pages = this.pagesOf(indices);
		const copy = new mupdf.PDFDocument(this.save());
		copy.rearrangePages(pages);
		return ownBytes(copy.saveToBuffer(SAVE_OPTIONS));
	}

	/** Blank page after `after`, the same size and orientation as it. */
	insertPage(after: number): EditResult {
		const source = this.doc.loadPage(after).getObject();
		const box = source.getInheritable("MediaBox");
		const mediabox: Rect = [0, 1, 2, 3].map((i) =>
			box.get(i).asNumber(),
		) as Rect;
		const rotate = source.getInheritable("Rotate");
		const rotation = (
			rotate.isNumber() ? rotate.asNumber() : 0
		) as mupdf.Rotate;
		this.operation("Insert page", () => {
			const page = this.doc.addPage(mediabox, rotation, {}, "");
			this.doc.insertPage(after + 1, page);
		});
		return this.result();
	}

	/** Case-insensitive matches across the document, in page order. */
	search(needle: string): SearchHit[] {
		const hits: SearchHit[] = [];
		if (needle.trim() === "") return hits;
		for (let index = 0; index < this.doc.countPages(); index++) {
			for (const quads of this.doc
				.loadPage(index)
				.search(needle, SEARCH_OPTIONS)) {
				hits.push({ page: index, rects: quads.map(quadToRect) });
				if (hits.length >= MAX_SEARCH_HITS) return hits;
			}
		}
		return hits;
	}

	undo(): EditResult {
		if (!this.doc.canUndo()) throw new EngineError("nothing_to_undo");
		this.doc.undo();
		return this.result();
	}

	redo(): EditResult {
		if (!this.doc.canRedo()) throw new EngineError("nothing_to_undo");
		this.doc.redo();
		return this.result();
	}

	history(): HistoryState {
		return { canUndo: this.doc.canUndo(), canRedo: this.doc.canRedo() };
	}

	/** The requested pages that exist, ascending; none is a refusal. */
	private pagesOf(indices: readonly number[]): number[] {
		const pages = normalizePages(indices, this.doc.countPages());
		if (pages.length === 0) throw new EngineError("no_page");
		return pages;
	}

	private result(): EditResult {
		return { history: this.history(), pages: this.pageSizes() };
	}

	private findItem(page: mupdf.PDFPage, id: number): mupdf.PDFAnnotation {
		const annot = ourAnnotations(page).find((a) => itemId(a) === id);
		if (!annot) throw new EngineError("no_item");
		return annot;
	}

	/** A fillable, writable widget, or a refusal. */
	private findField(page: mupdf.PDFPage, id: number): mupdf.PDFWidget {
		const widget = findWidget(page, id);
		if (!widget || !fieldKind(widget)) throw new EngineError("no_field");
		if (widget.isReadOnly()) throw new EngineError("field_read_only");
		return widget;
	}

	/** Item refusals become engine errors the UI can word. */
	private guardItem<T>(run: () => T): T {
		try {
			return run();
		} catch (error) {
			if (error instanceof ItemError) throw new EngineError(error.code);
			throw error;
		}
	}

	/**
	 * Width of one line of a text box in points, using the standard font it
	 * will be set in and the fallback font for characters that one lacks,
	 * the same per-character fallback MuPDF's layout applies.
	 */
	private readonly measure: TextMeasure = (text, style) => {
		const font = this.font(standardFontName(style));
		const fallback = this.font(FALLBACK_FONT_NAME);
		let width = 0;
		for (const ch of text) {
			const gid = font.encodeCharacter(ch);
			width +=
				gid !== 0
					? font.advanceGlyph(gid)
					: fallback.advanceGlyph(fallback.encodeCharacter(ch));
		}
		return width * style.size;
	};

	/**
	 * Full rewrite of the file. Added items are flattened into the page
	 * content of a copy, so they look the same in every viewer, while the
	 * open document keeps them editable. Fonts this editor embedded are
	 * whole font programs (the CJK fallback alone is megabytes), so the copy
	 * is subset before the final save.
	 */
	save(): Uint8Array {
		/**
		 * Always work on a copy: garbage collection renumbers and drops
		 * objects, which would break the open document's undo journal.
		 */
		const copy = new mupdf.PDFDocument(ownBytes(this.doc.saveToBuffer("")));
		const flattened = flattenItems(copy);
		if (this.embeddedFonts || flattened) copy.subsetFonts();
		return ownBytes(copy.saveToBuffer(SAVE_OPTIONS));
	}

	private operation(name: string, change: () => void) {
		this.doc.beginOperation(name);
		try {
			change();
			this.doc.endOperation();
		} catch (error) {
			this.doc.abandonOperation();
			throw error;
		}
	}

	private font(name: string): mupdf.Font {
		let font = this.fonts.get(name);
		if (!font) {
			font = new mupdf.Font(name);
			this.fonts.set(name, font);
		}
		return font;
	}

	/**
	 * Glyph ids for `text` in the preferred font, or in the fallback when the
	 * preferred one lacks a character. Glyph id 0 is .notdef: a missing glyph.
	 */
	private encode(text: string, preferred: string) {
		const characters = [...text];
		for (const name of [preferred, FALLBACK_FONT_NAME]) {
			const font = this.font(name);
			const glyphs = characters.map((ch) => font.encodeCharacter(ch));
			if (glyphs.every((gid) => gid !== 0)) return { fontName: name, glyphs };
		}
		const fallback = this.font(FALLBACK_FONT_NAME);
		const missing = characters.find((ch) => fallback.encodeCharacter(ch) === 0);
		throw new EngineError("unsupported_character", missing);
	}

	private drawRun(
		page: mupdf.PDFPage,
		run: {
			fontName: string;
			glyphs: number[];
			size: number;
			color: readonly number[];
			matrix: Matrix;
		},
	) {
		const fontResource = this.ensureFontResource(page, run.fontName);
		const pageToUser = mupdf.Matrix.invert(page.getTransform());
		const operators = textRunOperators({ ...run, fontResource }, pageToUser);
		appendContent(this.doc, page, operators);
	}

	/** Puts the font in the page's /Resources /Font under a stable name. */
	private ensureFontResource(page: mupdf.PDFPage, fontName: string): string {
		const resourceName = fontResourceName(fontName);
		const pageObject = page.getObject();
		let resources = pageObject.getInheritable("Resources");
		if (resources.isNull()) {
			resources = this.doc.newDictionary();
			pageObject.put("Resources", resources);
		}
		let fonts = resources.get("Font");
		if (fonts.isNull()) {
			fonts = this.doc.newDictionary();
			resources.put("Font", fonts);
		}
		if (fonts.get(resourceName).isNull()) {
			fonts.put(resourceName, this.doc.addFont(this.font(fontName)));
			this.embeddedFonts = true;
		}
		return resourceName;
	}
}

/**
 * Copies a MuPDF buffer out of WASM memory. asUint8Array() is a view into
 * the WASM heap: it breaks when the heap grows, and transferring it to the
 * UI thread would detach the heap itself.
 */
function ownBytes(buffer: mupdf.Buffer): Uint8Array {
	return buffer.asUint8Array().slice();
}

/**
 * Lines on a page, from MuPDF's structured text.
 * The first glyph of a line sets its font, size, colour and baseline; a line
 * that mixes styles is edited in the style it starts with. Whitespace-only
 * lines are dropped so line indexes only count things a person can click.
 */
function scanLines(page: mupdf.PDFPage): ScannedLine[] {
	const lines: ScannedLine[] = [];
	let current: ScannedLine | undefined;
	page.toStructuredText(STEXT_OPTIONS).walk({
		beginLine(bbox, wmode, direction) {
			current = {
				index: 0,
				text: "",
				bbox: [...bbox] as Rect,
				origin: [0, 0],
				direction: [...direction] as Point,
				fontName: "",
				size: 0,
				color: [],
				editable: wmode !== VERTICAL_WMODE,
				traits: {
					name: "",
					isBold: false,
					isItalic: false,
					isSerif: false,
					isMono: false,
				},
			};
		},
		onChar(ch, origin, font, size, _quad, color) {
			if (!current) return;
			if (current.text === "") {
				current.origin = [...origin] as Point;
				current.fontName = font.getName();
				current.size = size;
				current.color = [...color];
				current.traits = {
					name: font.getName(),
					isBold: font.isBold(),
					isItalic: font.isItalic(),
					isSerif: font.isSerif(),
					isMono: font.isMono(),
				};
			}
			current.text += ch;
		},
		endLine() {
			if (current && current.text.trim() !== "") {
				current.index = lines.length;
				lines.push(current);
			}
			current = undefined;
		},
	});
	return lines;
}

/**
 * Applying redactions applies every Redact annotation on the page, including
 * ones the author left pending. Refuse instead of applying someone's
 * unfinished redactions behind their back.
 */
function refusePendingRedactions(page: mupdf.PDFPage) {
	if (page.getAnnotations().some((annot) => annot.getType() === "Redact")) {
		throw new EngineError("pending_redactions");
	}
}

/** Removes the glyphs under `rect` from the page content; images and drawings stay. */
function redactText(page: mupdf.PDFPage, rect: Rect) {
	const annot = page.createAnnotation("Redact");
	annot.setRect(rect);
	page.applyRedactions(
		false,
		mupdf.PDFPage.REDACT_IMAGE_NONE,
		mupdf.PDFPage.REDACT_LINE_ART_NONE,
		mupdf.PDFPage.REDACT_TEXT_REMOVE,
	);
}

/** Appends a content stream after the (wrapped) original content. */
function appendContent(
	doc: mupdf.PDFDocument,
	page: mupdf.PDFPage,
	operators: string,
) {
	const pageObject = page.getObject();
	const contents = pageObject.get("Contents");
	const stream = doc.addStream(operators, {});

	if (contents.isArray() && isWrapOpen(contents.get(0))) {
		contents.push(stream);
		return;
	}
	const wrapped = doc.newArray();
	wrapped.push(doc.addStream(WRAP_OPEN, {}));
	if (contents.isArray()) {
		contents.forEach((part) => {
			wrapped.push(part);
		});
	} else if (!contents.isNull()) {
		wrapped.push(contents);
	}
	wrapped.push(doc.addStream(WRAP_CLOSE, {}));
	wrapped.push(stream);
	pageObject.put("Contents", wrapped);
}

/** Streams are indirect: isStream() answers on the reference, not the resolved dictionary. */
function isWrapOpen(part: mupdf.PDFObject): boolean {
	return part.isStream() && part.readStream().asString() === WRAP_OPEN;
}
