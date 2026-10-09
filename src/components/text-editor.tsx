import { Check } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import type { Box } from "../lib/geometry";
import { CSS_FONT_STACK, rgbToHex, TEXT_LINE_HEIGHT } from "../lib/item-style";
import type { TextStyle } from "../lib/protocol";
import { TextFormatControls } from "./style-controls";
import { IconButton, Panel } from "./ui";

/** Room after the last character so the caret is never clipped. */
const CARET_ROOM_PX = 8;
/** Height the format bar needs above the box; below that it flips under. */
const BAR_ROOM_PX = 52;
const CSS_REGULAR_WEIGHT = 400;
const CSS_BOLD_WEIGHT = 700;

type TextEditorProps = {
	/** Where the text starts, in frame pixels. Width and height are minimums. */
	box: Box;
	initialText: string;
	initialStyle: TextStyle;
	zoom: number;
	/** Text boxes take several lines; a replaced PDF line takes one. */
	multiline: boolean;
	/** Cover what is underneath, so the original line is hidden while typing. */
	opaque: boolean;
	onCommit: (text: string, style: TextStyle) => void;
	onCancel: () => void;
};

function cssFont(style: TextStyle, sizePx: number) {
	return `${style.italic ? "italic" : "normal"} ${style.bold ? CSS_BOLD_WEIGHT : CSS_REGULAR_WEIGHT} ${sizePx}px ${CSS_FONT_STACK[style.family]}`;
}

/**
 * Inline text editing with a format bar above it, like the text tools of
 * desktop PDF editors. The box grows with the text in the chosen style.
 * Enter commits a single line (⌘/Ctrl+Enter for text boxes), Escape
 * cancels, and moving focus anywhere outside the box and its bar commits.
 */
export function TextEditor({
	box,
	initialText,
	initialStyle,
	zoom,
	multiline,
	opaque,
	onCommit,
	onCancel,
}: TextEditorProps) {
	const [text, setText] = useState(initialText);
	const [style, setStyle] = useState(initialStyle);
	const [size, setSize] = useState({ width: box.width, height: box.height });
	const field = useRef<HTMLTextAreaElement>(null);
	const done = useRef(false);

	const fontPx = style.size * zoom;
	/** A replaced line keeps its own box height, scaled with the font size. */
	const lineBoxPx = multiline
		? fontPx * TEXT_LINE_HEIGHT
		: box.height * (style.size / initialStyle.size);

	useLayoutEffect(() => {
		field.current?.focus();
		field.current?.select();
	}, []);

	/** Measure with the same font so the box hugs the text. */
	useLayoutEffect(() => {
		const context = document.createElement("canvas").getContext("2d");
		if (!context) return;
		context.font = cssFont(style, fontPx);
		const lines = text.split("\n");
		const widest = Math.max(
			...lines.map((line) => context.measureText(line).width),
		);
		setSize({
			width: Math.max(box.width, widest + CARET_ROOM_PX),
			height: Math.max(box.height, lines.length * lineBoxPx),
		});
	}, [text, style, fontPx, lineBoxPx, box.width, box.height]);

	function finish(commit: boolean) {
		if (done.current) return;
		done.current = true;
		const changed =
			text !== initialText ||
			JSON.stringify(style) !== JSON.stringify(initialStyle);
		if (commit && changed) onCommit(text, style);
		else onCancel();
	}

	const barBelow = box.top < BAR_ROOM_PX;

	return (
		<div
			className="absolute z-30"
			style={{ left: box.left, top: box.top }}
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null))
					finish(true);
			}}
		>
			<Panel
				className={`absolute left-0 flex w-max items-center gap-1 p-1 ${barBelow ? "top-full mt-2" : "bottom-full mb-2"}`}
			>
				{/**
				 * Buttons keep focus in the text field so typing can go on; the
				 * selects take focus, which is fine because they are inside.
				 */}
				<div
					role="toolbar"
					aria-label="Text format"
					className="flex items-center gap-1"
					onMouseDown={(event) => {
						if (!(event.target as HTMLElement).closest("select,input"))
							event.preventDefault();
					}}
				>
					<TextFormatControls style={style} onChange={setStyle} />
					<span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
					<IconButton
						icon={Check}
						label="Done"
						size="sm"
						onClick={() => finish(true)}
					/>
				</div>
			</Panel>
			<textarea
				ref={field}
				value={text}
				aria-label={multiline ? "Text box" : "Edit text"}
				rows={1}
				wrap="off"
				spellCheck={false}
				onChange={(event) =>
					setText(
						multiline
							? event.target.value
							: event.target.value.replace(/\n/g, " "),
					)
				}
				onKeyDown={(event) => {
					event.stopPropagation();
					const submit =
						event.key === "Enter" &&
						(!multiline || event.metaKey || event.ctrlKey);
					if (submit) {
						event.preventDefault();
						finish(true);
					}
					if (event.key === "Escape") finish(false);
				}}
				className={`block resize-none overflow-hidden whitespace-pre rounded-[2px] border-0 p-0 outline-2 outline-primary outline-offset-2 ${opaque ? "bg-white" : "bg-transparent"}`}
				style={{
					width: size.width,
					height: size.height,
					fontSize: fontPx,
					lineHeight: `${lineBoxPx}px`,
					fontFamily: CSS_FONT_STACK[style.family],
					fontWeight: style.bold ? CSS_BOLD_WEIGHT : CSS_REGULAR_WEIGHT,
					fontStyle: style.italic ? "italic" : "normal",
					color: rgbToHex(style.color),
				}}
			/>
		</div>
	);
}
