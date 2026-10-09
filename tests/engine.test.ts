import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EditorEngine, EngineError } from "../src/worker/engine";
import {
	contentStreams,
	INVOICE_PAGE,
	linesOf,
	makePdf,
	vectorCount,
} from "./fixtures";

/** Baseline positions agree to well under a point after a rewrite. */
const POSITION_TOLERANCE_PT = 0.5;

function texts(bytes: Uint8Array) {
	return linesOf(bytes).map((line) => line.text);
}

describe("EditorEngine.replaceLine", () => {
	test("removes the old text and writes the new text in the same place", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const before = engine.lines(0).find((line) => line.text === "Invoice 2024");
		assert.ok(before);

		engine.replaceLine(0, before.index, "Invoice 2025");

		const saved = engine.save();
		assert.deepEqual(texts(saved).sort(), ["Invoice 2025", "Keep this line"]);
		const after = EditorEngine.open(saved)
			.lines(0)
			.find((l) => l.text === "Invoice 2025");
		assert.ok(after);
		assert.ok(
			Math.abs(after.origin[0] - before.origin[0]) < POSITION_TOLERANCE_PT,
		);
		assert.ok(
			Math.abs(after.origin[1] - before.origin[1]) < POSITION_TOLERANCE_PT,
		);
		assert.equal(after.size, before.size);
		assert.deepEqual(after.color, before.color);
		assert.match(after.fontName, /Helvetica-Bold/);
	});

	test("keeps drawings and neighbouring lines with tight leading", () => {
		const tight = [
			"0 0 1 rg 60 600 200 40 re f",
			"BT /F2 12 Tf 72 700 Td (First line here) Tj 0 -12 Td (Second line here) Tj ET",
		].join("\n");
		const engine = EditorEngine.open(makePdf(tight));
		const first = engine
			.lines(0)
			.find((line) => line.text === "First line here");
		assert.ok(first);

		engine.replaceLine(0, first.index, "Changed");

		const saved = engine.save();
		assert.deepEqual(texts(saved).sort(), ["Changed", "Second line here"]);
		assert.equal(vectorCount(saved), vectorCount(makePdf(tight)));
	});

	test("blank text deletes the line", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const line = engine.lines(0).find((l) => l.text === "Invoice 2024");
		assert.ok(line);
		engine.replaceLine(0, line.index, "  ");
		assert.deepEqual(texts(engine.save()), ["Keep this line"]);
	});

	for (const rotate of [90, 180, 270] as const) {
		test(`removes the whole line on a page rotated ${rotate}°`, () => {
			const engine = EditorEngine.open(makePdf(INVOICE_PAGE, rotate));
			const before = engine.lines(0).find((l) => l.text === "Invoice 2024");
			assert.ok(before);
			engine.replaceLine(0, before.index, "Invoice 2025");
			const saved = engine.save();
			assert.deepEqual(texts(saved).sort(), ["Invoice 2025", "Keep this line"]);
			const after = EditorEngine.open(saved)
				.lines(0)
				.find((l) => l.text === "Invoice 2025");
			assert.ok(after);
			assert.deepEqual(after.direction, before.direction);
			assert.ok(
				Math.abs(after.origin[0] - before.origin[0]) < POSITION_TOLERANCE_PT,
			);
			assert.ok(
				Math.abs(after.origin[1] - before.origin[1]) < POSITION_TOLERANCE_PT,
			);
		});
	}

	test("falls back to a font with the glyph and subsets it on save", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const line = engine.lines(0).find((l) => l.text === "Invoice 2024");
		assert.ok(line);
		engine.replaceLine(0, line.index, "发票 2025");
		const saved = engine.save();
		assert.ok(texts(saved).includes("发票 2025"));
		/** The whole fallback font is over a megabyte; a subset is a few KB. */
		const SUBSET_CEILING_BYTES = 100_000;
		assert.ok(
			saved.length < SUBSET_CEILING_BYTES,
			`saved ${saved.length} bytes`,
		);
	});

	test("refuses a character no font has and leaves the page untouched", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const line = engine.lines(0).find((l) => l.text === "Invoice 2024");
		assert.ok(line);
		assert.throws(
			() => engine.replaceLine(0, line.index, "Invoice 🙂"),
			(error) =>
				error instanceof EngineError && error.code === "unsupported_character",
		);
		assert.ok(texts(engine.save()).includes("Invoice 2024"));
		assert.equal(engine.history().canUndo, false);
	});

	test("rejects an unknown line", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		assert.throws(
			() => engine.replaceLine(0, 99, "x"),
			(error) => error instanceof EngineError && error.code === "no_line",
		);
	});

	test("does not nest the content wrapper on repeated edits", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		for (const text of ["One", "Two", "Three"]) {
			const line = engine.lines(0).find((l) => l.text !== "Keep this line");
			assert.ok(line);
			engine.replaceLine(0, line.index, text);
		}
		const saved = engine.save();
		assert.deepEqual(texts(saved).sort(), ["Keep this line", "Three"]);
		const wrappers = contentStreams(saved).filter((part) =>
			part.includes("%pdfly-wrap"),
		);
		assert.equal(wrappers.length, 1);
	});
});

describe("EditorEngine.addText", () => {
	test("draws a new line at the clicked baseline", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		engine.addText(0, [300, 400], "Approved");
		const added = EditorEngine.open(engine.save())
			.lines(0)
			.find((l) => l.text === "Approved");
		assert.ok(added);
		assert.ok(Math.abs(added.origin[0] - 300) < POSITION_TOLERANCE_PT);
		assert.ok(Math.abs(added.origin[1] - 400) < POSITION_TOLERANCE_PT);
	});
});

describe("EditorEngine history", () => {
	test("undo restores the original line and redo applies the edit again", () => {
		const engine = EditorEngine.open(makePdf(INVOICE_PAGE));
		const line = engine.lines(0).find((l) => l.text === "Invoice 2024");
		assert.ok(line);
		assert.deepEqual(engine.replaceLine(0, line.index, "Invoice 2025"), {
			canUndo: true,
			canRedo: false,
		});

		assert.deepEqual(engine.undo(), { canUndo: false, canRedo: true });
		assert.ok(texts(engine.save()).includes("Invoice 2024"));

		engine.redo();
		assert.ok(texts(engine.save()).includes("Invoice 2025"));
		assert.ok(!texts(engine.save()).includes("Invoice 2024"));
	});
});

describe("EditorEngine.open", () => {
	test("rejects bytes that are not a PDF", () => {
		assert.throws(
			() => EditorEngine.open(new TextEncoder().encode("hello")),
			(error) => error instanceof EngineError && error.code === "not_pdf",
		);
	});
});
