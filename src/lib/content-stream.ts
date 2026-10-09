import { type Matrix, pdfNumber } from "./geometry";

/** Glyph ids for an Identity-H font are two bytes each. */
const HEX_DIGITS_PER_GLYPH = 4;
const HEX_RADIX = 16;

/** Colour component counts MuPDF reports: gray, RGB, CMYK. */
const GRAY_COMPONENTS = 1;
const RGB_COMPONENTS = 3;
const CMYK_COMPONENTS = 4;

/** Glyph ids to a hex string operand for Tj. */
export function glyphHex(glyphs: readonly number[]): string {
	return glyphs
		.map((gid) => gid.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_GLYPH, "0"))
		.join("");
}

/**
 * Fill colour operator for the colour MuPDF reported, so a red heading stays
 * red. Unknown shapes fall back to black rather than writing a bad operator.
 */
export function fillColorOperator(color: readonly number[]): string {
	const parts = color.map(pdfNumber).join(" ");
	if (color.length === GRAY_COMPONENTS) return `${parts} g`;
	if (color.length === RGB_COMPONENTS) return `${parts} rg`;
	if (color.length === CMYK_COMPONENTS) return `${parts} k`;
	return "0 g";
}

export type TextRun = {
	/** Resource name in the page's /Font dictionary, without the slash. */
	fontResource: string;
	size: number;
	color: readonly number[];
	/** Text matrix in page space (y-down), see textMatrix(). */
	matrix: Matrix;
	glyphs: readonly number[];
};

/**
 * Operators that draw one run, wrapped in q/Q so nothing leaks into later
 * content. `cm` maps page space back to PDF user space, so callers work in
 * the same coordinates MuPDF's structured text reports, whatever the page
 * rotation or MediaBox offset.
 */
export function textRunOperators(run: TextRun, pageToUser: Matrix): string {
	const cm = pageToUser.map(pdfNumber).join(" ");
	const tm = run.matrix.map(pdfNumber).join(" ");
	return [
		"q",
		`${cm} cm`,
		"BT",
		`/${run.fontResource} ${pdfNumber(run.size)} Tf`,
		fillColorOperator(run.color),
		`${tm} Tm`,
		`<${glyphHex(run.glyphs)}> Tj`,
		"ET",
		"Q",
	].join("\n");
}

/** Font resource names are PDF names: keep them to safe characters. */
export function fontResourceName(fontName: string): string {
	return `Pdfly${fontName.replace(/[^A-Za-z0-9]/g, "")}`;
}
