import type { ItemKind } from "./protocol";

/**
 * What a click or drag on the page does. "select" edits existing text and
 * selects added items; every other tool creates one kind of item.
 * Images and signatures are not tools: they pick a picture first, then the
 * next click places it.
 */
export type Tool =
	| "select"
	| "text"
	| "whiteout"
	| "highlight"
	| "underline"
	| "strikeout"
	| "rect"
	| "ellipse"
	| "line"
	| "arrow"
	| "ink";

export type ToolInfo = {
	label: string;
	/** Shown over the page while the tool is active. */
	hint: string;
};

export const TOOL_INFO: Record<Tool, ToolInfo> = {
	select: {
		label: "Edit",
		hint: "Click any text to edit it, or click something you added to move it.",
	},
	text: { label: "Text", hint: "Click where the new text should start." },
	whiteout: {
		label: "Whiteout",
		hint: "Drag over anything to cover it with white.",
	},
	highlight: { label: "Highlight", hint: "Drag across text to highlight it." },
	underline: { label: "Underline", hint: "Drag across text to underline it." },
	strikeout: {
		label: "Strike out",
		hint: "Drag across text to strike it out.",
	},
	rect: { label: "Rectangle", hint: "Drag to draw a rectangle." },
	ellipse: { label: "Ellipse", hint: "Drag to draw an ellipse." },
	line: { label: "Line", hint: "Drag to draw a line. Hold Shift to snap." },
	arrow: { label: "Arrow", hint: "Drag to draw an arrow. Hold Shift to snap." },
	ink: { label: "Draw", hint: "Draw freehand on the page." },
};

/** Tool groups in toolbar order. */
export const TOOL_GROUPS: readonly (readonly Tool[])[] = [
	["select"],
	["text"],
	["whiteout", "highlight", "underline", "strikeout"],
	["rect", "ellipse", "line", "arrow", "ink"],
];

/**
 * Tools that stay active after use, because they are usually used several
 * times in a row. The others hand back to "select" with the new item
 * selected, ready to be adjusted.
 */
const STICKY_TOOLS: ReadonlySet<Tool> = new Set([
	"whiteout",
	"highlight",
	"underline",
	"strikeout",
	"ink",
]);

export function isSticky(tool: Tool): boolean {
	return STICKY_TOOLS.has(tool);
}

/** The item kind a tool creates, or null for "select". */
export function kindOfTool(tool: Tool): ItemKind | null {
	return tool === "select" ? null : tool;
}

/** Tools that draw by dragging out a rectangle. */
export const BOX_TOOLS: ReadonlySet<Tool> = new Set([
	"whiteout",
	"rect",
	"ellipse",
]);

/** Tools that mark text between where a drag starts and ends. */
export const MARKUP_TOOLS: ReadonlySet<Tool> = new Set([
	"highlight",
	"underline",
	"strikeout",
]);

/**
 * Snaps a line's end to the nearest 45° from its start, for Shift-drag.
 * Keeps the length of the dragged vector.
 */
export function snapAngle(
	from: [number, number],
	to: [number, number],
): [number, number] {
	const EIGHTH_TURN = Math.PI / 4;
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const length = Math.hypot(dx, dy);
	const angle = Math.round(Math.atan2(dy, dx) / EIGHTH_TURN) * EIGHTH_TURN;
	const round = (value: number) => (Math.abs(value) < 1e-9 ? 0 : value);
	return [
		from[0] + round(Math.cos(angle) * length),
		from[1] + round(Math.sin(angle) * length),
	];
}

/**
 * Drops ink points closer than `minDistance` to the previous kept point.
 * Pointer events fire far more often than a stroke needs, and every point
 * ends up in the PDF.
 */
export function simplifyStroke(
	points: readonly [number, number][],
	minDistance: number,
): [number, number][] {
	const kept: [number, number][] = [];
	for (const point of points) {
		const last = kept[kept.length - 1];
		if (
			!last ||
			Math.hypot(point[0] - last[0], point[1] - last[1]) >= minDistance
		) {
			kept.push(point);
		}
	}
	const final = points[points.length - 1];
	if (final && kept[kept.length - 1] !== final) kept.push(final);
	return kept;
}
