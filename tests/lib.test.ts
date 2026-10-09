import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
	fillColorOperator,
	fontResourceName,
	glyphHex,
	textRunOperators,
} from "../src/lib/content-stream";
import { type FontTraits, matchStandardFont } from "../src/lib/font-match";
import {
	insetAcrossText,
	pdfNumber,
	quadToRect,
	rectToBox,
	screenToPage,
	textMatrix,
	unionRect,
} from "../src/lib/geometry";

const PLAIN: FontTraits = {
	name: "",
	isBold: false,
	isItalic: false,
	isSerif: false,
	isMono: false,
};

describe("geometry", () => {
	test("text matrix flips the glyph up axis for y-down page space", () => {
		assert.deepEqual(textMatrix([1, 0], [72, 92]), [1, 0, 0, -1, 72, 92]);
		assert.deepEqual(textMatrix([0, 1], [700, 72]), [0, 1, 1, 0, 700, 72]);
		assert.deepEqual(textMatrix([-1, 0], [10, 20]), [-1, 0, 0, 1, 10, 20]);
		assert.deepEqual(textMatrix([0, -1], [10, 20]), [0, -1, -1, 0, 10, 20]);
	});

	test("rect to overlay box and back", () => {
		assert.deepEqual(rectToBox([10, 20, 110, 40], 2), {
			left: 20,
			top: 40,
			width: 200,
			height: 40,
		});
		assert.deepEqual(screenToPage([20, 40], 2), [10, 20]);
	});

	test("inset shrinks across the text, never along it", () => {
		assert.deepEqual(
			insetAcrossText([0, 100, 50, 120], [1, 0], 0.25),
			[0, 105, 50, 115],
		);
		assert.deepEqual(
			insetAcrossText([0, 100, 50, 120], [-1, 0], 0.25),
			[0, 105, 50, 115],
		);
		assert.deepEqual(
			insetAcrossText([100, 0, 120, 50], [0, 1], 0.25),
			[105, 0, 115, 50],
		);
		assert.deepEqual(
			insetAcrossText([0, 0, 10, 10], [0.7071, 0.7071], 0.25),
			[0, 0, 10, 10],
		);
	});

	test("union and quad bounds", () => {
		assert.deepEqual(
			unionRect([0, 0, 10, 10], [5, -5, 20, 8]),
			[0, -5, 20, 10],
		);
		assert.deepEqual(quadToRect([0, 10, 10, 10, 0, 0, 10, 0]), [0, 0, 10, 10]);
	});

	test("pdf numbers are short and never negative zero", () => {
		assert.equal(pdfNumber(1), "1");
		assert.equal(pdfNumber(0.123456), "0.1235");
		assert.equal(pdfNumber(-0.00001), "0");
	});
});

describe("matchStandardFont", () => {
	test("keeps the class, weight and slant", () => {
		assert.equal(
			matchStandardFont({ ...PLAIN, name: "ABCDEF+ArialMT" }),
			"Helvetica",
		);
		assert.equal(
			matchStandardFont({ ...PLAIN, name: "TimesNewRomanPS-BoldItalicMT" }),
			"Times-BoldItalic",
		);
		assert.equal(
			matchStandardFont({ ...PLAIN, name: "Georgia-Italic" }),
			"Times-Italic",
		);
		assert.equal(
			matchStandardFont({ ...PLAIN, name: "CourierNewPSMT" }),
			"Courier",
		);
		assert.equal(
			matchStandardFont({ ...PLAIN, name: "Menlo-Bold" }),
			"Courier-Bold",
		);
		assert.equal(
			matchStandardFont({ ...PLAIN, name: "Calibri-Semibold" }),
			"Helvetica-Bold",
		);
	});

	test("falls back to MuPDF flags when the name says nothing", () => {
		assert.equal(
			matchStandardFont({ ...PLAIN, name: "F12", isSerif: true, isBold: true }),
			"Times-Bold",
		);
		assert.equal(
			matchStandardFont({ ...PLAIN, name: "F3", isMono: true }),
			"Courier",
		);
	});

	test("a sans name beats a wrong serif flag", () => {
		assert.equal(
			matchStandardFont({ ...PLAIN, name: "OpenSans-Regular", isSerif: true }),
			"Helvetica",
		);
	});
});

describe("content stream", () => {
	test("glyph ids are two-byte hex", () => {
		assert.equal(glyphHex([1, 255, 4096]), "000100ff1000");
	});

	test("fill colour follows the component count", () => {
		assert.equal(fillColorOperator([0.5]), "0.5 g");
		assert.equal(fillColorOperator([1, 0, 0]), "1 0 0 rg");
		assert.equal(fillColorOperator([0, 0, 0, 1]), "0 0 0 1 k");
		assert.equal(fillColorOperator([]), "0 g");
	});

	test("a run is isolated in q/Q and drawn through the page matrix", () => {
		const ops = textRunOperators(
			{
				fontResource: "PdflyHelvetica",
				size: 14,
				color: [0.8, 0, 0],
				matrix: [1, 0, 0, -1, 72, 92],
				glyphs: [42],
			},
			[1, 0, 0, -1, 0, 792],
		);
		assert.equal(
			ops,
			[
				"q",
				"1 0 0 -1 0 792 cm",
				"BT",
				"/PdflyHelvetica 14 Tf",
				"0.8 0 0 rg",
				"1 0 0 -1 72 92 Tm",
				"<002a> Tj",
				"ET",
				"Q",
			].join("\n"),
		);
	});

	test("resource names are safe PDF names", () => {
		assert.equal(fontResourceName("Times-BoldItalic"), "PdflyTimesBoldItalic");
		assert.equal(fontResourceName("zh-Hans"), "PdflyzhHans");
	});
});
