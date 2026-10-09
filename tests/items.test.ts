import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as mupdf from "mupdf";

import { DEFAULT_ITEM_STYLE } from "../src/lib/item-style";
import type { ItemStyle } from "../src/lib/protocol";
import { EditorEngine, EngineError } from "../src/worker/engine";
import {
	annotationTypes,
	INVOICE_PAGE,
	linesOf,
	makePagesPdf,
	makePdf,
	makePng,
	vectorCount,
} from "./fixtures";

const TOLERANCE_PT = 0.5;

function near(actual: number, expected: number) {
	assert.ok(
		Math.abs(actual - expected) < TOLERANCE_PT,
		`${actual} ≉ ${expected}`,
	);
}

function texts(bytes: Uint8Array, page = 0) {
	return linesOf(bytes, page).map((line) => line.text);
}

const RECT_STYLE: ItemStyle = DEFAULT_ITEM_STYLE.rect;

describe("text items", () => {
	test("adds a text box that is flattened into the page on save", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const { id, history } = engine.addItem(
			0,
			{ kind: "text", at: [100, 300], text: "Approved\n已批准" },
			DEFAULT_ITEM_STYLE.text,
		);
		assert.equal(history.canUndo, true);

		const [item] = engine.items(0);
		assert.equal(item.id, id);
		assert.equal(item.kind, "text");
		assert.equal(item.text, "Approved\n已批准");
		near(item.bounds[0], 100);
		near(item.bounds[1], 300);

		const saved = engine.save();
		assert.deepEqual(annotationTypes(saved), []);
		const lines = texts(saved);
		assert.ok(lines.includes("Approved"));
		assert.ok(lines.includes("已批准"));
	});

	test("grows with its text and moves without resizing", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const { id } = engine.addItem(
			0,
			{ kind: "text", at: [100, 300], text: "Hi" },
			DEFAULT_ITEM_STYLE.text,
		);
		const short = engine.items(0)[0].bounds;
		engine.updateItem(0, id, { text: "A much longer line of text" });
		const long = engine.items(0)[0].bounds;
		assert.ok(long[2] - long[0] > short[2] - short[0]);

		engine.updateItem(0, id, { bounds: [200, 400, 210, 410] });
		const moved = engine.items(0)[0].bounds;
		near(moved[0], 200);
		near(moved[1], 400);
		near(moved[2] - moved[0], long[2] - long[0]);
	});

	test("blank text deletes the box", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const { id } = engine.addItem(
			0,
			{ kind: "text", at: [100, 300], text: "Temp" },
			DEFAULT_ITEM_STYLE.text,
		);
		engine.updateItem(0, id, { text: "  " });
		assert.deepEqual(engine.items(0), []);
	});

	test("bold style is kept and written in a bold face", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const style: ItemStyle = {
			...DEFAULT_ITEM_STYLE.text,
			text: { ...DEFAULT_ITEM_STYLE.text.text, bold: true, size: 20 },
		};
		engine.addItem(0, { kind: "text", at: [100, 300], text: "Bold" }, style);
		assert.equal(engine.items(0)[0].style.text.bold, true);
		const reopened = EditorEngine.open(engine.save());
		const line = reopened.lines(0).find((l) => l.text === "Bold");
		assert.ok(line);
		assert.equal(line.style.bold, true);
		near(line.size, 20);
	});
});

describe("shape items", () => {
	test("rectangles move and resize by their bounds", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const { id } = engine.addItem(
			0,
			{ kind: "rect", rect: [100, 100, 200, 150] },
			RECT_STYLE,
		);
		engine.updateItem(0, id, { bounds: [300, 300, 500, 400] });
		const [item] = engine.items(0);
		near(item.bounds[0], 300);
		near(item.bounds[3], 400);
	});

	test("lines and ink keep their shape when moved", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const line = engine.addItem(
			0,
			{ kind: "arrow", from: [100, 100], to: [200, 100] },
			RECT_STYLE,
		);
		const ink = engine.addItem(
			0,
			{
				kind: "ink",
				strokes: [
					[
						[100, 200],
						[150, 250],
						[200, 200],
					],
				],
			},
			DEFAULT_ITEM_STYLE.ink,
		);
		for (const { id } of [line, ink]) {
			const before = engine.items(0).find((item) => item.id === id);
			assert.ok(before);
			const DX = 50;
			const DY = 30;
			engine.updateItem(0, id, {
				bounds: [
					before.bounds[0] + DX,
					before.bounds[1] + DY,
					before.bounds[2] + DX,
					before.bounds[3] + DY,
				],
			});
			const after = engine.items(0).find((item) => item.id === id);
			assert.ok(after);
			near(after.bounds[0], before.bounds[0] + DX);
			near(after.bounds[3], before.bounds[3] + DY);
		}
	});

	test("restyling changes the stored style", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const { id } = engine.addItem(
			0,
			{ kind: "ellipse", rect: [100, 100, 200, 150] },
			RECT_STYLE,
		);
		const style: ItemStyle = { ...RECT_STYLE, fill: [0, 1, 0], strokeWidth: 6 };
		engine.updateItem(0, id, { style });
		assert.deepEqual(engine.items(0)[0].style, style);
	});

	test("whiteout covers what is under it in the saved file", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		engine.addItem(
			0,
			{ kind: "whiteout", rect: [50, 50, 300, 120] },
			DEFAULT_ITEM_STYLE.whiteout,
		);
		const saved = engine.save();
		assert.deepEqual(annotationTypes(saved), []);
		/** The white box is now page content: one more filled shape. */
		assert.equal(vectorCount(saved), vectorCount(makePdf(INVOICE_PAGE)) + 1);
	});
});

