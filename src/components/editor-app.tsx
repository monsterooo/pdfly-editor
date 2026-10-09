import { useCallback, useEffect, useRef, useState } from "react";

import { EditorClient, EditorRequestError } from "../lib/editor-client";
import { editedFileName, isPdfFile, MAX_EDIT_BYTES } from "../lib/files";
import type { Point } from "../lib/geometry";
import { createHostBridge, HOST_MESSAGE_TYPE } from "../lib/host-bridge";
import {
	errorMessage,
	NOT_PDF_MESSAGE,
	TOO_LARGE_MESSAGE,
} from "../lib/messages";
import {
	EMPTY_HISTORY,
	type HistoryState,
	type PageSize,
} from "../lib/protocol";
import { DropZone } from "./drop-zone";
import { EditorPage } from "./editor-page";
import { EditorToolbar } from "./editor-toolbar";

/** CSS pixels per PDF point at each zoom step. 1 is "actual size". */
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** Horizontal room around a page when fitting it to the window. */
const FIT_GUTTER_PX = 48;
const PERCENT = 100;

/**
 * Public repository with this editor's source, as the AGPL requires.
 * vite.config.ts refuses a production build without it.
 */
const SOURCE_URL = import.meta.env.VITE_SOURCE_URL ?? "";

type Session = { client: EditorClient; fileName: string; pages: PageSize[] };
type Bridge = ReturnType<typeof createHostBridge>;

/** Largest zoom step at which the widest page fits the window. */
function fitZoomIndex(pages: PageSize[], width: number): number {
	const widest = Math.max(...pages.map((page) => page.width));
	const fit = (width - FIT_GUTTER_PX) / widest;
	let best = 0;
	ZOOM_LEVELS.forEach((level, index) => {
		if (level <= fit) best = index;
	});
	return best;
}

/**
 * The whole editor: pick a file, then edit it page by page.
 * Holds the worker session, undo state and per-page versions; pages ask the
 * worker for their own renders. Edits are applied to the PDF immediately,
 * so Download only has to save.
 */
