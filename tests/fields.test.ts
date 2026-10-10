import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as mupdf from "mupdf";

import type { FormField } from "../src/lib/protocol";
import { EditorEngine, EngineError } from "../src/worker/engine";
import { linesOf, makeFormPdf, makePdf } from "./fixtures";

const BOX: [number, number, number, number] = [300, 300, 400, 340];

function byName(engine: EditorEngine, name: string): FormField[] {
	return engine.fields(0).filter((field) => field.name === name);
}

function one(engine: EditorEngine, name: string): FormField {
	const [field] = byName(engine, name);
	assert.ok(field, `no field ${name}`);
	return field;
}

function refusedWith(code: string) {
	return (error: unknown) =>
		error instanceof EngineError && error.code === code;
}

describe("EditorEngine form fields", () => {
	test("lists fillable fields with their kind, value and choices", () => {
		const engine = EditorEngine.open(makeFormPdf());
		const fields = engine.fields(0);
		assert.deepEqual(
			fields.map((field) => [field.name, field.kind]),
			[
				["name", "text"],
				["agree", "checkbox"],
				["size", "radio"],
				["size", "radio"],
				["color", "combo"],
				["id", "text"],
			],
		);
		assert.equal(one(engine, "name").label, "Full name");
		assert.equal(one(engine, "name").value, "Jane");
		assert.deepEqual(one(engine, "color").options, [
			{ value: "r", label: "Red" },
			{ value: "g", label: "Green" },
		]);
		assert.equal(one(engine, "id").readOnly, true);
		assert.deepEqual(engine.formSummary(), { fields: 6, xfaOnly: false });
	});

	test("reports no fields for a plain PDF", () => {
		const engine = EditorEngine.open(makePdf("BT ET"));
		assert.deepEqual(engine.fields(0), []);
		assert.deepEqual(engine.formSummary(), { fields: 0, xfaOnly: false });
	});

	test("flags an XFA form that has no AcroForm widgets", () => {
		const doc = new mupdf.PDFDocument(makePdf("BT ET"));
		doc
			.getTrailer()
			.get("Root")
			.put(
				"AcroForm",
				doc.addObject({ Fields: [], XFA: doc.addStream("<xdp/>", {}) }),
			);
		const engine = EditorEngine.open(
			doc.saveToBuffer("").asUint8Array().slice(),
		);
		assert.deepEqual(engine.formSummary(), { fields: 0, xfaOnly: true });
	});

	test("fills a text field as one undoable step", () => {
		const engine = EditorEngine.open(makeFormPdf());
		const { id } = one(engine, "name");

		const result = engine.setField(0, id, "Bob Smith");
		assert.equal(result.history.canUndo, true);
		assert.equal(one(engine, "name").value, "Bob Smith");

		engine.undo();
		assert.equal(one(engine, "name").value, "Jane");
		engine.redo();
		assert.equal(one(engine, "name").value, "Bob Smith");
	});

	test("picks a combo box choice by export value", () => {
		const engine = EditorEngine.open(makeFormPdf());
		const { id } = one(engine, "color");
		engine.setField(0, id, "g");
		assert.equal(one(engine, "color").value, "g");
		assert.throws(
			() => engine.setField(0, id, "Blue"),
			refusedWith("invalid_option"),
		);
		assert.equal(one(engine, "color").value, "g");
	});

	test("ticks a checkbox and switches a radio group to one button", () => {
		const engine = EditorEngine.open(makeFormPdf());
		engine.toggleField(0, one(engine, "agree").id);
		assert.equal(one(engine, "agree").checked, true);

		const [small, large] = byName(engine, "size");
		engine.toggleField(0, small.id);
		assert.deepEqual(
			byName(engine, "size").map((field) => field.checked),
			[true, false],
		);
		engine.toggleField(0, large.id);
		assert.deepEqual(
			byName(engine, "size").map((field) => field.checked),
			[false, true],
		);
		assert.equal(one(engine, "size").value, "L");
	});

	test("refuses read-only fields, missing fields and the wrong kind of change", () => {
		const engine = EditorEngine.open(makeFormPdf());
		assert.throws(
			() => engine.setField(0, one(engine, "id").id, "X-2"),
			refusedWith("field_read_only"),
		);
		assert.throws(() => engine.setField(0, 9999, "x"), refusedWith("no_field"));
		assert.throws(
			() => engine.toggleField(0, one(engine, "name").id),
			refusedWith("no_field"),
		);
		assert.throws(
			() => engine.setField(0, one(engine, "agree").id, "Yes"),
			refusedWith("no_field"),
		);
		assert.equal(engine.history().canUndo, false);
	});

	test("downloads with values kept and fields still fillable", () => {
		const engine = EditorEngine.open(makeFormPdf());
		engine.setField(0, one(engine, "name").id, "Bob");
		engine.toggleField(0, one(engine, "agree").id);
		engine.addItem(
			0,
			{ kind: "rect", rect: BOX },
			{
				color: [1, 0, 0],
				fill: null,
				strokeWidth: 1,
				opacity: 1,
				text: {
					family: "sans",
					bold: false,
					italic: false,
					size: 12,
					color: [0, 0, 0],
				},
			},
		);

		const reopened = EditorEngine.open(engine.save());
		assert.equal(one(reopened, "name").value, "Bob");
		assert.equal(one(reopened, "agree").checked, true);
		assert.equal(reopened.fields(0).length, 6);
		/** The added rectangle was flattened; the fields were not. */
		assert.deepEqual(reopened.items(0), []);
		reopened.setField(0, one(reopened, "name").id, "Ann");
		assert.equal(one(reopened, "name").value, "Ann");
	});

	test("field values are not offered as editable text lines", () => {
		const engine = EditorEngine.open(makeFormPdf());
		engine.setField(0, one(engine, "name").id, "Bob");
		assert.deepEqual(
			engine.lines(0).map((line) => line.text),
			["Name:"],
		);
		assert.deepEqual(
			linesOf(engine.save()).map((line) => line.text),
			["Name:"],
		);
	});
});
