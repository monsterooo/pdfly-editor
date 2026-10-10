import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { textStyleFor } from "../src/lib/font-match";
import {
	framePointToPage,
	keepInside,
	mapPoint,
	pageRectToBox,
	rectFromPoints,
	resizeRect,
} from "../src/lib/geometry";
import {
	escapeXml,
	hexToRgb,
	rgbToHex,
	richTextXhtml,
	standardFontName,
	toRgb,
} from "../src/lib/item-style";
import { resolveShortcut } from "../src/lib/shortcuts";
import { isSticky, simplifyStroke, snapAngle } from "../src/lib/tools";
import {
	MAX_ZOOM,
	MIN_ZOOM,
	PAGE_GUTTER_PX,
	renderScale,
	resolveZoom,
	stepZoom,
} from "../src/lib/zoom";

const LETTER = { x: 0, y: 0, width: 612, height: 792 };

describe("item geometry", () => {
	test("rectFromPoints orders corners", () => {
		assert.deepEqual(rectFromPoints([10, 50], [0, 5]), [0, 5, 10, 50]);
	});

	test("mapPoint scales inside the rectangle and offsets flat sides", () => {
		assert.deepEqual(
			mapPoint([0, 0, 10, 10], [0, 0, 20, 40], [5, 5]),
			[10, 20],
		);
		assert.deepEqual(mapPoint([0, 5, 10, 5], [3, 8, 13, 8], [10, 5]), [13, 8]);
	});

	test("resizeRect keeps the opposite edge and a minimum size", () => {
		const options = { min: 4, keepAspect: false };
		assert.deepEqual(
			resizeRect([0, 0, 10, 10], "se", 5, 2, options),
			[0, 0, 15, 12],
		);
		assert.deepEqual(
			resizeRect([0, 0, 10, 10], "w", 20, 0, options),
			[6, 0, 10, 10],
		);
	});

	test("resizeRect keeps the aspect from a corner", () => {
		const resized = resizeRect([0, 0, 20, 10], "se", 20, 0, {
			min: 4,
			keepAspect: true,
		});
		assert.deepEqual(resized, [0, 0, 40, 20]);
		const fromNw = resizeRect([0, 0, 20, 10], "nw", -20, 0, {
			min: 4,
			keepAspect: true,
		});
		assert.deepEqual(fromNw, [-20, -10, 20, 10]);
	});

	test("keepInside slides a rectangle back onto the page", () => {
		assert.deepEqual(
			keepInside([-5, 10, 15, 20], [0, 0, 100, 100]),
			[0, 10, 20, 20],
		);
		assert.deepEqual(
			keepInside([90, 95, 110, 105], [0, 0, 100, 100]),
			[80, 90, 100, 100],
		);
	});

	test("frame and page coordinates round-trip with a MediaBox offset", () => {
		const origin: [number, number] = [10, 20];
		const point = framePointToPage([30, 60], 2, origin);
		assert.deepEqual(point, [25, 50]);
		assert.deepEqual(pageRectToBox([25, 50, 35, 70], 2, origin), {
			left: 30,
			top: 60,
			width: 20,
			height: 40,
		});
	});
});

