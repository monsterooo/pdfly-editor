import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
	EditorClient,
	EditorRequestError,
	type WorkerLike,
} from "../src/lib/editor-client";
import { editedFileName, isPdfFile, MAX_EDIT_BYTES } from "../src/lib/files";
import { cssColor, cssFontFor } from "../src/lib/font-match";
import {
	createHostBridge,
	HOST_MESSAGE_TYPE,
	parseOrigins,
} from "../src/lib/host-bridge";
import { errorMessage } from "../src/lib/messages";
import type { EditorReply, EditorRequestEnvelope } from "../src/lib/protocol";

describe("host bridge", () => {
	test("keeps only bare origins", () => {
		assert.deepEqual(
			parseOrigins(
				" https://pdfly.app, http://localhost:3001 ,*, https://x.com/path,",
			),
			["https://pdfly.app", "http://localhost:3001"],
		);
		assert.deepEqual(parseOrigins(undefined), []);
	});

	test("posts to each allowed origin and never to *", () => {
		const sent: [unknown, string][] = [];
		const bridge = createHostBridge(
			{ postMessage: (m, o) => sent.push([m, o]) },
			["https://a.com", "https://b.com"],
		);
		bridge.send({ type: HOST_MESSAGE_TYPE.event, name: "edit_opened" });
		assert.deepEqual(
			sent.map(([, origin]) => origin),
			["https://a.com", "https://b.com"],
		);
	});

	test("does nothing without a parent", () => {
		assert.doesNotThrow(() =>
			createHostBridge(null, ["https://a.com"]).send({
				type: HOST_MESSAGE_TYPE.event,
				name: "edit_saved",
			}),
		);
	});
});

/** In-memory worker: records requests, lets the test reply. */
function fakeWorker() {
	const posted: EditorRequestEnvelope[] = [];
	const worker: WorkerLike = {
		onmessage: null,
		onerror: null,
		postMessage: (message) => posted.push(message as EditorRequestEnvelope),
		terminate: () => {},
	};
	const reply = (data: EditorReply) =>
		worker.onmessage?.({ data } as MessageEvent<EditorReply>);
	return { worker, posted, reply };
}

describe("EditorClient", () => {
	test("matches replies to requests by id", async () => {
		const { worker, posted, reply } = fakeWorker();
		const client = new EditorClient(worker);
		const first = client.request({ type: "undo" });
		const second = client.request({ type: "redo" });
		reply({
			id: posted[1].id,
			ok: true,
			value: { canUndo: true, canRedo: false },
		});
		reply({
			id: posted[0].id,
			ok: true,
			value: { canUndo: false, canRedo: true },
		});
		assert.deepEqual(await first, { canUndo: false, canRedo: true });
		assert.deepEqual(await second, { canUndo: true, canRedo: false });
	});

	test("turns error replies into EditorRequestError", async () => {
		const { worker, posted, reply } = fakeWorker();
		const pending = new EditorClient(worker).request({
			type: "replace",
			page: 0,
			line: 0,
			text: "🙂",
		});
		reply({
			id: posted[0].id,
			ok: false,
			error: { code: "unsupported_character", detail: "🙂" },
		});
		await assert.rejects(
			pending,
			(error) => error instanceof EditorRequestError && error.detail === "🙂",
		);
	});

	test("a crashed worker rejects everything in flight", async () => {
		const { worker } = fakeWorker();
		const pending = new EditorClient(worker).request({ type: "save" });
		worker.onerror?.({} as ErrorEvent);
		await assert.rejects(
			pending,
			(error) =>
				error instanceof EditorRequestError && error.code === "internal",
		);
	});
});

describe("files and wording", () => {
	test("pdf detection by type or name", () => {
		assert.ok(isPdfFile({ type: "application/pdf", name: "x" }));
		assert.ok(isPdfFile({ type: "", name: "Report.PDF" }));
		assert.ok(!isPdfFile({ type: "image/png", name: "a.png" }));
		assert.equal(MAX_EDIT_BYTES, 50 * 1024 * 1024);
	});

	test("edited file name never overwrites the original", () => {
		assert.equal(editedFileName("contract.pdf"), "contract-edited.pdf");
		assert.equal(editedFileName("Scan.PDF"), "Scan-edited.pdf");
		assert.equal(editedFileName(".pdf"), "document-edited.pdf");
	});

	test("unsupported character names the character", () => {
		assert.match(errorMessage("unsupported_character", "🙂"), /🙂/);
	});
});

describe("css font and colour", () => {
	test("css font follows the standard font match", () => {
		assert.deepEqual(cssFontFor("Times-BoldItalic"), {
			family: '"Times New Roman", Times, serif',
			weight: 700,
			style: "italic",
		});
		assert.equal(cssFontFor("ArialMT").family, "Helvetica, Arial, sans-serif");
	});

	test("gray, rgb and cmyk become css rgb()", () => {
		assert.equal(cssColor([0.5]), "rgb(128 128 128)");
		assert.equal(cssColor([0.8, 0, 0]), "rgb(204 0 0)");
		assert.equal(cssColor([0, 0, 0, 1]), "rgb(0 0 0)");
	});
});
