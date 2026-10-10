import { useEffect, useRef, useState } from "react";

import type { EditorClient } from "../lib/editor-client";
import { type Point, pageRectToBox, type Rect } from "../lib/geometry";
import { TEXT_LINE_HEIGHT } from "../lib/item-style";
import type {
	FormField,
	ItemPatch,
	ItemStyle,
	NewItem,
	PageItem,
	PageSize,
	TextLine,
	TextStyle,
} from "../lib/protocol";
import type { Tool } from "../lib/tools";
import { renderScale } from "../lib/zoom";
import { DrawLayer, type Placing } from "./draw-layer";
import { FieldLayer } from "./field-layer";
import { ItemLayer } from "./item-layer";
import { TextEditor } from "./text-editor";

/** Start rendering a page this far before it scrolls into view. */
const PRELOAD_MARGIN = "800px";
/** Width of an empty new text box, in font sizes. */
const NEW_TEXT_MIN_WIDTH_EM = 6;

type Draft =
	| { kind: "line"; line: TextLine }
	| { kind: "new"; at: Point }
	| { kind: "item"; item: PageItem };

/** Everything drawn for one version of a page, swapped in at once. */
type Rendered = {
	key: string;
	image: string;
	lines: TextLine[];
	items: PageItem[];
	itemImages: Map<number, string>;
	fields: FormField[];
};

type EditorPageProps = {
	client: EditorClient;
	index: number;
	size: PageSize;
	zoom: number;
	/** Changes whenever this page's content may have changed. */
	renderKey: string;
	tool: Tool;
	toolStyle: ItemStyle;
	placing: Placing | null;
	selectedId: number | null;
	/** Search matches on this page; the active one is outlined. */
	hits: readonly Rect[];
	activeHit: readonly Rect[];
	onSelect: (item: PageItem | null) => void;
	onCreate: (item: NewItem, style: ItemStyle) => void;
	onUpdateItem: (id: number, patch: ItemPatch) => void;
	onDeleteItem: (id: number) => void;
	onReplace: (line: number, text: string, style?: TextStyle) => void;
	onSetField: (id: number, value: string) => void;
	onToggleField: (id: number) => void;
	onError: (error: unknown) => void;
};

function revokeAll(rendered: Rendered | null) {
	if (!rendered) return;
	URL.revokeObjectURL(rendered.image);
	for (const url of rendered.itemImages.values()) URL.revokeObjectURL(url);
}

function pngUrl(png: Uint8Array) {
	return URL.createObjectURL(
		new Blob([png as BlobPart], { type: "image/png" }),
	);
}

/**
 * One page: the MuPDF render without added items, clickable boxes over its
 * lines of text, the added items as separate images, and the layer the
 * current tool draws on. Renders only near the viewport, and keeps the
 * previous render on screen while the next one is on its way.
 */
