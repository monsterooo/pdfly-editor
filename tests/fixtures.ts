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

/** Widget annotation flag that makes it print (/F 4). */
const PRINT_FLAG = 4;
/** /Ff bits: read-only, radio (with no-toggle-to-off), combo box. */
const FF_READ_ONLY = 1;
const FF_RADIO = 49152;
const FF_COMBO = 131072;

/**
 * One-page AcroForm built with MuPDF: a text field "name" (value "Jane"),
 * a checkbox "agree", a radio group "size" with buttons S and L, a combo
 * box "color" (Red/Green, export values r/g), a read-only text field "id"
 * and a label line "Name:" in the page content.
 */
export function makeFormPdf(): Uint8Array {
	const doc = new mupdf.PDFDocument();
	const resources = doc.addObject({
		Font: { F1: doc.addSimpleFont(new mupdf.Font("Helvetica-Bold")) },
	});
	doc.insertPage(
		-1,
		doc.addPage(LETTER, 0, resources, "BT /F1 12 Tf 72 720 Td (Name:) Tj ET"),
	);
	const page = doc.findPage(0);
	const da = doc.newString("/Helv 12 Tf 0 g");
	const box = (on: string) => ({
		N: {
			[on]: doc.addStream("0 g 0 0 14 14 re f", { BBox: [0, 0, 14, 14] }),
			Off: doc.addStream("", { BBox: [0, 0, 14, 14] }),
		},
	});
	const widget = (fields: Record<string, unknown>) =>
		doc.addObject({
			Type: "Annot",
			Subtype: "Widget",
			P: page,
			F: PRINT_FLAG,
			...fields,
		});

	const name = widget({
		FT: "Tx",
		T: doc.newString("name"),
		TU: doc.newString("Full name"),
		Rect: [120, 710, 320, 730],
		DA: da,
		V: doc.newString("Jane"),
	});
	const agree = widget({
		FT: "Btn",
		T: doc.newString("agree"),
		Rect: [72, 680, 86, 694],
		V: doc.newName("Off"),
		AS: doc.newName("Off"),
		AP: box("Yes"),
	});
	const size = doc.addObject({
		FT: "Btn",
		Ff: FF_RADIO,
		T: doc.newString("size"),
		V: doc.newName("Off"),
		Kids: [],
	});
	const sizes = ["S", "L"].map((state, i) => {
		const kid = widget({
			Parent: size,
			Rect: [72 + i * 30, 650, 86 + i * 30, 664],
			AS: doc.newName("Off"),
			AP: box(state),
		});
		size.get("Kids").push(kid);
		return kid;
	});
	const color = widget({
		FT: "Ch",
		Ff: FF_COMBO,
		T: doc.newString("color"),
		Rect: [120, 620, 250, 640],
		Opt: [
			[doc.newString("r"), doc.newString("Red")],
			[doc.newString("g"), doc.newString("Green")],
		],
		V: doc.newString("r"),
		DA: da,
	});
	const id = widget({
		FT: "Tx",
		Ff: FF_READ_ONLY,
		T: doc.newString("id"),
		Rect: [120, 580, 320, 600],
		DA: da,
		V: doc.newString("X-1"),
	});
	page.put("Annots", [name, agree, ...sizes, color, id]);
	doc
		.getTrailer()
		.get("Root")
		.put(
			"AcroForm",
			doc.addObject({
				Fields: [name, agree, size, color, id],
				DA: da,
				DR: {
					Font: { Helv: doc.addSimpleFont(new mupdf.Font("Helvetica")) },
				},
				NeedAppearances: true,
			}),
		);
	return doc.saveToBuffer("").asUint8Array().slice();
}
