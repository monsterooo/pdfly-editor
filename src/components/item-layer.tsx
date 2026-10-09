import { PencilLine, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
	HANDLES,
	type Handle,
	keepInside,
	type Point,
	pageRectToBox,
	type Rect,
	resizeRect,
	translateRect,
} from "../lib/geometry";
import {
	HIGHLIGHT_SWATCHES,
	isResizable,
	keepsAspect,
	MARKUP_KINDS,
	STYLE_FIELDS,
} from "../lib/item-style";
import type { ItemStyle, PageItem } from "../lib/protocol";
import {
	ColorPicker,
	OpacitySelect,
	StrokeWidthSelect,
	TextFormatControls,
} from "./style-controls";
import { IconButton, Panel } from "./ui";

/** Pointer travel, in CSS pixels, before a press on an item becomes a drag. */
const DRAG_THRESHOLD_PX = 3;
/** Smallest side an item can be resized to, in points. */
const MIN_ITEM_PT = 4;
/** Room the item toolbar needs above an item; below that it sits underneath. */
const TOOLBAR_ROOM_PX = 56;
/** Space between an item and its toolbar. */
const TOOLBAR_GAP_PX = 10;
/** Handle squares, in CSS pixels. */
const HANDLE_PX = 10;

const HANDLE_POSITION: Record<Handle, { left: string; top: string }> = {
	nw: { left: "0%", top: "0%" },
	n: { left: "50%", top: "0%" },
	ne: { left: "100%", top: "0%" },
	e: { left: "100%", top: "50%" },
	se: { left: "100%", top: "100%" },
	s: { left: "50%", top: "100%" },
	sw: { left: "0%", top: "100%" },
	w: { left: "0%", top: "50%" },
};

const HANDLE_CURSOR: Record<Handle, string> = {
	nw: "nwse-resize",
	se: "nwse-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
	n: "ns-resize",
	s: "ns-resize",
	e: "ew-resize",
	w: "ew-resize",
};

const CORNERS: ReadonlySet<Handle> = new Set(["nw", "ne", "se", "sw"]);

type Drag = {
	id: number;
	mode: "move" | Handle;
	pointer: Point;
	start: Rect;
	current: Rect;
	moved: boolean;
	/** The item was already selected when pressed: a plain click edits text. */
	wasSelected: boolean;
};

type ItemLayerProps = {
	items: PageItem[];
	/** Rendered image of each item, by id. */
	images: ReadonlyMap<number, string>;
	zoom: number;
	origin: Point;
	/** The page in page space; items are kept inside it when dragged. */
	pageRect: Rect;
	interactive: boolean;
	selectedId: number | null;
	/** Text item open in the text editor; hidden here meanwhile. */
	editingId: number | null;
	onSelect: (item: PageItem | null) => void;
	onPlace: (item: PageItem, bounds: Rect) => void;
	onEditText: (item: PageItem) => void;
	onStyle: (item: PageItem, style: ItemStyle) => void;
	onDelete: (item: PageItem) => void;
};

/**
 * Items added to the page, each drawn from its own render so it can follow
 * the pointer while dragged. The selected item gets an outline, resize
 * handles and a toolbar for its style. Moves are committed on release; the
 * item keeps its dragged position until the page re-renders with it there.
 */