export function EditorApp({ bridge }: { bridge: Bridge }) {
	const [session, setSession] = useState<Session | null>(null);
	const [opening, setOpening] = useState(false);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [zoomIndex, setZoomIndex] = useState(2);
	const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
	const [versions, setVersions] = useState<number[]>([]);
	const [adding, setAdding] = useState(false);
	/** Until the visitor picks a zoom, pages keep fitting the window width. */
	const [zoomPicked, setZoomPicked] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const scroller = useRef<HTMLElement>(null);

	/** Tell the host how tall to make the frame. */
	useEffect(() => {
		const node = root.current;
		if (!node) return;
		const report = () =>
			bridge.send({
				type: HOST_MESSAGE_TYPE.height,
				height: Math.ceil(node.scrollHeight),
				workspace: session !== null,
			});
		report();
		const observer = new ResizeObserver(report);
		observer.observe(node);
		return () => observer.disconnect();
	}, [bridge, session]);

	useEffect(() => () => session?.client.terminate(), [session]);

	/**
	 * Fit to width whenever the workspace resizes. The frame is still narrow
	 * when a file opens and only grows once the host turns it into a
	 * workspace, so fitting once at open time would pick a tiny zoom.
	 */
	useEffect(() => {
		const node = scroller.current;
		if (!session || zoomPicked || !node) return;
		const observer = new ResizeObserver(() => {
			setZoomIndex(fitZoomIndex(session.pages, node.clientWidth));
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, [session, zoomPicked]);

	const showError = useCallback((error: unknown) => {
		if (error instanceof EditorRequestError)
			setNotice(errorMessage(error.code, error.detail));
		else setNotice(errorMessage("internal"));
	}, []);

	async function open(file: File) {
		setNotice(null);
		if (!isPdfFile(file)) return setNotice(NOT_PDF_MESSAGE);
		if (file.size > MAX_EDIT_BYTES) return setNotice(TOO_LARGE_MESSAGE);

		setOpening(true);
		const worker = new Worker(
			new URL("../worker/mupdf.worker.ts", import.meta.url),
			{
				type: "module",
			},
		);
		const client = new EditorClient(worker);
		try {
			const bytes = await file.arrayBuffer();
			const { pages } = await client.request({ type: "open", bytes }, [bytes]);
			setZoomPicked(false);
			setVersions(pages.map(() => 0));
			setHistory(EMPTY_HISTORY);
			setAdding(false);
			setSession({ client, fileName: file.name, pages });
			bridge.send({ type: HOST_MESSAGE_TYPE.event, name: "edit_opened" });
		} catch (error) {
			client.terminate();
			showError(error);
			bridge.send({ type: HOST_MESSAGE_TYPE.event, name: "edit_failed" });
		} finally {
			setOpening(false);
		}
	}

	/** Runs one change, then re-renders the pages it may have touched. */
	async function change(run: () => Promise<HistoryState>, page?: number) {
		setBusy(true);
		setNotice(null);
		try {
			setHistory(await run());
			setVersions((current) =>
				current.map((version, index) =>
					page === undefined || page === index ? version + 1 : version,
				),
			);
		} catch (error) {
			showError(error);
			/** Re-render anyway so a cancelled edit box goes away. */
			if (page !== undefined) {
				setVersions((current) =>
					current.map((v, i) => (i === page ? v + 1 : v)),
				);
			}
		} finally {
			setBusy(false);
		}
	}

	async function download(current: Session) {
		setBusy(true);
		try {
			const { bytes } = await current.client.request({ type: "save" });
			const url = URL.createObjectURL(
				new Blob([bytes as BlobPart], { type: "application/pdf" }),
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = editedFileName(current.fileName);
			link.click();
			/** Give the browser a moment to start the download before revoking. */
			const REVOKE_DELAY_MS = 10_000;
			setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
			bridge.send({ type: HOST_MESSAGE_TYPE.event, name: "edit_saved" });
		} catch (error) {
			showError(error);
		} finally {
			setBusy(false);
		}
	}

	const zoom = ZOOM_LEVELS[zoomIndex];

	return (
		<div ref={root} className={session ? "flex h-svh flex-col" : "p-4"}>
			{session ? (
				<>
					<EditorToolbar
						fileName={session.fileName}
						zoomPercent={Math.round(zoom * PERCENT)}
						canZoomOut={zoomIndex > 0}
						canZoomIn={zoomIndex < ZOOM_LEVELS.length - 1}
						canUndo={history.canUndo}
						canRedo={history.canRedo}
						adding={adding}
						busy={busy}
						onZoomOut={() => setZoomIndex((i) => Math.max(0, i - 1))}
						onZoomIn={() =>
							setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))
						}
						onToggleAdd={() => setAdding((on) => !on)}
						onUndo={() =>
							change(() => session.client.request({ type: "undo" }))
						}
						onRedo={() =>
							change(() => session.client.request({ type: "redo" }))
						}
						onDownload={() => download(session)}
						onClose={() => {
							setSession(null);
							setNotice(null);
						}}
					/>
					<Notice text={notice} />
					<main
						ref={scroller}
						className="flex-1 overflow-auto bg-ground px-4 py-6"
					>
						<div className="flex flex-col gap-6">
							{session.pages.map((size, index) => (
								<EditorPage
									key={index}
									client={session.client}
									index={index}
									size={size}
									zoom={zoom}
									version={versions[index] ?? 0}
									adding={adding}
									onError={showError}
									onReplace={(line, text) =>
										change(
											() =>
												session.client.request({
													type: "replace",
													page: index,
													line,
													text,
												}),
											index,
										)
									}
									onAdd={(origin: Point, text) => {
										setAdding(false);
										change(
											() =>
												session.client.request({
													type: "add",
													page: index,
													origin,
													text,
												}),
											index,
										);
									}}
								/>
							))}
						</div>
					</main>
					<SourceNote />
				</>
			) : (
				<div className="mx-auto flex max-w-2xl flex-col gap-3">
					<DropZone busy={opening} onFile={open} />
					<Notice text={notice} />
					<SourceNote />
				</div>
			)}
		</div>
	);
}

function Notice({ text }: { text: string | null }) {
	return (
		<p
			role="status"
			aria-live="polite"
			className={
				text ? "bg-primary-wash px-4 py-2 text-primary-ink text-sm" : "sr-only"
			}
		>
			{text}
		</p>
	);
}

/** The AGPL offer of source, visible on every screen of the editor. */
function SourceNote() {
	return (
		<p className="px-4 py-2 text-center text-ink-soft text-xs">
			Editor powered by MuPDF ·{" "}
			<a
				href={SOURCE_URL}
				target="_blank"
				rel="noreferrer"
				className="underline underline-offset-2 hover:text-ink"
			>
				Source code (AGPL-3.0)
			</a>
		</p>
	);
}
