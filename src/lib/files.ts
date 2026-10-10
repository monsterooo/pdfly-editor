const BYTES_PER_MB = 1024 * 1024;

/**
 * Largest PDF the editor opens. Everything runs in the visitor's tab, and
 * MuPDF holds the whole file plus its parsed objects in WASM memory.
 */
export const MAX_EDIT_MB = 50;
export const MAX_EDIT_BYTES = MAX_EDIT_MB * BYTES_PER_MB;

/** By type, or by name when the browser leaves the type empty. */
export function isPdfFile(file: { type: string; name: string }): boolean {
	return (
		file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
	);
}

/** "report.pdf" + "-edited" → "report-edited.pdf", so the original is never overwritten. */
function suffixedFileName(name: string, suffix: string): string {
	const base = name.replace(/\.pdf$/i, "") || "document";
	return `${base}${suffix}.pdf`;
}

export function editedFileName(name: string): string {
	return suffixedFileName(name, "-edited");
}

/** The whole reorganized PDF. */
export function organizedFileName(name: string): string {
	return suffixedFileName(name, "-organized");
}

/** Only the pages picked for extraction. */
export function extractedFileName(name: string): string {
	return suffixedFileName(name, "-pages");
}
