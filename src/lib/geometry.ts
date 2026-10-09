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
