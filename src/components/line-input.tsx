import { useLayoutEffect, useRef, useState } from "react";

import type { Box } from "../lib/geometry";

/** Room after the last character so the caret is never clipped. */
const CARET_ROOM_PX = 8;

type LineInputProps = {
	box: Box;
	initial: string;
	fontSizePx: number;
	fontFamily: string;
	fontWeight: number;
	fontStyle: "normal" | "italic";
	color: string;
	onCommit: (text: string) => void;
	onCancel: () => void;
};

/**
 * One-line text box laid over the line being edited.
 * The white background hides the rendered original while typing, and the
 * box widens with the text. Enter or leaving the box commits; Escape, or
 * leaving it unchanged, cancels.
 */
export function LineInput({
	box,
	initial,
	fontSizePx,
	fontFamily,
	fontWeight,
	fontStyle,
	color,
	onCommit,
	onCancel,
}: LineInputProps) {
	const [text, setText] = useState(initial);
	const [width, setWidth] = useState(box.width);
	const input = useRef<HTMLInputElement>(null);
	const done = useRef(false);

	useLayoutEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);

	/** Measure with the same font so the box hugs the text. */
	useLayoutEffect(() => {
		const context = document.createElement("canvas").getContext("2d");
		if (!context) return;
		context.font = `${fontStyle} ${fontWeight} ${fontSizePx}px ${fontFamily}`;
		setWidth(
			Math.max(box.width, context.measureText(text).width + CARET_ROOM_PX),
		);
	}, [text, box.width, fontFamily, fontSizePx, fontStyle, fontWeight]);

	function finish(commit: boolean) {
		if (done.current) return;
		done.current = true;
		if (commit && text !== initial) onCommit(text);
		else onCancel();
	}

	return (
		<input
			ref={input}
			value={text}
			aria-label="Edit text"
			onChange={(event) => setText(event.target.value)}
			onKeyDown={(event) => {
				if (event.key === "Enter") finish(true);
				if (event.key === "Escape") finish(false);
			}}
			onBlur={() => finish(true)}
			className="absolute z-10 m-0 rounded-[2px] border-0 bg-white p-0 leading-none outline-2 outline-primary"
			style={{
				left: box.left,
				top: box.top,
				width,
				height: box.height,
				fontSize: fontSizePx,
				fontFamily,
				fontWeight,
				fontStyle,
				color,
			}}
		/>
	);
}