export function ItemLayer({
	items,
	images,
	zoom,
	origin,
	pageRect,
	interactive,
	selectedId,
	editingId,
	onSelect,
	onPlace,
	onEditText,
	onStyle,
	onDelete,
}: ItemLayerProps) {
	const [drag, setDrag] = useState<Drag | null>(null);
	const [pending, setPending] = useState<{ id: number; bounds: Rect } | null>(
		null,
	);
	const dragRef = useRef<Drag | null>(null);

	/** New item data has arrived: it already reflects any pending move. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: items is the signal
	useEffect(() => setPending(null), [items]);

	function boundsOf(item: PageItem): Rect {
		if (drag?.id === item.id) return drag.current;
		if (pending?.id === item.id) return pending.bounds;
		return item.bounds;
	}

	function begin(
		event: React.PointerEvent,
		item: PageItem,
		mode: Drag["mode"],
	) {
		if (event.button !== 0) return;
		event.stopPropagation();
		const wasSelected = selectedId === item.id;
		onSelect(item);
		if (mode === "move" && MARKUP_KINDS.has(item.kind)) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		const next: Drag = {
			id: item.id,
			mode,
			pointer: [event.clientX, event.clientY],
			start: item.bounds,
			current: item.bounds,
			moved: false,
			wasSelected,
		};
		dragRef.current = next;
		setDrag(next);
	}

	function move(event: React.PointerEvent, item: PageItem) {
		const current = dragRef.current;
		if (!current) return;
		const dxPx = event.clientX - current.pointer[0];
		const dyPx = event.clientY - current.pointer[1];
		const moved = current.moved || Math.hypot(dxPx, dyPx) > DRAG_THRESHOLD_PX;
		const dx = dxPx / zoom;
		const dy = dyPx / zoom;
		const bounds =
			current.mode === "move"
				? keepInside(translateRect(current.start, dx, dy), pageRect)
				: resizeRect(current.start, current.mode, dx, dy, {
						min: MIN_ITEM_PT,
						keepAspect: keepsAspect(item.kind) || event.shiftKey,
					});
		const next = { ...current, current: bounds, moved };
		dragRef.current = next;
		setDrag(next);
	}

	function end(item: PageItem) {
		const current = dragRef.current;
		dragRef.current = null;
		setDrag(null);
		if (!current) return;
		if (current.moved) {
			setPending({ id: item.id, bounds: current.current });
			onPlace(item, current.current);
		} else if (current.wasSelected && item.kind === "text") {
			onEditText(item);
		}
	}

	const selected = items.find((item) => item.id === selectedId) ?? null;

	return (
		<>
			{items.map((item) => {
				if (item.id === editingId) return null;
				const box = pageRectToBox(boundsOf(item), zoom, origin);
				const image = images.get(item.id);
				const isSelected = item.id === selectedId;
				return (
					<div
						key={item.id}
						role="button"
						tabIndex={interactive ? 0 : -1}
						aria-label={`${item.kind === "text" ? `Text “${item.text}”` : item.kind}, added`}
						aria-pressed={isSelected}
						onPointerDown={(event) => interactive && begin(event, item, "move")}
						onPointerMove={(event) => move(event, item)}
						onPointerUp={() => end(item)}
						onPointerCancel={() => end(item)}
						onClick={(event) => event.stopPropagation()}
						onDoubleClick={() => item.kind === "text" && onEditText(item)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && item.kind === "text")
								onEditText(item);
						}}
						className={`absolute touch-none select-none ${
							interactive
								? MARKUP_KINDS.has(item.kind)
									? "cursor-pointer"
									: "cursor-move"
								: "pointer-events-none"
						} ${isSelected ? "z-20 outline-1 outline-primary" : "z-10 hover:outline-1 hover:outline-primary/50"} focus-visible:outline-2 focus-visible:outline-primary`}
						style={{
							...box,
							/**
							 * Highlights tint the text instead of covering it. Set on the
							 * wrapper: its z-index makes it the blending group.
							 */
							mixBlendMode: item.kind === "highlight" ? "multiply" : undefined,
						}}
					>
						{image && (
							<img
								src={image}
								alt=""
								draggable={false}
								className="pointer-events-none block size-full"
							/>
						)}
						{isSelected &&
							interactive &&
							isResizable(item.kind) &&
							HANDLES.filter(
								(handle) => !keepsAspect(item.kind) || CORNERS.has(handle),
							).map((handle) => (
								<span
									key={handle}
									aria-hidden
									onPointerDown={(event) => begin(event, item, handle)}
									className="absolute rounded-[3px] border-2 border-primary bg-white"
									style={{
										...HANDLE_POSITION[handle],
										width: HANDLE_PX,
										height: HANDLE_PX,
										transform: "translate(-50%, -50%)",
										cursor: HANDLE_CURSOR[handle],
									}}
								/>
							))}
					</div>
				);
			})}

			{selected && interactive && !drag && selected.id !== editingId && (
				<ItemToolbar
					item={selected}
					box={pageRectToBox(boundsOf(selected), zoom, origin)}
					onStyle={(style) => onStyle(selected, style)}
					onEditText={() => onEditText(selected)}
					onDelete={() => onDelete(selected)}
				/>
			)}
		</>
	);
}

/** Style controls and Delete, floating above the selected item. */
function ItemToolbar({
	item,
	box,
	onStyle,
	onEditText,
	onDelete,
}: {
	item: PageItem;
	box: { left: number; top: number; width: number; height: number };
	onStyle: (style: ItemStyle) => void;
	onEditText: () => void;
	onDelete: () => void;
}) {
	const fields = STYLE_FIELDS[item.kind];
	const { style } = item;
	const below = box.top < TOOLBAR_ROOM_PX;
	return (
		<div
			className="absolute z-30"
			style={{
				left: box.left,
				top: below
					? box.top + box.height + TOOLBAR_GAP_PX
					: box.top - TOOLBAR_GAP_PX,
				transform: below ? undefined : "translateY(-100%)",
			}}
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
		>
			<Panel className="flex w-max items-center gap-1 p-1">
				<div role="toolbar" aria-label="Selected item" className="contents">
					{fields.includes("text") && (
						<>
							<TextFormatControls
								style={style.text}
								onChange={(text) => onStyle({ ...style, text })}
							/>
							<IconButton
								icon={PencilLine}
								label="Edit text"
								size="sm"
								onClick={onEditText}
							/>
						</>
					)}
					{fields.includes("color") && (
						<ColorPicker
							label={item.kind === "highlight" ? "Highlight colour" : "Colour"}
							value={style.color}
							swatches={
								item.kind === "highlight" ? HIGHLIGHT_SWATCHES : undefined
							}
							onChange={(color) => color && onStyle({ ...style, color })}
						/>
					)}
					{fields.includes("fill") && (
						<ColorPicker
							label="Fill"
							value={style.fill}
							allowNone
							onChange={(fill) => onStyle({ ...style, fill })}
						/>
					)}
					{fields.includes("strokeWidth") && (
						<StrokeWidthSelect
							value={style.strokeWidth}
							onChange={(strokeWidth) => onStyle({ ...style, strokeWidth })}
						/>
					)}
					{fields.includes("opacity") && (
						<OpacitySelect
							value={style.opacity}
							onChange={(opacity) => onStyle({ ...style, opacity })}
						/>
					)}
					{fields.length > 0 && (
						<span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
					)}
					<IconButton
						icon={Trash2}
						label="Delete"
						size="sm"
						onClick={onDelete}
						className="hover:bg-red-50! hover:text-red-600!"
					/>
				</div>
			</Panel>
		</div>
	);
}
