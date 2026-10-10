import { useLayoutEffect, useRef, useState } from "react";

import { type Box, type Point, pageRectToBox } from "../lib/geometry";
import type { FormField } from "../lib/protocol";

/**
 * Font size of a single-line field's input as a share of its height. Field
 * fonts are often "auto" (size 0 in the PDF), which viewers fit to the box
 * the same way; MuPDF draws the real appearance once the value lands.
 */
const SINGLE_LINE_FONT_RATIO = 0.65;
/** Multi-line fields use a fixed size, in points, like most viewers. */
const MULTILINE_FONT_PT = 12;

type FieldLayerProps = {
	fields: readonly FormField[];
	zoom: number;
	origin: Point;
	/** Only the select tool fills fields; drawing tools pass through. */
	interactive: boolean;
	onSetValue: (field: FormField, value: string) => void;
	onToggle: (field: FormField) => void;
};

/** Fields you type into; Tab steps through these. */
function isTyped(field: FormField) {
	return field.kind === "text" && !field.readOnly;
}

/**
 * Click targets over a page's form fields. MuPDF keeps drawing the fields,
 * so what you see matches the downloaded file; this layer only takes input.
 * Text fields open an input in place, checkboxes and radio buttons toggle
 * on click, and combo and list boxes are an invisible native select laid
 * over the field so one click opens the choices.
 */
export function FieldLayer({
	fields,
	zoom,
	origin,
	interactive,
	onSetValue,
	onToggle,
}: FieldLayerProps) {
	const [editingId, setEditingId] = useState<number | null>(null);
	if (!interactive) return null;

	const typed = fields.filter(isTyped);
	/** Tab and Shift+Tab move to the next and previous text field on the page. */
	function step(from: FormField, direction: 1 | -1) {
		const index = typed.findIndex((field) => field.id === from.id);
		const next = typed[index + direction];
		setEditingId(next ? next.id : null);
	}

	return fields.map((field) => {
		if (field.readOnly) return null;
		const box = pageRectToBox(field.bounds, zoom, origin);
		const key = field.id;

		if (field.kind === "text" && editingId === field.id) {
			return (
				<FieldInput
					key={key}
					field={field}
					box={box}
					zoom={zoom}
					onCommit={(value) => {
						if (value !== field.value) onSetValue(field, value);
					}}
					onStep={(direction) => step(field, direction)}
					onClose={() =>
						setEditingId((current) => (current === field.id ? null : current))
					}
				/>
			);
		}

		if (field.kind === "combo" || field.kind === "list") {
			return (
				<select
					key={key}
					aria-label={field.label}
					title={field.label}
					value={field.value}
					onPointerDown={(event) => event.stopPropagation()}
					onChange={(event) => onSetValue(field, event.target.value)}
					className="absolute cursor-pointer rounded-[2px] opacity-0 outline-primary/70 hover:opacity-100 hover:outline focus-visible:opacity-100 focus-visible:outline-2"
					style={{ ...box, fontSize: box.height * SINGLE_LINE_FONT_RATIO }}
				>
					{/** A value outside the choices (or none) still needs an entry to show. */}
					{!field.options.some((option) => option.value === field.value) && (
						<option value={field.value}>{field.value}</option>
					)}
					{field.options.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			);
		}

		const toggles = field.kind === "checkbox" || field.kind === "radio";
		return (
			<button
				key={key}
				type="button"
				role={toggles ? field.kind : undefined}
				aria-checked={toggles ? field.checked : undefined}
				aria-label={field.label}
				title={field.label}
				onPointerDown={(event) => event.stopPropagation()}
				onClick={() => (toggles ? onToggle(field) : setEditingId(field.id))}
				className={`absolute rounded-[2px] bg-primary/5 outline-primary/70 hover:bg-primary/10 hover:outline focus-visible:outline-2 ${toggles ? "cursor-pointer" : "cursor-text"}`}
				style={box}
			/>
		);
	});
}

type FieldInputProps = {
	field: FormField;
	box: Box;
	zoom: number;
	onCommit: (value: string) => void;
	onStep: (direction: 1 | -1) => void;
	onClose: () => void;
};

/**
 * Typing into one text field. Covers the field so its old appearance is
 * hidden while typing. Enter (⌘/Ctrl+Enter when multi-line) and leaving
 * the field commit, Tab commits and moves on, Escape cancels.
 */
function FieldInput({
	field,
	box,
	zoom,
	onCommit,
	onStep,
	onClose,
}: FieldInputProps) {
	const [value, setValue] = useState(field.value);
	const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
	const done = useRef(false);

	useLayoutEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);

	function finish(commit: boolean) {
		if (done.current) return;
		done.current = true;
		if (commit) onCommit(value);
		onClose();
	}

	const shared = {
		ref: input,
		value,
		"aria-label": field.label,
		maxLength: field.maxLength > 0 ? field.maxLength : undefined,
		spellCheck: false,
		onChange: (
			event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
		) => setValue(event.target.value),
		onBlur: () => finish(true),
		onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
		onKeyDown: (event: React.KeyboardEvent) => {
			event.stopPropagation();
			if (event.key === "Escape") return finish(false);
			if (event.key === "Tab") {
				event.preventDefault();
				finish(true);
				return onStep(event.shiftKey ? -1 : 1);
			}
			const submit =
				event.key === "Enter" &&
				(!field.multiline || event.metaKey || event.ctrlKey);
			if (submit) {
				event.preventDefault();
				finish(true);
			}
		},
		className:
			"absolute z-30 rounded-[2px] border-0 bg-white px-1 py-0 text-ink outline-2 outline-primary",
		style: {
			...box,
			fontSize: field.multiline
				? MULTILINE_FONT_PT * zoom
				: box.height * SINGLE_LINE_FONT_RATIO,
		},
	};

	return field.multiline ? (
		<textarea {...shared} className={`${shared.className} resize-none`} />
	) : (
		<input type="text" {...shared} />
	);
}
