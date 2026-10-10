import type * as mupdf from "mupdf";

import type { Rect } from "../lib/geometry";
import type { FormField, FormFieldKind } from "../lib/protocol";

/** Appearance state of a checkbox or radio button that is not ticked. */
export const OFF_STATE = "Off";

/** Fillable kind of a widget; push buttons and signatures are not fillable. */
export function fieldKind(widget: mupdf.PDFWidget): FormFieldKind | null {
	if (widget.isPushButton()) return null;
	if (widget.isCheckbox()) return "checkbox";
	if (widget.isRadioButton()) return "radio";
	if (widget.isText()) return "text";
	if (widget.isComboBox()) return "combo";
	if (widget.isListBox()) return "list";
	return null;
}

/** Identity of a widget that survives reloading the page and undo. */
export function fieldId(widget: mupdf.PDFWidget): number {
	return widget.getObject().asIndirect();
}

/**
 * Whether this one widget is on. The field value is shared by a whole radio
 * group, so it is read from the widget's own appearance state instead.
 */
function isChecked(widget: mupdf.PDFWidget): boolean {
	const state = widget.getObject().get("AS");
	return state.isName() && state.asName() !== OFF_STATE;
}

export function toFormField(widget: mupdf.PDFWidget): FormField | null {
	const kind = fieldKind(widget);
	if (!kind) return null;
	const choice = kind === "combo" || kind === "list";
	const values = choice ? widget.getOptions(true) : [];
	const labels = choice ? widget.getOptions(false) : [];
	return {
		id: fieldId(widget),
		kind,
		name: widget.getName(),
		label: widget.getLabel() || widget.getName(),
		bounds: [...widget.getBounds()] as Rect,
		value: widget.getValue(),
		checked:
			kind === "checkbox" || kind === "radio" ? isChecked(widget) : false,
		options: values.map((value, index) => ({
			value,
			label: labels[index] || value,
		})),
		multiline: kind === "text" && widget.isMultiline(),
		maxLength: kind === "text" ? widget.getMaxLen() : 0,
		readOnly: widget.isReadOnly(),
	};
}

/** Fillable fields of a page, in the page's widget order (its tab order). */
export function pageFields(page: mupdf.PDFPage): FormField[] {
	return page.getWidgets().flatMap((widget) => {
		const field = toFormField(widget);
		return field ? [field] : [];
	});
}

export function findWidget(
	page: mupdf.PDFPage,
	id: number,
): mupdf.PDFWidget | undefined {
	return page.getWidgets().find((widget) => fieldId(widget) === id);
}
