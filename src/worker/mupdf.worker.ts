/// <reference lib="webworker" />
import type {
	EditorReply,
	EditorRequest,
	EditorRequestEnvelope,
} from "../lib/protocol";
import type { EditorEngine } from "./engine";

/**
 * MuPDF runs here so parsing, rendering and saving never block typing.
 * This file only routes messages; EditorEngine does the work.
 *
 * The engine is imported dynamically on purpose: MuPDF loads its WASM with
 * a top-level await, and a module worker starts delivering messages while
 * that await is pending. With a static import the first "open" would arrive
 * before onmessage exists and be lost, so the handler is attached first and
 * waits for the module instead.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const engineModule = import("./engine");
let engine: EditorEngine | undefined;

function requireEngine(): EditorEngine {
	/** Only reachable if the UI sends work before "open"; reported as internal. */
	if (!engine) throw new Error("no document open");
	return engine;
}

/** Returns the value and any buffers to hand over without copying. */
async function handle(
	request: EditorRequest,
): Promise<[unknown, Transferable[]]> {
	const { EditorEngine } = await engineModule;
	switch (request.type) {
		case "open":
			engine = EditorEngine.open(new Uint8Array(request.bytes));
			return [{ pages: engine.pageSizes() }, []];
		case "render": {
			const png = requireEngine().render(
				request.page,
				request.scale,
				request.hideItems,
			);
			return [{ png }, [png.buffer]];
		}
		case "renderItem": {
			const png = requireEngine().renderItem(
				request.page,
				request.id,
				request.scale,
			);
			return [{ png }, [png.buffer]];
		}
		case "lines":
			return [{ lines: requireEngine().lines(request.page) }, []];
		case "items":
			return [{ items: requireEngine().items(request.page) }, []];
		case "replace":
			return [
				requireEngine().replaceLine(
					request.page,
					request.line,
					request.text,
					request.style,
				),
				[],
			];
		case "addItem":
			return [
				requireEngine().addItem(request.page, request.item, request.style),
				[],
			];
		case "updateItem":
			return [
				requireEngine().updateItem(request.page, request.id, request.patch),
				[],
			];
		case "deleteItem":
			return [requireEngine().deleteItem(request.page, request.id), []];
		case "rotatePage":
			return [requireEngine().rotatePage(request.page, request.degrees), []];
		case "deletePage":
			return [requireEngine().deletePage(request.page), []];
		case "insertPage":
			return [requireEngine().insertPage(request.after), []];
		case "search":
			return [{ hits: requireEngine().search(request.needle) }, []];
		case "undo":
			return [requireEngine().undo(), []];
		case "redo":
			return [requireEngine().redo(), []];
		case "save": {
			const bytes = requireEngine().save();
			return [{ bytes }, [bytes.buffer]];
		}
	}
}

/**
 * Requests run one at a time, in arrival order: MuPDF is not re-entrant, and
 * an edit must finish before the render that follows it.
 */
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event: MessageEvent<EditorRequestEnvelope>) => {
	queue = queue.then(() => respond(event.data));
};

async function respond({ id, request }: EditorRequestEnvelope) {
	const { EngineError } = await engineModule;
	let reply: EditorReply;
	let transfer: Transferable[] = [];
	try {
		const [value, buffers] = await handle(request);
		reply = { id, ok: true, value };
		transfer = buffers;
	} catch (error) {
		reply =
			error instanceof EngineError
				? { id, ok: false, error: { code: error.code, detail: error.detail } }
				: { id, ok: false, error: { code: "internal" } };
		if (!(error instanceof EngineError)) console.error(error);
	}
	scope.postMessage(reply, transfer);
}
