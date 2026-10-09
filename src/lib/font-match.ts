/** What MuPDF can tell about the font a line was set in. */
export type FontTraits = {
	name: string;
	isBold: boolean;
	isItalic: boolean;
	isSerif: boolean;
	isMono: boolean;
};

/**
 * Built-in MuPDF font used when the matched standard font has no glyph for
 * a character. "zh-Hans" is Droid Sans Fallback: it covers CJK plus Latin,
 * Greek and Cyrillic, and is subset on save so only used glyphs ship.
 */
export const FALLBACK_FONT_NAME = "zh-Hans";

/** Standard font families, by the name prefix MuPDF's builtins use. */
const FAMILY = {
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
} as const;

/** Name hints. Subset prefixes like "ABCDEF+" do not get in the way of these. */
const BOLD_HINT = /bold|black|heavy|semibold|demi/i;
const ITALIC_HINT = /italic|oblique/i;
const SERIF_HINT =
	/times|serif|georgia|garamond|minion|cambria|book ?antiqua|palatino/i;
const SANS_HINT = /sans|arial|helvetica|verdana|calibri|segoe|roboto|inter/i;
const MONO_HINT = /courier|mono|consol|menlo/i;

/**
 * Closest standard font for a replacement run.
 * The original font is usually an embedded subset that lacks the new
 * characters, so it cannot be reused; a standard face with the same weight,
 * slant and class looks closest. Name hints win over MuPDF's flags because
 * many producers leave the flags unset.
 */
export function matchStandardFont(traits: FontTraits): string {
	const { name } = traits;
	const mono = MONO_HINT.test(name) || (traits.isMono && !SANS_HINT.test(name));
	const serif =
		!mono && !SANS_HINT.test(name) && (SERIF_HINT.test(name) || traits.isSerif);
	const family = mono ? FAMILY.mono : serif ? FAMILY.serif : FAMILY.sans;
	const bold = traits.isBold || BOLD_HINT.test(name);
	const italic = traits.isItalic || ITALIC_HINT.test(name);
	if (bold && italic) return family.boldItalic;
	if (bold) return family.bold;
	if (italic) return family.italic;
	return family.regular;
}

/** CSS stand-in for a standard font, used by the inline editor box. */
export type CssFont = {
	family: string;
	weight: number;
	style: "normal" | "italic";
};

const CSS_FAMILY = {
	Helvetica: "Helvetica, Arial, sans-serif",
	Times: '"Times New Roman", Times, serif',
	Courier: '"Courier New", Courier, monospace',
} as const;

const CSS_REGULAR_WEIGHT = 400;
const CSS_BOLD_WEIGHT = 700;

/**
 * How a line looks while it is being typed in, judged from its font name
 * alone (all the UI has). Same rules as matchStandardFont, so what you type
 * looks like what gets written.
 */
export function cssFontFor(fontName: string): CssFont {
	const standard = matchStandardFont({
		name: fontName,
		isBold: false,
		isItalic: false,
		isSerif: false,
		isMono: false,
	});
	const family = standard.startsWith("Times")
		? CSS_FAMILY.Times
		: standard.startsWith("Courier")
			? CSS_FAMILY.Courier
			: CSS_FAMILY.Helvetica;
	return {
		family,
		weight: /Bold/.test(standard) ? CSS_BOLD_WEIGHT : CSS_REGULAR_WEIGHT,
		style: /Italic|Oblique/.test(standard) ? "italic" : "normal",
	};
}

/** MuPDF colour components (gray, RGB or CMYK, 0–1) as a CSS colour. */
export function cssColor(color: readonly number[]): string {
	const BYTE = 255;
	const to = (value: number) =>
		Math.round(Math.min(1, Math.max(0, value)) * BYTE);
	if (color.length === 1) {
		const gray = to(color[0]);
		return `rgb(${gray} ${gray} ${gray})`;
	}
	if (color.length === 3)
		return `rgb(${to(color[0])} ${to(color[1])} ${to(color[2])})`;
	if (color.length === 4) {
		const [c, m, y, k] = color;
		return `rgb(${to((1 - c) * (1 - k))} ${to((1 - m) * (1 - k))} ${to((1 - y) * (1 - k))})`;
	}
	return "rgb(0 0 0)";
}