describe("item styles", () => {
	test("hex round-trips", () => {
		assert.equal(rgbToHex([1, 0.5, 0]), "#ff8000");
		assert.equal(rgbToHex(hexToRgb("#3366cc")), "#3366cc");
		assert.deepEqual(hexToRgb("nonsense"), [0, 0, 0]);
	});

	test("gray and CMYK become RGB", () => {
		assert.deepEqual(toRgb([0.5]), [0.5, 0.5, 0.5]);
		assert.deepEqual(toRgb([0, 1, 1, 0]), [1, 0, 0]);
	});

	test("standard font names by family, weight and slant", () => {
		assert.equal(
			standardFontName({ family: "serif", bold: true, italic: true }),
			"Times-BoldItalic",
		);
		assert.equal(
			standardFontName({ family: "mono", bold: false, italic: true }),
			"Courier-Oblique",
		);
	});

	test("a line's style follows its matched standard font", () => {
		const style = textStyleFor(
			{
				name: "ABCDEF+Arial-BoldMT",
				isBold: false,
				isItalic: false,
				isSerif: false,
				isMono: false,
			},
			11,
			[0.2],
		);
		assert.deepEqual(style, {
			family: "sans",
			bold: true,
			italic: false,
			size: 11,
			color: [0.2, 0.2, 0.2],
		});
	});

	test("rich text escapes markup and keeps empty lines", () => {
		assert.equal(escapeXml(`<a & "b">`), "&lt;a &amp; &quot;b&quot;&gt;");
		const xhtml = richTextXhtml("1 < 2\n\nend", {
			family: "serif",
			bold: true,
			italic: false,
			size: 14,
			color: [1, 0, 0],
		});
		assert.match(xhtml, /font-family:serif/);
		assert.match(xhtml, /font-weight:bold/);
		assert.match(xhtml, /color:#ff0000/);
		assert.match(xhtml, /<p>1 &lt; 2<\/p><p>&#160;<\/p><p>end<\/p>/);
	});
});

describe("zoom", () => {
	test("fit width uses the widest page and the gutters", () => {
		const viewport = { width: 612 + PAGE_GUTTER_PX * 2, height: 400 };
		assert.equal(resolveZoom("fit-width", [LETTER], viewport), 1);
	});

	test("fit page also fits the height", () => {
		const viewport = { width: 2000, height: 792 / 2 + PAGE_GUTTER_PX * 2 };
		assert.equal(resolveZoom("fit-page", [LETTER], viewport), 0.5);
	});

	test("picked zooms are clamped", () => {
		const viewport = { width: 800, height: 600 };
		assert.equal(resolveZoom(100, [LETTER], viewport), MAX_ZOOM);
		assert.equal(resolveZoom(0.01, [LETTER], viewport), MIN_ZOOM);
	});

	test("steps from wherever the zoom is", () => {
		assert.equal(stepZoom(1, 1), 1.25);
		assert.equal(stepZoom(1.1, 1), 1.25);
		assert.equal(stepZoom(1.1, -1), 1);
		assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM);
	});

	test("render scale is capped for huge pages", () => {
		assert.equal(renderScale(1, LETTER, 2), 2);
		const poster = { x: 0, y: 0, width: 5000, height: 5000 };
		assert.ok(renderScale(3, poster, 2) < 1);
	});
});

describe("shortcuts", () => {
	const key = (
		value: string,
		mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean }> = {},
	) => ({
		key: value,
		metaKey: mods.meta ?? false,
		ctrlKey: mods.ctrl ?? false,
		shiftKey: mods.shift ?? false,
		altKey: false,
	});

	test("history and save with either modifier", () => {
		assert.equal(resolveShortcut(key("z", { meta: true }), false), "undo");
		assert.equal(
			resolveShortcut(key("Z", { ctrl: true, shift: true }), false),
			"redo",
		);
		assert.equal(resolveShortcut(key("y", { ctrl: true }), false), "redo");
		assert.equal(resolveShortcut(key("s", { meta: true }), false), "save");
	});

	test("select all with either modifier, but not while typing", () => {
		assert.equal(resolveShortcut(key("a", { meta: true }), false), "selectAll");
		assert.equal(resolveShortcut(key("A", { ctrl: true }), false), "selectAll");
		assert.equal(resolveShortcut(key("a", { meta: true }), true), null);
	});

	test("typing keeps its own keys", () => {
		assert.equal(resolveShortcut(key("z", { meta: true }), true), null);
		assert.equal(resolveShortcut(key("Backspace"), true), null);
		assert.equal(resolveShortcut(key("ArrowLeft"), true), null);
		assert.equal(resolveShortcut(key("Escape"), true), "escape");
		assert.equal(resolveShortcut(key("f", { ctrl: true }), true), "search");
	});

	test("items are deleted and nudged outside fields", () => {
		assert.equal(resolveShortcut(key("Delete"), false), "delete");
		assert.equal(resolveShortcut(key("ArrowDown"), false), "nudgeDown");
		assert.equal(resolveShortcut(key("a"), false), null);
	});
});

describe("tools", () => {
	test("markup and ink stay active, shapes hand back to select", () => {
		assert.equal(isSticky("highlight"), true);
		assert.equal(isSticky("ink"), true);
		assert.equal(isSticky("rect"), false);
		assert.equal(isSticky("text"), false);
	});

	test("snapAngle snaps to 45° and keeps the length", () => {
		assert.deepEqual(snapAngle([0, 0], [10, 1]), [Math.hypot(10, 1), 0]);
		const [x, y] = snapAngle([0, 0], [10, 9]);
		assert.ok(Math.abs(x - y) < 1e-9);
	});

	test("simplifyStroke drops crowded points but keeps the ends", () => {
		const stroke = simplifyStroke(
			[
				[0, 0],
				[0.1, 0],
				[0.2, 0],
				[2, 0],
				[2.1, 0],
			],
			1,
		);
		assert.deepEqual(stroke, [
			[0, 0],
			[2, 0],
			[2.1, 0],
		]);
	});
});

describe("auto zoom", () => {
	test("fits the width but never past the auto cap", async () => {
		const { AUTO_MAX_ZOOM } = await import("../src/lib/zoom");
		const wide = { width: 4000, height: 900 };
		assert.equal(resolveZoom("auto", [LETTER], wide), AUTO_MAX_ZOOM);
		const narrow = { width: 306 + PAGE_GUTTER_PX * 2, height: 900 };
		assert.equal(resolveZoom("auto", [LETTER], narrow), 0.5);
	});
});
