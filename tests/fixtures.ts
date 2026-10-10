import * as mupdf from "mupdf";

const LETTER: [number, number, number, number] = [0, 0, 612, 792];

/**
 * One-page PDF built with MuPDF itself, so tests need no binary fixtures.
 * Content is raw operators in PDF user space (y-up); F1 is Helvetica-Bold,
 * F2 Times-Roman.
 */
export function makePdf(
	content: string,
	rotate: 0 | 90 | 180 | 270 = 0,
): Uint8Array {
	const doc = new mupdf.PDFDocument();
	const resources = doc.addObject({
		Font: {
			F1: doc.addSimpleFont(new mupdf.Font("Helvetica-Bold")),
			F2: doc.addSimpleFont(new mupdf.Font("Times-Roman")),
		},
	});
	doc.insertPage(-1, doc.addPage(LETTER, rotate, resources, content));
	return doc.saveToBuffer("").asUint8Array().slice();
}

/** Lines of text after reopening the saved bytes. */
export function linesOf(bytes: Uint8Array, pageIndex = 0) {
	const doc = mupdf.Document.openDocument(bytes, "application/pdf");
	const lines: { text: string; bbox: number[] }[] = [];
	let current: { text: string; bbox: number[] } | undefined;
	doc
		.loadPage(pageIndex)
		.toStructuredText("preserve-whitespace")
		.walk({
			beginLine(bbox) {
				current = { text: "", bbox: [...bbox] };
			},
			onChar(ch) {
				if (current) current.text += ch;
			},
			endLine() {
				if (current) lines.push(current);
			},
		});
	return lines;
}

/** Filled rectangles (vector drawings) MuPDF still sees on the page. */
export function vectorCount(bytes: Uint8Array, pageIndex = 0): number {
	const doc = mupdf.Document.openDocument(bytes, "application/pdf");
	let count = 0;
	doc
		.loadPage(pageIndex)
		.toStructuredText("vectors")
		.walk({
			onVector() {
				count++;
			},
		});
	return count;
}

export const INVOICE_PAGE = [
	"0 0 1 rg 60 600 200 40 re f",
	"BT /F1 14 Tf 0.8 0 0 rg 72 700 Td (Invoice 2024) Tj ET",
	"BT /F2 10 Tf 0 0 0 rg 72 686 Td (Keep this line) Tj ET",
].join("\n");

/** Content streams of the page, decoded, in drawing order. */
export function contentStreams(bytes: Uint8Array, pageIndex = 0): string[] {
	const doc = new mupdf.PDFDocument(bytes);
	const contents = doc.loadPage(pageIndex).getObject().get("Contents");
	const parts: string[] = [];
	const read = (part: mupdf.PDFObject) => {
		parts.push(part.readStream().asString());
	};
	if (contents.isArray()) contents.forEach(read);
	else read(contents);
	return parts;
}

/** Several one-line pages, "Page 1" … "Page n", for page operations. */
export function makePagesPdf(count: number): Uint8Array {
	const doc = new mupdf.PDFDocument();
	const resources = doc.addObject({
		Font: { F1: doc.addSimpleFont(new mupdf.Font("Helvetica")) },
	});
	for (let index = 1; index <= count; index++) {
		const content = `BT /F1 12 Tf 72 700 Td (Page ${index}) Tj ET`;
		doc.insertPage(-1, doc.addPage(LETTER, 0, resources, content));
	}
	return doc.saveToBuffer("").asUint8Array().slice();
}

/** A small solid-colour PNG, for image items. */
export function makePng(width = 8, height = 4): Uint8Array {
	const GRAY = 128;
	const pixmap = new mupdf.Pixmap(
		mupdf.ColorSpace.DeviceRGB,
		[0, 0, width, height],
		false,
	);
	pixmap.clear(GRAY);
	return pixmap.asPNG().slice();
}

/** Annotation subtypes left in a saved file, in page order. */
export function annotationTypes(bytes: Uint8Array, pageIndex = 0): string[] {
	const doc = new mupdf.PDFDocument(bytes);
	return doc
		.loadPage(pageIndex)
		.getAnnotations()
		.map((annot) => annot.getType());
}

/**
 * Blank PDF with one page per width, so tests can tell pages apart by
 * width after moving, deleting or extracting them.
 */
export function makePages(widths: readonly number[]): Uint8Array {
	const doc = new mupdf.PDFDocument();
	for (const width of widths) {
		doc.insertPage(-1, doc.addPage([0, 0, width, LETTER[3]], 0, {}, ""));
	}
	return doc.saveToBuffer("").asUint8Array().slice();
}

/** Page widths of saved bytes, in page order. */
export function pageWidths(bytes: Uint8Array): number[] {
	const doc = mupdf.Document.openDocument(bytes, "application/pdf");
	return Array.from({ length: doc.countPages() }, (_, index) => {
		const [x0, , x1] = doc.loadPage(index).getBounds();
		return x1 - x0;
	});
}
