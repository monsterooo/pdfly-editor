import { MAX_EDIT_MB } from "./files";
import type { EditorErrorCode } from "./protocol";

export const NOT_PDF_MESSAGE = "Choose a PDF file.";
export const TOO_LARGE_MESSAGE = `This PDF is over ${MAX_EDIT_MB} MB. Choose a smaller file.`;

/** Visitor wording for each engine code. */
export function errorMessage(code: EditorErrorCode, detail?: string): string {
	switch (code) {
		case "not_pdf":
			return "This file could not be opened as a PDF.";
		case "encrypted":
			return "This PDF is password protected. Remove the password and try again.";
		case "unsupported_character":
			return detail
				? `The character “${detail}” isn't supported yet.`
				: "That text has a character that isn't supported yet.";
		case "no_line":
			return "That line can't be edited.";
		case "pending_redactions":
			return "This page has redactions that haven't been applied. Apply them in your PDF app first.";
		case "nothing_to_undo":
			return "Nothing to undo.";
		case "internal":
			return "Something went wrong. Reload the page and try again.";
	}
}
