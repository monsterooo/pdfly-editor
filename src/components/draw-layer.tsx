import { useRef, useState } from "react";

import {
	framePointToPage,
	keepInside,
	type Point,
	type Rect,
	rectFromPoints,
} from "../lib/geometry";
import { rgbToHex } from "../lib/item-style";
import type { ItemStyle, NewItem } from "../lib/protocol";
import {
	BOX_TOOLS,
	MARKUP_TOOLS,
	simplifyStroke,
	snapAngle,
	type Tool,
} from "../lib/tools";

/** A picture waiting for a click to place it. */
export type Placing = {
	bytes: Uint8Array;
	/** Object URL for the ghost preview. */
	url: string;
	/** Height over width. */
	aspect: number;
	/** Width it would like to be placed at, in points. */
	widthPt: number;
};

/** Drags shorter than this (CSS pixels) count as clicks and draw nothing. */
const MIN_DRAG_PX = 4;
/** Ink points closer than this (points) to the previous one are dropped. */
const INK_MIN_STEP_PT = 0.75;
/** A placed picture never starts wider than this share of the page. */
const MAX_PLACE_SHARE = 0.6;
/** Opacity of the ghost that follows the pointer while placing. */
const GHOST_OPACITY = 0.7;
/** Translucent wash over the dragged area for markup tools. */
const MARKUP_PREVIEW_OPACITY = 0.35;

type DrawLayerProps = {
	tool: Tool;
	style: ItemStyle;
	zoom: number;
	origin: Point;
	pageRect: Rect;
	placing: Placing | null;
	onCreate: (item: NewItem) => void;
	/** The text tool was clicked here (page space). */
	onStartText: (at: Point) => void;
};

/**
 * Transparent layer over a page that turns pointer input into new items
 * while a creation tool is active. Previews are drawn in screen pixels;
 * results are handed over in page space.
 */
