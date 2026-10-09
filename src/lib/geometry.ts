/** A point, rectangle or affine matrix in the shape MuPDF uses. */
export type Point = [number, number];
export type Rect = [x0: number, y0: number, x1: number, y1: number];
export type Matrix = [number, number, number, number, number, number];

/** Screen box for absolutely positioned overlays, in CSS pixels. */
export type Box = { left: number; top: number; width: number; height: number };

/**
 * Digits kept when writing numbers into a content stream.
 * Four is well below a hundredth of a point and keeps operators short.
 */
const CONTENT_STREAM_PRECISION = 4;

/**
 * Text matrix for a run drawn in page space.
 * Page space is y-down, so the glyph "up" axis is the reading direction
 * turned a quarter clockwise: [dx dy] → [dy -dx]. MuPDF reports the reading
 * direction per line, which makes rotated pages and rotated text one case.
 */
export function textMatrix(direction: Point, origin: Point): Matrix {
	const [dx, dy] = direction;
	const [ox, oy] = origin;
	/** `|| 0` turns -0 into 0 so equal matrices compare equal. */
	return [dx, dy, dy, -dx || 0, ox, oy];
}

/** Page-space rectangle to an overlay box at the given zoom. */
export function rectToBox(rect: Rect, scale: number): Box {
	const [x0, y0, x1, y1] = rect;
	return {
		left: x0 * scale,
		top: y0 * scale,
		width: (x1 - x0) * scale,
		height: (y1 - y0) * scale,
	};
}

/** Overlay pixel position back to page space. */
export function screenToPage(point: Point, scale: number): Point {
	return [point[0] / scale, point[1] / scale];
}

/**
 * Pulls in the two edges of a line box that run along the text, by a share
 * of the box's thickness across the text. Line boxes include ascenders and
 * descenders, so with tight leading they overlap the neighbouring line;
 * redacting the full box could take glyphs from it.
 * Only the across-the-text axis shrinks: shrinking along the reading
 * direction would leave the first and last glyphs behind. On a rotated page
 * a line runs vertically in page space, so the axis follows `direction`.
 * Slanted text keeps its full box, since an axis-aligned inset would cut
 * into its glyphs.
 */
export function insetAcrossText(
	rect: Rect,
	direction: Point,
	ratio: number,
): Rect {
	const [x0, y0, x1, y1] = rect;
	const [dx, dy] = direction;
	if (dy === 0) {
		const inset = (y1 - y0) * ratio;
		return [x0, y0 + inset, x1, y1 - inset];
	}
	if (dx === 0) {
		const inset = (x1 - x0) * ratio;
		return [x0 + inset, y0, x1 - inset, y1];
	}
	return rect;
}

/** Smallest rectangle around both. */
export function unionRect(a: Rect, b: Rect): Rect {
	return [
		Math.min(a[0], b[0]),
		Math.min(a[1], b[1]),
		Math.max(a[2], b[2]),
		Math.max(a[3], b[3]),
	];
}

/** Bounding rectangle of a MuPDF quad (four corners, eight numbers). */
export function quadToRect(quad: readonly number[]): Rect {
	const xs = [quad[0], quad[2], quad[4], quad[6]];
	const ys = [quad[1], quad[3], quad[5], quad[7]];
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Number as a content-stream token: fixed precision, no trailing zeros. */
export function pdfNumber(value: number): string {
	const rounded = Number(value.toFixed(CONTENT_STREAM_PRECISION));
	return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Rectangle spanned by two corners, in any order. */
export function rectFromPoints(a: Point, b: Point): Rect {
	return [
		Math.min(a[0], b[0]),
		Math.min(a[1], b[1]),
		Math.max(a[0], b[0]),
		Math.max(a[1], b[1]),
	];
}

export function translateRect(rect: Rect, dx: number, dy: number): Rect {
	return [rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy];
}

/**
 * Moves a point the way `from` maps onto `to`: same relative position
 * inside the rectangle. A zero-width or zero-height side maps by offset
 * alone, so a horizontal line can still be moved.
 */
export function mapPoint(from: Rect, to: Rect, point: Point): Point {
	const map = (
		value: number,
		a0: number,
		a1: number,
		b0: number,
		b1: number,
	) =>
		a1 === a0 ? value + (b0 - a0) : b0 + ((value - a0) / (a1 - a0)) * (b1 - b0);
	return [
		map(point[0], from[0], from[2], to[0], to[2]),
		map(point[1], from[1], from[3], to[1], to[3]),
	];
}

/** Selection handles: corners and edge midpoints, by compass direction. */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: readonly Handle[] = [
	"nw",
	"n",
	"ne",
	"e",
	"se",
	"s",
	"sw",
	"w",
];

/**
 * Drags one handle of `rect` by (dx, dy). The opposite side stays put and
 * no side gets shorter than `min`. With `keepAspect`, corner handles scale
 * both sides by the larger of the two changes and edge handles are not
 * offered (see the item layer).
 */
export function resizeRect(
	rect: Rect,
	handle: Handle,
	dx: number,
	dy: number,
	options: { min: number; keepAspect: boolean },
): Rect {
	let [x0, y0, x1, y1] = rect;
	const west = handle.includes("w");
	const east = handle.includes("e");
	const north = handle.includes("n");
	const south = handle.includes("s");

	if (options.keepAspect && (west || east) && (north || south)) {
		const width = x1 - x0;
		const height = y1 - y0;
		const growX = (east ? dx : -dx) / width;
		const growY = (south ? dy : -dy) / height;
		const grow = Math.abs(growX) > Math.abs(growY) ? growX : growY;
		const scale = Math.max(1 + grow, options.min / width, options.min / height);
		const newWidth = width * scale;
		const newHeight = height * scale;
		if (west) x0 = x1 - newWidth;
		else x1 = x0 + newWidth;
		if (north) y0 = y1 - newHeight;
		else y1 = y0 + newHeight;
		return [x0, y0, x1, y1];
	}

	if (west) x0 = Math.min(x0 + dx, x1 - options.min);
	if (east) x1 = Math.max(x1 + dx, x0 + options.min);
	if (north) y0 = Math.min(y0 + dy, y1 - options.min);
	if (south) y1 = Math.max(y1 + dy, y0 + options.min);
	return [x0, y0, x1, y1];
}

/**
 * Shifts a rectangle the least amount that keeps it inside `bounds`, so an
 * item dragged off the page edge stops at the edge.
 */
export function keepInside(rect: Rect, bounds: Rect): Rect {
	const dx =
		rect[0] < bounds[0]
			? bounds[0] - rect[0]
			: rect[2] > bounds[2]
				? Math.max(bounds[2] - rect[2], bounds[0] - rect[0])
				: 0;
	const dy =
		rect[1] < bounds[1]
			? bounds[1] - rect[1]
			: rect[3] > bounds[3]
				? Math.max(bounds[3] - rect[3], bounds[1] - rect[1])
				: 0;
	return translateRect(rect, dx, dy);
}

/**
 * Page-space rectangle to an overlay box inside a page frame. `origin` is
 * the page's top-left in page space (non-zero for offset MediaBoxes).
 */
export function pageRectToBox(rect: Rect, zoom: number, origin: Point): Box {
	return rectToBox(
		[
			rect[0] - origin[0],
			rect[1] - origin[1],
			rect[2] - origin[0],
			rect[3] - origin[1],
		],
		zoom,
	);
}

/** Pixel offset inside a page frame to a point in page space. */
export function framePointToPage(
	point: Point,
	zoom: number,
	origin: Point,
): Point {
	return [point[0] / zoom + origin[0], point[1] / zoom + origin[1]];
}
