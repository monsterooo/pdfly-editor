import type {
	FontFamily,
	ItemKind,
	ItemStyle,
	Rgb,
	TextStyle,
} from "./protocol";

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [1, 1, 1];

/** Swatches offered in every colour picker: ink, red, blue, green, orange, purple, gray. */
export const COLOR_SWATCHES: readonly Rgb[] = [
	BLACK,
	[0.86, 0.15, 0.15],
	[0.15, 0.39, 0.92],
	[0.09, 0.64, 0.29],
	[0.98, 0.45, 0.09],
	[0.58, 0.2, 0.92],
	[0.42, 0.45, 0.5],
];

/** Highlighter colours: yellow, green, pink, blue. */
export const HIGHLIGHT_SWATCHES: readonly Rgb[] = [
	[1, 0.92, 0.23],
	[0.53, 0.94, 0.53],
	[1, 0.6, 0.8],
	[0.55, 0.85, 1],
];

/** Font sizes in the size menu, in points. Typing any other size works too. */
export const FONT_SIZES = [
	8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48,
];
export const MIN_FONT_SIZE = 4;
export const MAX_FONT_SIZE = 144;

/** Stroke widths in the width menu, in points. */
export const STROKE_WIDTHS = [1, 2, 3, 4, 6, 8];

export const FONT_FAMILY_LABEL: Record<FontFamily, string> = {
	sans: "Sans",
	serif: "Serif",
	mono: "Mono",
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
	family: "sans",
	bold: false,
	italic: false,
	size: 12,
	color: BLACK,
};

const DEFAULT_STROKE_WIDTH = 2;

const BASE_STYLE: ItemStyle = {
	color: BLACK,
	fill: null,
	strokeWidth: DEFAULT_STROKE_WIDTH,
	opacity: 1,
	text: DEFAULT_TEXT_STYLE,
};

/**
 * Starting style per kind. The UI remembers the last style used for each
 * kind and starts from these.
 */
export const DEFAULT_ITEM_STYLE: Record<ItemKind, ItemStyle> = {
	text: BASE_STYLE,
	whiteout: { ...BASE_STYLE, color: WHITE, fill: WHITE, strokeWidth: 0 },
	rect: { ...BASE_STYLE, color: COLOR_SWATCHES[1] },
	ellipse: { ...BASE_STYLE, color: COLOR_SWATCHES[1] },
	line: { ...BASE_STYLE, color: COLOR_SWATCHES[1] },
	arrow: { ...BASE_STYLE, color: COLOR_SWATCHES[1] },
	ink: { ...BASE_STYLE, color: COLOR_SWATCHES[2] },
	/** Highlights blend with Multiply, so text stays readable at full opacity. */
	highlight: { ...BASE_STYLE, color: HIGHLIGHT_SWATCHES[0] },
	underline: { ...BASE_STYLE, color: COLOR_SWATCHES[1] },
	strikeout: { ...BASE_STYLE, color: COLOR_SWATCHES[1] },
	image: BASE_STYLE,
};

/** Which style controls a kind shows. Whiteout and images have none. */
export type StyleField = "text" | "color" | "fill" | "strokeWidth" | "opacity";

export const STYLE_FIELDS: Record<ItemKind, readonly StyleField[]> = {
	text: ["text"],
	whiteout: [],
	rect: ["color", "fill", "strokeWidth", "opacity"],
	ellipse: ["color", "fill", "strokeWidth", "opacity"],
	line: ["color", "strokeWidth", "opacity"],
	arrow: ["color", "strokeWidth", "opacity"],
	ink: ["color", "strokeWidth", "opacity"],
	highlight: ["color"],
	underline: ["color"],
	strikeout: ["color"],
	image: [],
};

/** Text markup sits on the text it marks, so it cannot be moved or resized. */
export const MARKUP_KINDS: ReadonlySet<ItemKind> = new Set([
	"highlight",
	"underline",
	"strikeout",
]);

/**
 * Kinds whose size follows their content: text boxes grow with the text,
 * markup with the marked text.
 */
export function isResizable(kind: ItemKind): boolean {
	return kind !== "text" && !MARKUP_KINDS.has(kind);
}

/** Images keep their aspect ratio when resized from a corner. */
export function keepsAspect(kind: ItemKind): boolean {
	return kind === "image";
}

const STANDARD_FAMILY: Record<
	FontFamily,
	{ regular: string; bold: string; italic: string; boldItalic: string }