export function DrawLayer({
	tool,
	style,
	zoom,
	origin,
	pageRect,
	placing,
	onCreate,
	onStartText,
}: DrawLayerProps) {
	/** Pointer positions of the current gesture, in frame pixels. */
	const [points, setPoints] = useState<Point[]>([]);
	const [shift, setShift] = useState(false);
	const [hover, setHover] = useState<Point | null>(null);
	/** Same points as state, readable synchronously when the pointer lifts. */
	const gesture = useRef<Point[] | null>(null);

	function track(next: Point[] | null) {
		gesture.current = next;
		setPoints(next ?? []);
	}

	const toPage = (point: Point) => framePointToPage(point, zoom, origin);

	function local(event: React.PointerEvent): Point {
		const bounds = event.currentTarget.getBoundingClientRect();
		return [event.clientX - bounds.left, event.clientY - bounds.top];
	}

	function placeAt(point: Point) {
		if (!placing) return;
		const pageWidth = pageRect[2] - pageRect[0];
		const width = Math.min(placing.widthPt, pageWidth * MAX_PLACE_SHARE);
		const height = width * placing.aspect;
		const [cx, cy] = toPage(point);
		const rect = keepInside(
			[cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2],
			pageRect,
		);
		onCreate({ kind: "image", rect, bytes: placing.bytes });
	}

	function finish(path: Point[], snapped: boolean) {
		const first = path[0];
		const last = path[path.length - 1];
		if (!first || !last) return;
		const dragged =
			Math.hypot(last[0] - first[0], last[1] - first[1]) >= MIN_DRAG_PX;

		if (tool === "text") {
			onStartText(toPage(first));
			return;
		}
		if (tool === "ink") {
			if (path.length < 2) return;
			const stroke = simplifyStroke(path.map(toPage), INK_MIN_STEP_PT);
			onCreate({ kind: "ink", strokes: [stroke] });
			return;
		}
		if (!dragged) return;
		if (BOX_TOOLS.has(tool)) {
			onCreate({
				kind: tool as "whiteout" | "rect" | "ellipse",
				rect: rectFromPoints(toPage(first), toPage(last)),
			});
		} else if (tool === "line" || tool === "arrow") {
			const end = snapped ? snapAngle(first, last) : last;
			onCreate({ kind: tool, from: toPage(first), to: toPage(end) });
		} else if (MARKUP_TOOLS.has(tool)) {
			onCreate({
				kind: tool as "highlight" | "underline" | "strikeout",
				from: toPage(first),
				to: toPage(last),
			});
		}
	}

	const first = points[0];
	const last = points[points.length - 1];
	const color = rgbToHex(style.color);
	const strokePx = Math.max(1, style.strokeWidth * zoom);

	return (
		<div
			className={`absolute inset-0 z-20 touch-none ${placing ? "cursor-copy" : tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.stopPropagation();
				if (placing) {
					placeAt(local(event));
					return;
				}
				event.currentTarget.setPointerCapture(event.pointerId);
				setShift(event.shiftKey);
				track([local(event)]);
			}}
			onPointerMove={(event) => {
				if (placing) setHover(local(event));
				const current = gesture.current;
				if (!current) return;
				const point = local(event);
				setShift(event.shiftKey);
				track(tool === "ink" ? [...current, point] : [current[0], point]);
			}}
			onPointerLeave={() => setHover(null)}
			onPointerUp={(event) => {
				const current = gesture.current;
				if (!current) return;
				track(null);
				finish(current, event.shiftKey);
			}}
			onPointerCancel={() => track(null)}
			onClick={(event) => event.stopPropagation()}
		>
			{placing && hover && (
				<img
					src={placing.url}
					alt=""
					aria-hidden
					className="pointer-events-none absolute"
					style={(() => {
						const pageWidth = pageRect[2] - pageRect[0];
						const width =
							Math.min(placing.widthPt, pageWidth * MAX_PLACE_SHARE) * zoom;
						return {
							left: hover[0] - width / 2,
							top: hover[1] - (width * placing.aspect) / 2,
							width,
							opacity: GHOST_OPACITY,
						};
					})()}
				/>
			)}

			{first && last && (
				<svg
					aria-hidden
					className="pointer-events-none absolute inset-0 size-full overflow-visible"
				>
					{(BOX_TOOLS.has(tool) || MARKUP_TOOLS.has(tool)) &&
						(() => {
							const [x0, y0, x1, y1] = rectFromPoints(first, last);
							const box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
							if (tool === "ellipse") {
								return (
									<ellipse
										cx={box.x + box.width / 2}
										cy={box.y + box.height / 2}
										rx={box.width / 2}
										ry={box.height / 2}
										fill={style.fill ? rgbToHex(style.fill) : "none"}
										stroke={color}
										strokeWidth={strokePx}
									/>
								);
							}
							if (tool === "whiteout") {
								return (
									<rect
										{...box}
										fill="white"
										stroke="var(--color-primary)"
										strokeDasharray="4 3"
									/>
								);
							}
							if (MARKUP_TOOLS.has(tool)) {
								return (
									<rect
										{...box}
										fill={color}
										opacity={MARKUP_PREVIEW_OPACITY}
									/>
								);
							}
							return (
								<rect
									{...box}
									fill={style.fill ? rgbToHex(style.fill) : "none"}
									stroke={color}
									strokeWidth={strokePx}
								/>
							);
						})()}
					{(tool === "line" || tool === "arrow") &&
						(() => {
							const end = shift ? snapAngle(first, last) : last;
							return (
								<line
									x1={first[0]}
									y1={first[1]}
									x2={end[0]}
									y2={end[1]}
									stroke={color}
									strokeWidth={strokePx}
									strokeLinecap="round"
								/>
							);
						})()}
					{tool === "ink" && (
						<polyline
							points={points.map((point) => point.join(",")).join(" ")}
							fill="none"
							stroke={color}
							strokeWidth={strokePx}
							strokeLinecap="round"
							strokeLinejoin="round"
							opacity={style.opacity}
						/>
					)}
				</svg>
			)}
		</div>
	);
}