describe("markup items", () => {
	test("highlights the text between two points", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const line = engine.lines(0).find((l) => l.text === "Invoice 2024");
		assert.ok(line);
		const [x0, y0, x1, y1] = line.bbox;
		const middle = (y0 + y1) / 2;
		engine.addItem(
			0,
			{ kind: "highlight", from: [x0, middle], to: [x1, middle] },
			DEFAULT_ITEM_STYLE.highlight,
		);
		const [item] = engine.items(0);
		assert.equal(item.kind, "highlight");
		/** The highlight appearance pads the marked text a little. */
		assert.ok(item.bounds[0] <= x0 && item.bounds[2] >= x1);
		assert.ok(item.bounds[1] <= y0 + (y1 - y0) / 2);
	});

	test("refuses a highlight with no text under it", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		assert.throws(
			() =>
				engine.addItem(
					0,
					{ kind: "highlight", from: [400, 500], to: [500, 520] },
					DEFAULT_ITEM_STYLE.highlight,
				),
			(error) =>
				error instanceof EngineError && error.code === "no_text_selected",
		);
		assert.deepEqual(engine.items(0), []);
		assert.equal(engine.history().canUndo, false);
	});
});

describe("image items", () => {
	test("places an image that ends up in the page content", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		engine.addItem(
			0,
			{ kind: "image", rect: [100, 100, 200, 150], bytes: makePng() },
			DEFAULT_ITEM_STYLE.image,
		);
		assert.equal(engine.items(0)[0].kind, "image");
		const saved = engine.save();
		assert.deepEqual(annotationTypes(saved), []);
		let images = 0;
		new mupdf.PDFDocument(saved)
			.loadPage(0)
			.toStructuredText("preserve-images")
			.walk({
				onImageBlock() {
					images++;
				},
			});
		assert.equal(images, 1);
	});

	test("refuses bytes that are not an image", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		assert.throws(
			() =>
				engine.addItem(
					0,
					{
						kind: "image",
						rect: [0, 0, 10, 10],
						bytes: new TextEncoder().encode("nope"),
					},
					DEFAULT_ITEM_STYLE.image,
				),
			(error) =>
				error instanceof EngineError && error.code === "unsupported_image",
		);
	});
});

describe("items and the rest of the file", () => {
	test("keeps annotations the PDF already had", () => {
		const doc = new mupdf.PDFDocument(makePdf(INVOICE_PAGE));
		const note = doc.loadPage(0).createAnnotation("Text");
		note.setRect([10, 10, 30, 30]);
		note.update();
		const engine = EditorEngine.open(
			doc.saveToBuffer("").asUint8Array().slice(),
		);

		assert.deepEqual(engine.items(0), []);
		engine.addItem(0, { kind: "rect", rect: [100, 100, 200, 150] }, RECT_STYLE);
		assert.deepEqual(annotationTypes(engine.save()), ["Text"]);
	});

	test("delete and undo bring an item back", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const { id } = engine.addItem(
			0,
			{ kind: "rect", rect: [100, 100, 200, 150] },
			RECT_STYLE,
		);
		engine.deleteItem(0, id);
		assert.deepEqual(engine.items(0), []);
		engine.undo();
		assert.equal(engine.items(0)[0].id, id);
	});

	test("editing a line leaves items on the page alone", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const line = engine.lines(0).find((l) => l.text === "Invoice 2024");
		assert.ok(line);
		/** A shape right over the line being replaced. */
		engine.addItem(0, { kind: "rect", rect: line.bbox }, RECT_STYLE);
		engine.replaceLine(0, line.index, "Invoice 2025");
		assert.equal(engine.items(0).length, 1);
	});

	test("hiding items leaves them out of the page render only", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const empty = engine.render(0, 1, true);
		const { id } = engine.addItem(
			0,
			{ kind: "rect", rect: [300, 300, 400, 400] },
			{ ...RECT_STYLE, fill: [1, 0, 0] },
		);
		assert.deepEqual(engine.render(0, 1, true), empty);
		assert.notDeepEqual(engine.render(0, 1, false), empty);
		assert.ok(engine.renderItem(0, id, 1).length > 0);
		/** Rendering is not an edit. */
		engine.undo();
		assert.equal(engine.history().canUndo, false);
	});
});

describe("page operations", () => {
	test("rotates a page by quarter turns", () => {
		const engine = EditorEngine.open(makePagesPdf(2));
		const { pages } = engine.rotatePage(0, 90);
		assert.equal(pages[0].width, 792);
		assert.equal(pages[0].height, 612);
		assert.equal(engine.rotatePage(0, -90).pages[0].width, 612);
	});

	test("deletes a page but never the last one", () => {
		const engine = EditorEngine.open(makePagesPdf(2));
		assert.equal(engine.deletePage(0).pages.length, 1);
		assert.deepEqual(texts(engine.save()), ["Page 2"]);
		assert.throws(
			() => engine.deletePage(0),
			(error) => error instanceof EngineError && error.code === "last_page",
		);
	});

	test("inserts a blank page after another, undoably", () => {
		const engine = EditorEngine.open(makePagesPdf(2));
		assert.equal(engine.insertPage(0).pages.length, 3);
		const saved = engine.save();
		assert.deepEqual(texts(saved, 1), []);
		assert.deepEqual(texts(saved, 2), ["Page 2"]);
		assert.equal(engine.undo().pages.length, 2);
	});
});

describe("search", () => {
	test("finds matches on every page, ignoring case", () => {
		const engine = EditorEngine.open(makePagesPdf(3));
		const hits = engine.search("page");
		assert.deepEqual(
			hits.map((hit) => hit.page),
			[0, 1, 2],
		);
		assert.equal(hits[0].rects.length, 1);
		assert.deepEqual(engine.search("   "), []);
	});
});
