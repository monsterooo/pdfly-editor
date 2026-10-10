import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { appMode } from "../src/lib/app-mode";
import { extractedFileName, organizedFileName } from "../src/lib/files";
import {
	isIdentity,
	movedPositions,
	moveOrder,
	normalizePages,
	rangeSelection,
	selectionAfterDelete,
	stepTarget,
} from "../src/lib/organize";
import { EditorEngine, EngineError } from "../src/worker/engine";
import { makePages, pageWidths } from "./fixtures";

/** Five pages told apart by width: 100 is page 1, 104 is page 5. */
const WIDTHS = [100, 101, 102, 103, 104];

function widths(engine: EditorEngine) {
	return engine.pageSizes().map((size) => size.width);
}

describe("page arithmetic", () => {
	test("normalizes to distinct pages inside the document", () => {
		assert.deepEqual(normalizePages([3, 1, 3, -1, 9, 1.5], 5), [1, 3]);
	});

	test("moves a block before a page, keeping its order", () => {
		assert.deepEqual(moveOrder(5, [3, 1], 0), [1, 3, 0, 2, 4]);
		assert.deepEqual(moveOrder(5, [0], 5), [1, 2, 3, 4, 0]);
		assert.deepEqual(moveOrder(5, [1, 2], 4), [0, 3, 1, 2, 4]);
	});

	test("knows when a move changes nothing", () => {
		assert.ok(isIdentity(moveOrder(5, [2], 2)));
		assert.ok(isIdentity(moveOrder(5, [2], 3)));
		assert.ok(!isIdentity(moveOrder(5, [2], 4)));
	});

	test("follows the moved pages to their new places", () => {
		assert.deepEqual(movedPositions(5, [0, 1], 5), [3, 4]);
	});

	test("steps a block one place left or right, and stops at the edges", () => {
		assert.deepEqual(
			moveOrder(5, [2, 3], stepTarget([2, 3], 1, 5) ?? -1),
			[0, 1, 4, 2, 3],
		);
		assert.deepEqual(
			moveOrder(5, [2, 3], stepTarget([2, 3], -1, 5) ?? -1),
			[0, 2, 3, 1, 4],
		);
		assert.equal(stepTarget([0], -1, 5), null);
		assert.equal(stepTarget([4], 1, 5), null);
		assert.equal(stepTarget([], 1, 5), null);
	});

	test("selects a range either way round", () => {
		assert.deepEqual(rangeSelection(4, 2), [2, 3, 4]);
	});

	test("renumbers a selection after pages are deleted", () => {
		assert.deepEqual(selectionAfterDelete([0, 2, 4], [1, 2]), [0, 2]);
	});
});

describe("EditorEngine page organizing", () => {
	test("moves pages and undoes the move in one step", () => {
		const engine = EditorEngine.open(makePages(WIDTHS));
		engine.movePages([0, 2], 5);
		assert.deepEqual(widths(engine), [101, 103, 104, 100, 102]);
		engine.undo();
		assert.deepEqual(widths(engine), WIDTHS);
		engine.redo();
		assert.deepEqual(pageWidths(engine.save()), [101, 103, 104, 100, 102]);
	});

	test("a move that changes nothing adds no undo step", () => {
		const engine = EditorEngine.open(makePages(WIDTHS));
		engine.movePages([2], 3);
		assert.equal(engine.history().canUndo, false);
	});

	test("rotates several pages in one undo step", () => {
		const engine = EditorEngine.open(makePages(WIDTHS));
		engine.rotatePages([1, 3], 90);
		const rotated = engine.pageSizes();
		/** A quarter turn swaps width and height in the page bounds. */
		assert.equal(rotated[1].width, 792);
		assert.equal(rotated[3].width, 792);
		assert.equal(rotated[0].width, 100);
		engine.undo();
		assert.deepEqual(widths(engine), WIDTHS);
	});

	test("deletes several pages in one undo step", () => {
		const engine = EditorEngine.open(makePages(WIDTHS));
		engine.deletePages([4, 0, 2]);
		assert.deepEqual(widths(engine), [101, 103]);
		engine.undo();
		assert.deepEqual(widths(engine), WIDTHS);
	});

	test("refuses to delete every page", () => {
		const engine = EditorEngine.open(makePages(WIDTHS));
		assert.throws(
			() => engine.deletePages([0, 1, 2, 3, 4]),
			(error: unknown) =>
				error instanceof EngineError && error.code === "last_page",
		);
	});

	test("refuses a request for pages that do not exist", () => {
		const engine = EditorEngine.open(makePages(WIDTHS));
		assert.throws(
			() => engine.rotatePages([7], 90),
			(error: unknown) =>
				error instanceof EngineError && error.code === "no_page",
		);
	});

	test("extracts pages in document order without changing the open PDF", () => {
		const engine = EditorEngine.open(makePages(WIDTHS));
		engine.movePages([4], 0);
		const extracted = engine.extractPages([3, 0]);
		assert.deepEqual(pageWidths(extracted), [104, 102]);
		assert.deepEqual(widths(engine), [104, 100, 101, 102, 103]);
		assert.equal(engine.history().canUndo, true);
	});
});

describe("organizer wiring", () => {
	test("only ?mode=organize opens the organizer", () => {
		assert.equal(appMode("?mode=organize"), "organize");
		assert.equal(appMode("?mode=edit"), "edit");
		assert.equal(appMode(""), "edit");
	});

	test("names downloads so the original is never overwritten", () => {
		assert.equal(organizedFileName("Report.PDF"), "Report-organized.pdf");
		assert.equal(extractedFileName("report.pdf"), "report-pages.pdf");
		assert.equal(extractedFileName(".pdf"), "document-pages.pdf");
	});
});
