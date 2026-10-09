import { useEffect, useRef, useState } from "react";

import type { EditorClient } from "../lib/editor-client";
import { cssColor, cssFontFor } from "../lib/font-match";
import { type Box, type Point, type Rect, rectToBox } from "../lib/geometry";
import { NEW_TEXT_SIZE, type PageSize, type TextLine } from "../lib/protocol";
import { LineInput } from "./line-input";

/** Start rendering a page this far before it scrolls into view. */
const PRELOAD_MARGIN = "800px";

/**
 * Upper bound on device pixels per CSS pixel when rendering. Retina is
 * sharp at 2; going higher multiplies WASM memory for little gain.
 */
const MAX_PIXEL_RATIO = 2;

/**
 * Where the baseline sits inside a new text box, as a share of the font
 * size from its top. Matches Helvetica's ascent closely enough that the
 * written text lands where the typed text was.
 */
const NEW_TEXT_BASELINE_RATIO = 0.8;
/** Height of a new text box relative to its font size. */
const NEW_TEXT_BOX_RATIO = 1.2;
/** Width of an empty new text box, in font sizes. */
const NEW_TEXT_MIN_WIDTH_RATIO = 8;

type Draft = { kind: "line"; line: TextLine } | { kind: "new"; at: Point };

type EditorPageProps = {
	client: EditorClient;
	index: number;
	size: PageSize;
	zoom: number;
	/** Bumped after every change to this page; re-renders it. */
	version: number;
	adding: boolean;
	onReplace: (line: number, text: string) => void;
	onAdd: (origin: Point, text: string) => void;
	onError: (error: unknown) => void;
};

/**
 * One page: the MuPDF render as an image, with a clickable box over each
 * line of text. Renders only when near the viewport, and keeps the previous
 * image on screen while a new one is on its way so edits do not flash.
 */
export function EditorPage({
	client,
	index,
	size,
	zoom,
	version,
	adding,
	onReplace,
	onAdd,
	onError,
}: EditorPageProps) {
	const frame = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const [image, setImage] = useState<string | null>(null);
	const [lines, setLines] = useState<TextLine[] | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	/** zoom@version of the image on screen, so scrolling back does not re-render it. */
	const renderedKey = useRef<string | null>(null);

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
		const key = `${zoom}@${version}`;
		if (!visible || renderedKey.current === key) return;
		let cancelled = false;
		const scale =
			zoom * Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
		Promise.all([
			client.request({ type: "render", page: index, scale }),
			client.request({ type: "lines", page: index }),
		])
			.then(([render, text]) => {
				if (cancelled) return;
				const url = URL.createObjectURL(
					new Blob([render.png as BlobPart], { type: "image/png" }),
				);
				setImage((previous) => {
					if (previous) URL.revokeObjectURL(previous);
					return url;
				});
				setLines(text.lines);
				renderedKey.current = key;
			})
			.catch((error) => {
				if (!cancelled) onError(error);
			});
		return () => {
			cancelled = true;
		};
	}, [client, index, zoom, version, visible, onError]);

	/**
	 * A new version means an edit landed (or failed): close the edit box.
	 * Only on version, not on every render, so an open box survives the page
	 * scrolling out of view and back.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: version is the signal
	useEffect(() => setDraft(null), [version]);

	useEffect(
		() => () => {
			if (image) URL.revokeObjectURL(image);
		},
		[image],
	);

	/** Page-space rectangle to a box inside this page's frame. */
	const toBox = (rect: Rect): Box =>
		rectToBox(
			[rect[0] - size.x, rect[1] - size.y, rect[2] - size.x, rect[3] - size.y],
			zoom,
		);

	const newTextPx = NEW_TEXT_SIZE * zoom;

	return (
		<div
			ref={frame}
			className={`relative mx-auto bg-white shadow-[0_1px_3px_rgb(23_32_51/0.12),0_8px_24px_rgb(23_32_51/0.08)] ${adding ? "cursor-text" : ""}`}
			style={{ width: size.width * zoom, height: size.height * zoom }}
			onClick={(event) => {
				if (!adding || draft || event.target !== event.currentTarget) return;
				const bounds = event.currentTarget.getBoundingClientRect();
				setDraft({
					kind: "new",
					at: [event.clientX - bounds.left, event.clientY - bounds.top],
				});
			}}
			role="presentation"
		>
			{image && (
				<img
					src={image}
					alt={`Page ${index + 1}`}
					className="pointer-events-none absolute inset-0 size-full select-none"
					draggable={false}
				/>
			)}
			{!image && (
				<p className="absolute inset-0 grid place-items-center text-ink-soft text-sm">
					Loading page {index + 1}…
				</p>
			)}

			{!adding &&
				lines?.map((line) => {
					if (
						!line.editable ||
						(draft?.kind === "line" && draft.line.index === line.index)
					) {
						return null;
					}
					const box = toBox(line.bbox);
					return (
						<button
							key={`${version}-${line.index}`}
							type="button"
							aria-label={`Edit “${line.text}”`}
							title="Click to edit"
							onClick={() => setDraft({ kind: "line", line })}
							className="absolute cursor-text rounded-[2px] outline-primary/70 hover:bg-primary/10 hover:outline focus-visible:outline-2"
							style={box}
						/>
					);
				})}

			{draft?.kind === "line" && (
				<LineInput
					box={toBox(draft.line.bbox)}
					initial={draft.line.text}
					fontSizePx={draft.line.size * zoom}
					{...cssFontProps(draft.line.fontName)}
					color={cssColor(draft.line.color)}
					onCommit={(text) => onReplace(draft.line.index, text)}
					onCancel={() => setDraft(null)}
				/>
			)}

			{draft?.kind === "new" && (
				<LineInput
					box={{
						left: draft.at[0],
						top: draft.at[1],
						width: newTextPx * NEW_TEXT_MIN_WIDTH_RATIO,
						height: newTextPx * NEW_TEXT_BOX_RATIO,
					}}
					initial=""
					fontSizePx={newTextPx}
					{...cssFontProps("Helvetica")}
					color="rgb(0 0 0)"
					onCommit={(text) =>
						onAdd(
							[
								draft.at[0] / zoom + size.x,
								draft.at[1] / zoom +
									size.y +
									NEW_TEXT_SIZE * NEW_TEXT_BASELINE_RATIO,
							],
							text,
						)
					}
					onCancel={() => setDraft(null)}
				/>
			)}

			{lines?.length === 0 && (
				<p className="absolute top-3 left-3 rounded-md bg-ink/80 px-2.5 py-1 text-white text-xs">
					No editable text on this page. It may be a scanned image.
				</p>
			)}
		</div>
	);
}

function cssFontProps(fontName: string) {
	const font = cssFontFor(fontName);
	return {
		fontFamily: font.family,
		fontWeight: font.weight,
		fontStyle: font.style,
	};
}
