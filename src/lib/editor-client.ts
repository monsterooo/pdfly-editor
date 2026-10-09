import type {
	EditorErrorCode,
	EditorReply,
	EditorRequest,
	EditorRequestEnvelope,
	EditorResponseMap,
} from "./protocol";

/** A failed request, carrying the engine's code for the UI to word. */
export class EditorRequestError extends Error {
	constructor(
		readonly code: EditorErrorCode,
		readonly detail?: string,
	) {
		super(code);
	}
}

/** What the client needs from a Worker; tests pass a fake. */
export type WorkerLike = {
	postMessage(message: unknown, transfer: Transferable[]): void;
	onmessage: ((event: MessageEvent<EditorReply>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	terminate(): void;
};

type Pending = {
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
};

/**
 * Promise wrapper over the MuPDF worker. Each request gets an id; the reply
 * with that id settles it. A crashed worker rejects everything in flight
 * instead of leaving the UI waiting forever.
 */
export class EditorClient {
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();

	constructor(private readonly worker: WorkerLike) {
		worker.onmessage = (event) => this.settle(event.data);
		worker.onerror = () => this.failAll();
	}

	request<T extends EditorRequest["type"]>(
		request: Extract<EditorRequest, { type: T }>,
		transfer: Transferable[] = [],
	): Promise<EditorResponseMap[T]> {
		const id = this.nextId++;
		const envelope: EditorRequestEnvelope = { id, request };
		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			this.worker.postMessage(envelope, transfer);
		});
	}

	terminate() {
		this.worker.terminate();
		this.failAll();
	}

	private settle(reply: EditorReply) {
		const pending = this.pending.get(reply.id);
		if (!pending) return;
		this.pending.delete(reply.id);
		if (reply.ok) pending.resolve(reply.value);
		else
			pending.reject(
				new EditorRequestError(reply.error.code, reply.error.detail),
			);
	}

	private failAll() {
		for (const pending of this.pending.values()) {
			pending.reject(new EditorRequestError("internal"));
		}
		this.pending.clear();
	}
}