export function EditorPage({
	client,
	index,
	size,
	zoom,
	renderKey,
	tool,
	toolStyle,
	placing,
	selectedId,
	hits,
	activeHit,
	onSelect,
	onCreate,
	onUpdateItem,
	onDeleteItem,
	onReplace,
	onSetField,
	onToggleField,
	onError,
}: EditorPageProps) {
	const frame = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const [rendered, setRendered] = useState<Rendered | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const latest = useRef<Rendered | null>(null);

	useEffect(() => {
		const node = frame.current;
		if (!node) return;
		const observer = new IntersectionObserver(
			([entry]) => setVisible(entry.isIntersecting),
			{ rootMargin: PRELOAD_MARGIN },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const key = `${zoom}@${renderKey}`;
		if (!visible || latest.current?.key === key) return;
		let cancelled = false;
		const scale = renderScale(zoom, size, window.devicePixelRatio);
		(async () => {
			const [page, text, list, form] = await Promise.all([
				client.request({ type: "render", page: index, scale, hideItems: true }),
				client.request({ type: "lines", page: index }),
				client.request({ type: "items", page: index }),
				client.request({ type: "fields", page: index }),
			]);
			const pngs = await Promise.all(
				list.items.map((item) =>
					client.request({
						type: "renderItem",
						page: index,
						id: item.id,
						scale,
					}),
				),
			);
			if (cancelled) return;
			const next: Rendered = {
				key,
				image: pngUrl(page.png),
				lines: text.lines,
				items: list.items,
				itemImages: new Map(
					list.items.map((item, i) => [item.id, pngUrl(pngs[i].png)]),
				),
				fields: form.fields,
			};
			revokeAll(latest.current);
			latest.current = next;
			setRendered(next);
		})().catch((error) => {
			if (!cancelled) onError(error);
		});
		return () => {
			cancelled = true;
		};
	}, [client, index, size, zoom, renderKey, visible, onError]);

	useEffect(() => () => revokeAll(latest.current), []);

	/**
	 * New content closes any edit box (an edit landed or failed) and
	 * refreshes the selected item, which may have moved or been undone away.
	 * Keyed on the item list, not on every render, so an open box survives
	 * the page scrolling out of view and back.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the item list is the signal
	useEffect(() => {
		setDraft(null);
		if (selectedId === null || !rendered) return;
		onSelect(rendered.items.find((item) => item.id === selectedId) ?? null);
	}, [rendered?.items]);

	const origin: Point = [size.x, size.y];
	const pageRect: Rect = [
		size.x,
		size.y,
		size.x + size.width,
		size.y + size.height,
	];
	const selecting = tool === "select" && !placing;
	const editingId = draft?.kind === "item" ? draft.item.id : null;

	return (
		<div
			ref={frame}
			data-page-frame={index}
			className={`relative mx-auto bg-white shadow-[0_1px_3px_rgb(23_32_51/0.12),0_8px_24px_rgb(23_32_51/0.08)] ${selectedId !== null || draft ? "z-10" : ""}`}
			style={{ width: size.width * zoom, height: size.height * zoom }}
			onPointerDown={() => {
				if (selecting) onSelect(null);
			}}
		>
			{rendered && (
				<img
					src={rendered.image}
					alt={`Page ${index + 1}`}
					className="pointer-events-none absolute inset-0 size-full select-none"
					draggable={false}
				/>
			)}
			{!rendered && (
				<p className="absolute inset-0 grid place-items-center text-ink-soft text-sm">
					<span className="flex items-center gap-2">
						<span className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
						Loading page {index + 1}…
					</span>
				</p>
			)}

			{hits.map((rect) => (
				<span
					key={rect.join(",")}
					aria-hidden
					className={`pointer-events-none absolute rounded-[2px] mix-blend-multiply ${
						activeHit.includes(rect)
							? "bg-primary/45 outline-2 outline-primary"
							: "bg-yellow-300/60"
					}`}
					style={pageRectToBox(rect, zoom, origin)}
				/>
			))}

			{selecting &&
				rendered?.lines.map((line) => {
					if (
						!line.editable ||
						(draft?.kind === "line" && draft.line.index === line.index)
					) {
						return null;
					}
					return (
						<button
							key={`${rendered.key}-${line.index}`}
							type="button"
							aria-label={`Edit “${line.text}”`}
							title="Click to edit"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={() => {
								onSelect(null);
								setDraft({ kind: "line", line });
							}}
							className="absolute cursor-text rounded-[2px] outline-primary/70 hover:bg-primary/10 hover:outline focus-visible:outline-2"
							style={pageRectToBox(line.bbox, zoom, origin)}
						/>
					);
				})}

			{/** Above the text lines, so a field's own text fills the field. */}
			{rendered && (
				<FieldLayer
					fields={rendered.fields}
					zoom={zoom}
					origin={origin}
					interactive={selecting}
					onSetValue={(field, value) => onSetField(field.id, value)}
					onToggle={(field) => onToggleField(field.id)}
				/>
			)}

			{rendered && (
				<ItemLayer
					items={rendered.items}
					images={rendered.itemImages}
					zoom={zoom}
					origin={origin}
					pageRect={pageRect}
					interactive={selecting}
					selectedId={selectedId}
					editingId={editingId}
					onSelect={onSelect}
					onPlace={(item, bounds) => onUpdateItem(item.id, { bounds })}
					onEditText={(item) => setDraft({ kind: "item", item })}
					onStyle={(item, style) => onUpdateItem(item.id, { style })}
					onDelete={(item) => onDeleteItem(item.id)}
				/>
			)}

			{(!selecting || placing) && (
				<DrawLayer
					tool={tool}
					style={toolStyle}
					zoom={zoom}
					origin={origin}
					pageRect={pageRect}
					placing={placing}
					onCreate={(item) => onCreate(item, toolStyle)}
					onStartText={(at) => setDraft({ kind: "new", at })}
				/>
			)}

			{draft?.kind === "line" && (
				<TextEditor
					box={pageRectToBox(draft.line.bbox, zoom, origin)}
					initialText={draft.line.text}
					initialStyle={draft.line.style}
					zoom={zoom}
					multiline={false}
					opaque
					onCommit={(text, style) =>
						onReplace(
							draft.line.index,
							text,
							JSON.stringify(style) === JSON.stringify(draft.line.style)
								? undefined
								: style,
						)
					}
					onCancel={() => setDraft(null)}
				/>
			)}

			{draft?.kind === "new" &&
				(() => {
					const sizePx = toolStyle.text.size * zoom;
					const [left, top] = [
						(draft.at[0] - origin[0]) * zoom,
						(draft.at[1] - origin[1]) * zoom,
					];
					return (
						<TextEditor
							box={{
								left,
								top,
								width: sizePx * NEW_TEXT_MIN_WIDTH_EM,
								height: sizePx * TEXT_LINE_HEIGHT,
							}}
							initialText=""
							initialStyle={toolStyle.text}
							zoom={zoom}
							multiline
							opaque={false}
							onCommit={(text, style) => {
								if (text.trim() === "") return setDraft(null);
								onCreate(
									{ kind: "text", at: draft.at, text },
									{ ...toolStyle, text: style },
								);
							}}
							onCancel={() => setDraft(null)}
						/>
					);
				})()}

			{draft?.kind === "item" && (
				<TextEditor
					box={pageRectToBox(draft.item.bounds, zoom, origin)}
					initialText={draft.item.text}
					initialStyle={draft.item.style.text}
					zoom={zoom}
					multiline
					opaque={false}
					onCommit={(text, style) =>
						onUpdateItem(draft.item.id, {
							text,
							style: { ...draft.item.style, text: style },
						})
					}
					onCancel={() => setDraft(null)}
				/>
			)}

			{rendered?.lines.length === 0 &&
				rendered.fields.length === 0 &&
				selecting && (
					<p className="pointer-events-none absolute top-3 left-3 rounded-md bg-ink/80 px-2.5 py-1 text-white text-xs">
						No editable text on this page. It may be a scanned image.
					</p>
				)}
		</div>
	);
}