> = {
	sans: {
		regular: "Helvetica",
		bold: "Helvetica-Bold",
		italic: "Helvetica-Oblique",
		boldItalic: "Helvetica-BoldOblique",
	},
	serif: {
		regular: "Times-Roman",
		bold: "Times-Bold",
		italic: "Times-Italic",
		boldItalic: "Times-BoldItalic",
	},
	mono: {
		regular: "Courier",
		bold: "Courier-Bold",
		italic: "Courier-Oblique",
		boldItalic: "Courier-BoldOblique",
	},
};

/** Base-14 font name for a style. */
export function standardFontName(style: {
	family: FontFamily;
	bold: boolean;
	italic: boolean;
}): string {
	const family = STANDARD_FAMILY[style.family];
	if (style.bold && style.italic) return family.boldItalic;
	if (style.bold) return family.bold;
	if (style.italic) return family.italic;
	return family.regular;
}

/** Inverse of standardFontName, for lines whose font was matched by name. */
export function familyOfStandardFont(name: string): FontFamily {
	if (name.startsWith("Times")) return "serif";
	if (name.startsWith("Courier")) return "mono";
	return "sans";
}

/** CSS stacks that look like the base-14 faces, for typing previews. */
export const CSS_FONT_STACK: Record<FontFamily, string> = {
	sans: "Helvetica, Arial, sans-serif",
	serif: '"Times New Roman", Times, serif',
	mono: '"Courier New", Courier, monospace',
};

/**
 * Generic family names MuPDF's HTML layout maps to its built-in faces,
 * with a CJK fallback, used for added text boxes.
 */
const RICH_FONT_FAMILY: Record<FontFamily, string> = {
	sans: "sans-serif",
	serif: "serif",
	mono: "monospace",
};

/**
 * Short names for the /DA (default appearance) of a text box. Viewers that
 * ignore rich text fall back to these.
 */
export const DA_FONT: Record<FontFamily, string> = {
	sans: "Helv",
	serif: "TiRo",
	mono: "Cour",
};

/**
 * Line spacing of added text, as a multiple of the font size. Matches the
 * layout of MuPDF's rich text so the typed preview and the result agree.
 */
export const TEXT_LINE_HEIGHT = 1.2;

const BYTE = 255;
const HEX_RADIX = 16;
const HEX_PAIR = 2;

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** [1, 0.5, 0] → "#ff8000". */
export function rgbToHex(color: Rgb): string {
	return `#${color
		.map((part) =>
			Math.round(clampUnit(part) * BYTE)
				.toString(HEX_RADIX)
				.padStart(HEX_PAIR, "0"),
		)
		.join("")}`;
}

/** "#ff8000" → [1, 0.502, 0]. Anything else is black. */
export function hexToRgb(hex: string): Rgb {
	const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) return BLACK;
	const value = match[1];
	return [0, 1, 2].map(
		(part) =>
			Number.parseInt(
				value.slice(part * HEX_PAIR, part * HEX_PAIR + HEX_PAIR),
				HEX_RADIX,
			) / BYTE,
	) as Rgb;
}

/** Same colour, compared by the hex a picker would show. */
export function sameColor(a: Rgb | null, b: Rgb | null): boolean {
	if (a === null || b === null) return a === b;
	return rgbToHex(a) === rgbToHex(b);
}

/**
 * MuPDF colour components (gray, RGB or CMYK, 0–1) as RGB. Lines report the
 * colour space they were drawn in; the format bar only speaks RGB.
 */
export function toRgb(color: readonly number[]): Rgb {
	if (color.length === 1) return [color[0], color[0], color[0]];
	if (color.length === 3) return [color[0], color[1], color[2]];
	if (color.length === 4) {
		const [c, m, y, k] = color;
		return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
	}
	return BLACK;
}

/** Text that is safe inside XHTML element content. */
export function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** A non-breaking space keeps an empty paragraph one line tall. */
const EMPTY_PARAGRAPH = "&#160;";

/**
 * XHTML rich contents (/RC) for a text box. MuPDF lays these out with its
 * HTML engine, which is what lets added text be bold or italic and fall
 * back to a CJK font per character. One paragraph per line.
 */
export function richTextXhtml(text: string, style: TextStyle): string {
	const css = [
		`font-family:${RICH_FONT_FAMILY[style.family]}`,
		`font-size:${style.size}pt`,
		`color:${rgbToHex(style.color)}`,
		`font-weight:${style.bold ? "bold" : "normal"}`,
		`font-style:${style.italic ? "italic" : "normal"}`,
		`line-height:${TEXT_LINE_HEIGHT}`,
	].join(";");
	const paragraphs = text
		.split("\n")
		.map((line) => `<p>${line === "" ? EMPTY_PARAGRAPH : escapeXml(line)}</p>`)
		.join("");
	return `<body style="${css}">${paragraphs}</body>`;
}
