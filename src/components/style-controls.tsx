import { Ban, Bold, Italic } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
	COLOR_SWATCHES,
	FONT_FAMILY_LABEL,
	FONT_SIZES,
	hexToRgb,
	MAX_FONT_SIZE,
	MIN_FONT_SIZE,
	rgbToHex,
	STROKE_WIDTHS,
	sameColor,
} from "../lib/item-style";
import type { FontFamily, Rgb, TextStyle } from "../lib/protocol";
import { IconButton, Panel } from "./ui";

const SELECT_CLASS =
	"h-8 rounded-lg border border-line bg-white px-2 text-ink text-sm hover:border-line-strong focus-visible:outline-2 focus-visible:outline-primary";

const PERCENT = 100;
/** Opacity steps offered for shapes and drawings. */
const OPACITY_STEPS = [1, 0.75, 0.5, 0.25];

type ColorPickerProps = {
	label: string;
	value: Rgb | null;
	onChange: (color: Rgb | null) => void;
	swatches?: readonly Rgb[];
	/** Offer "no colour", for fills. */
	allowNone?: boolean;
};

/**
 * Swatch button that opens a small palette, with a native picker for any
 * other colour. Closes on a pick or a click elsewhere.
 */
export function ColorPicker({
	label,
	value,
	onChange,
	swatches = COLOR_SWATCHES,
	allowNone = false,
}: ColorPickerProps) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const close = (event: PointerEvent) => {
			if (!root.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", close);
		return () => document.removeEventListener("pointerdown", close);
	}, [open]);

	const pick = (color: Rgb | null) => {
		onChange(color);
		setOpen(false);
	};

	return (
		<div ref={root} className="relative">
			<button
				type="button"
				aria-label={label}
				title={label}
				aria-expanded={open}
				onClick={() => setOpen((on) => !on)}
				className="grid size-8 place-items-center rounded-lg hover:bg-ground focus-visible:outline-2 focus-visible:outline-primary"
			>
				<Swatch color={value} />
			</button>
			{open && (
				<Panel className="absolute top-full left-0 z-40 mt-1.5 w-max p-2">
					<div className="grid grid-cols-4 gap-1.5">
						{allowNone && (
							<button
								type="button"
								aria-label="No fill"
								title="No fill"
								onClick={() => pick(null)}
								className={swatchButtonClass(value === null)}
							>
								<Swatch color={null} />
							</button>
						)}
						{swatches.map((color) => (
							<button
								key={rgbToHex(color)}
								type="button"
								aria-label={rgbToHex(color)}
								title={rgbToHex(color)}
								onClick={() => pick(color)}
								className={swatchButtonClass(sameColor(color, value))}
							>
								<Swatch color={color} />
							</button>
						))}
					</div>
					<label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-1 text-ink-soft text-xs hover:text-ink">
						Custom
						<input
							type="color"
							value={value ? rgbToHex(value) : "#000000"}
							onChange={(event) => onChange(hexToRgb(event.target.value))}
							className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
						/>
					</label>
				</Panel>
			)}
		</div>
	);
}

function swatchButtonClass(selected: boolean) {
	return `grid size-8 place-items-center rounded-md ${
		selected ? "ring-2 ring-primary" : "hover:bg-ground"
	}`;
}

/** A colour dot; "none" shows a struck-out dot. */
function Swatch({ color }: { color: Rgb | null }) {
	if (color === null) {
		return (
			<Ban size={18} className="text-ink-soft" strokeWidth={1.8} aria-hidden />
		);
	}
	return (
		<span
			aria-hidden
			className="block size-5 rounded-full border border-ink/15"
			style={{ background: rgbToHex(color) }}
		/>
	);
}

/** Font, size, bold, italic and colour for text. */
export function TextFormatControls({
	style,
	onChange,
}: {
	style: TextStyle;
	onChange: (style: TextStyle) => void;
}) {
	const sizes = FONT_SIZES.includes(style.size)
		? FONT_SIZES
		: [...FONT_SIZES, style.size].sort((a, b) => a - b);
	return (
		<>
			<select
				aria-label="Font"
				value={style.family}
				onChange={(event) =>
					onChange({ ...style, family: event.target.value as FontFamily })
				}
				className={SELECT_CLASS}
			>
				{(Object.keys(FONT_FAMILY_LABEL) as FontFamily[]).map((family) => (
					<option key={family} value={family}>
						{FONT_FAMILY_LABEL[family]}
					</option>
				))}
			</select>
			<select
				aria-label="Font size"
				value={style.size}
				onChange={(event) => {
					const size = Number(event.target.value);
					onChange({
						...style,
						size: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size)),
					});
				}}
				className={`${SELECT_CLASS} w-[4.5rem] tabular-nums`}
			>
				{sizes.map((size) => (
					<option key={size} value={size}>
						{Number(size.toFixed(1))} pt
					</option>
				))}
			</select>
			<IconButton
				icon={Bold}
				label="Bold"
				size="sm"
				active={style.bold}
				aria-pressed={style.bold}
				onClick={() => onChange({ ...style, bold: !style.bold })}
			/>
			<IconButton
				icon={Italic}
				label="Italic"
				size="sm"
				active={style.italic}
				aria-pressed={style.italic}
				onClick={() => onChange({ ...style, italic: !style.italic })}
			/>
			<ColorPicker
				label="Text colour"
				value={style.color}
				onChange={(color) => color && onChange({ ...style, color })}
			/>
		</>
	);
}

export function StrokeWidthSelect({
	value,
	onChange,
}: {
	value: number;
	onChange: (width: number) => void;
}) {
	return (
		<select
			aria-label="Line width"
			title="Line width"
			value={value}
			onChange={(event) => onChange(Number(event.target.value))}
			className={SELECT_CLASS}
		>
			{STROKE_WIDTHS.map((width) => (
				<option key={width} value={width}>
					{width} pt
				</option>
			))}
		</select>
	);
}

export function OpacitySelect({
	value,
	onChange,
}: {
	value: number;
	onChange: (opacity: number) => void;
}) {
	return (
		<select
			aria-label="Opacity"
			title="Opacity"
			value={value}
			onChange={(event) => onChange(Number(event.target.value))}
			className={SELECT_CLASS}
		>
			{OPACITY_STEPS.map((step) => (
				<option key={step} value={step}>
					{Math.round(step * PERCENT)}%
				</option>
			))}
		</select>
	);
}
