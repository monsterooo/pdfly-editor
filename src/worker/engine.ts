import * as mupdf from "mupdf";

import { fontResourceName, textRunOperators } from "../lib/content-stream";
import {
	FALLBACK_FONT_NAME,
	type FontTraits,
	matchStandardFont,
} from "../lib/font-match";
import {
	insetAcrossText,
	type Matrix,
	type Point,
	type Rect,
	textMatrix,
} from "../lib/geometry";
import {
	type EditorErrorCode,
	type HistoryState,
	NEW_TEXT_SIZE,
	type PageSize,
	type TextLine,
} from "../lib/protocol";

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

/** New text boxes: plain black Helvetica, like a typewriter tool. */
const NEW_TEXT_FONT = "Helvetica";
const NEW_TEXT_COLOR = [0];
/** Page space is y-down, so a horizontal line reads along +x. */
const HORIZONTAL: Point = [1, 0];

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
type ScannedLine = TextLine & { traits: FontTraits };

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

	/** PNG of one page at `scale` pixels per point, annotations included. */
	render(pageIndex: number, scale: number): Uint8Array {
		const page = this.doc.loadPage(pageIndex);
		const matrix = mupdf.Matrix.scale(scale, scale);
		return page
			.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
			.asPNG();
	}

	lines(pageIndex: number): TextLine[] {
		return scanLines(this.doc.loadPage(pageIndex)).map(
			({ traits: _traits, ...line }) => line,
		);
	}

	/**
	 * Replaces one line in place: the original glyphs are removed from the
	 * content stream (not covered), then the new text is drawn from the same
	 * baseline in the closest standard font, size and colour.
	 * Blank text deletes the line.
	 */
	replaceLine(
		pageIndex: number,
		lineIndex: number,
		text: string,
	): HistoryState {
		const page = this.doc.loadPage(pageIndex);
		const line = scanLines(page)[lineIndex];
		if (!line?.editable) throw new EngineError("no_line");
		refusePendingRedactions(page);

		const blank = text.trim() === "";
		/** Encode before touching the page so a bad character changes nothing. */
		const encoded = blank
			? undefined
			: this.encode(text, matchStandardFont(line.traits));

		this.operation("Replace text", () => {
			redactText(
				page,
				insetAcrossText(line.bbox, line.direction, REDACT_INSET_RATIO),
			);
			if (encoded) {
				this.drawRun(page, {
					...encoded,
					size: line.size,
					color: line.color,
					matrix: textMatrix(line.direction, line.origin),
				});
			}
		});
		return this.history();
	}

	/** New line of text with its baseline starting at `origin` (page space). */
	addText(pageIndex: number, origin: Point, text: string): HistoryState {
		if (text.trim() === "") return this.history();
		const page = this.doc.loadPage(pageIndex);
		const encoded = this.encode(text, NEW_TEXT_FONT);
		this.operation("Add text", () => {
			this.drawRun(page, {
				...encoded,
				size: NEW_TEXT_SIZE,
				color: NEW_TEXT_COLOR,
				matrix: textMatrix(HORIZONTAL, origin),
			});
		});
		return this.history();
	}

	undo(): HistoryState {
		if (!this.doc.canUndo()) throw new EngineError("nothing_to_undo");
		this.doc.undo();
		return this.history();
	}

	redo(): HistoryState {
		if (!this.doc.canRedo()) throw new EngineError("nothing_to_undo");
		this.doc.redo();
		return this.history();
	}

	history(): HistoryState {
		return { canUndo: this.doc.canUndo(), canRedo: this.doc.canRedo() };
	}

	/**
	 * Full rewrite of the file. Fonts this editor embedded are whole font
	 * programs (the CJK fallback alone is megabytes), so a copy is subset
	 * before the final save; the open document keeps full fonts for later
	 * edits.
	 */
	save(): Uint8Array {
		if (!this.embeddedFonts)
			return ownBytes(this.doc.saveToBuffer(SAVE_OPTIONS));
		const copy = new mupdf.PDFDocument(ownBytes(this.doc.saveToBuffer("")));
		copy.subsetFonts();
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
