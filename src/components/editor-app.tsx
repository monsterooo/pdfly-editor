import { FilePlus2, RotateCcw, RotateCw, Trash2, X } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { downloadPdf } from "../lib/download";
import { EditorClient, EditorRequestError } from "../lib/editor-client";
import { editedFileName, isPdfFile, MAX_EDIT_BYTES } from "../lib/files";
import { type Rect, translateRect } from "../lib/geometry";
import { createHostBridge, HOST_MESSAGE_TYPE } from "../lib/host-bridge";
import { type Picture, readPicture } from "../lib/images";
import { DEFAULT_ITEM_STYLE, MARKUP_KINDS } from "../lib/item-style";
import {
	errorMessage,
	NOT_PDF_MESSAGE,
	TOO_LARGE_MESSAGE,
} from "../lib/messages";
import {
	type EditResult,
	EMPTY_HISTORY,
	type HistoryState,
	type ItemKind,
	type ItemPatch,
	type ItemStyle,
	type NewItem,
	type PageItem,
	type PageSize,
	type SearchHit,
	type TextStyle,
} from "../lib/protocol";
import {
	NUDGE_FAR_PT,
	NUDGE_PT,
	resolveShortcut,
	type ShortcutAction,
} from "../lib/shortcuts";
import { SOURCE_URL } from "../lib/source";
import { isSticky, kindOfTool, TOOL_INFO, type Tool } from "../lib/tools";
import { clampZoom, resolveZoom, stepZoom, type ZoomMode } from "../lib/zoom";
import type { Placing } from "./draw-layer";
import { EDITOR_FEATURES } from "./drop-zone";
import { EditorPage } from "./editor-page";
import { EditorHeader, EditorToolbar } from "./editor-toolbar";
import { PageSidebar } from "./page-sidebar";
import { SearchBar } from "./search-bar";
import { SignatureDialog } from "./signature-dialog";
import { StartScreen } from "./start-screen";
import { StatusBar } from "./status-bar";
import { IconButton } from "./ui";

/** Windows at least this wide open with the thumbnail sidebar shown. */
const SIDEBAR_MIN_WINDOW_PX = 1024;
/** Notices close themselves after this long. */
const NOTICE_MS = 6000;
/** Space left above a page when jumping to it, in CSS pixels. */
const JUMP_MARGIN_PX = 16;
/** A search match is scrolled to this share of the viewport height. */
const HIT_VIEW_SHARE = 1 / 3;
/** Share of the viewport height that decides which page is "current". */
const CURRENT_PAGE_LINE = 0.35;
/** Ctrl+wheel zoom speed: zoom factor per pixel of wheel travel. */
const WHEEL_ZOOM_RATE = 0.0025;
/** Page action bars are at least this wide, even over narrow pages. */
const PAGE_HEADER_MIN_PX = 240;
const QUARTER_TURN = 90;

type Session = { client: EditorClient; fileName: string; pages: PageSize[] };
type Bridge = ReturnType<typeof createHostBridge>;
type Selection = { page: number; id: number; item: PageItem | null };
type SearchState = {
	open: boolean;
	query: string;
	hits: SearchHit[] | null;
	index: number;
	searching: boolean;
};

const CLOSED_SEARCH: SearchState = {
	open: false,
	query: "",
	hits: null,
	index: 0,
	searching: false,
};

/** Focus is in a field where keys belong to typing, not to shortcuts. */
function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
	);
}

/**
 * The whole editor: pick a file, then edit it in a workspace with a header,
 * tool strip, page thumbnails, the pages themselves and a status bar.
 * Holds the worker session, undo state, tool, selection and per-page
 * versions; pages ask the worker for their own renders. Every change is
 * applied to the PDF immediately, so Download only has to save.
 */
export function EditorApp({ bridge }: { bridge: Bridge }) {
	const [session, setSession] = useState<Session | null>(null);
	const [opening, setOpening] = useState(false);
	const [busy, setBusy] = useState(false);
	const [saving, setSaving] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
	/** Bumped when every page may have changed (undo, page operations). */
	const [epoch, setEpoch] = useState(0);
	const [versions, setVersions] = useState<number[]>([]);
	const [tool, setTool] = useState<Tool>("select");
	const [placing, setPlacing] = useState<Placing | null>(null);
	const [styles, setStyles] =
		useState<Record<ItemKind, ItemStyle>>(DEFAULT_ITEM_STYLE);
	const [selection, setSelection] = useState<Selection | null>(null);
	const [zoomMode, setZoomMode] = useState<ZoomMode>("auto");
	const [viewport, setViewport] = useState({ width: 0, height: 0 });
	const [currentPage, setCurrentPage] = useState(0);
	const [sidebarOpen, setSidebarOpen] = useState(
		() => window.innerWidth >= SIDEBAR_MIN_WINDOW_PX,
	);
	const [search, setSearch] = useState<SearchState>(CLOSED_SEARCH);
	const [signing, setSigning] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const scroller = useRef<HTMLElement>(null);
	/** Where the viewport centre sits in the document, as a share of its height. */
	const scrollAnchor = useRef<number | null>(null);

	const pages = session?.pages ?? [];
	const zoom = resolveZoom(zoomMode, pages, viewport);
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;

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

	/**
	 * One worker per opened file. Keyed on the client, not the session: the
	 * session object is replaced on every edit (its page list changes).
	 */
	const client = session?.client;
	useEffect(() => () => client?.terminate(), [client]);

	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(null), NOTICE_MS);
		return () => clearTimeout(timer);
	}, [notice]);

	/** Unsaved edits: ask before the tab closes. */
	useEffect(() => {
		if (!history.canUndo) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [history.canUndo]);

	/**
	 * Track the workspace size for the fit zoom modes. The frame is still
	 * narrow when a file opens and only grows once the host turns it into a
	 * workspace, so this has to follow resizes, not measure once.
	 */
	useEffect(() => {
		const node = scroller.current;
		if (!session || !node) return;
		const observer = new ResizeObserver(() =>
			setViewport({ width: node.clientWidth, height: node.clientHeight }),
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [session]);

	/** Keep the same spot in the middle of the screen when the zoom changes. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: zoom is the signal
	useLayoutEffect(() => {
		const node = scroller.current;
		const anchor = scrollAnchor.current;
		if (!node || anchor === null) return;
		node.scrollTop = anchor * node.scrollHeight - node.clientHeight / 2;
	}, [zoom]);

	/** Ctrl/⌘ + wheel (and trackpad pinch) zooms the pages, not the frame. */
	useEffect(() => {
		const node = scroller.current;
		if (!session || !node) return;
		const onWheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			setZoomMode(
				clampZoom(zoomRef.current * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE)),
			);
		};
		node.addEventListener("wheel", onWheel, { passive: false });
		return () => node.removeEventListener("wheel", onWheel);
	}, [session]);

	const showError = useCallback((error: unknown) => {
		if (error instanceof EditorRequestError)
			setNotice(errorMessage(error.code, error.detail));
		else setNotice(errorMessage("internal"));
	}, []);

	function resetWorkspace() {
		setHistory(EMPTY_HISTORY);
		setEpoch((value) => value + 1);
		setTool("select");
		setPlacing(null);
		setSelection(null);
		setSearch(CLOSED_SEARCH);
		setZoomMode("auto");
		setCurrentPage(0);
		scrollAnchor.current = null;
	}

	async function open(file: File) {
		setNotice(null);
		if (!isPdfFile(file)) return setNotice(NOT_PDF_MESSAGE);
		if (file.size > MAX_EDIT_BYTES) return setNotice(TOO_LARGE_MESSAGE);

		setOpening(true);
		const worker = new Worker(
			new URL("../worker/mupdf.worker.ts", import.meta.url),
			{ type: "module" },
		);
		const client = new EditorClient(worker);
		try {
			const bytes = await file.arrayBuffer();
			const { pages } = await client.request({ type: "open", bytes }, [bytes]);
			resetWorkspace();
			setVersions(pages.map(() => 0));
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

	/**
	 * Takes in a change's result. A change to one page re-renders that page;
	 * anything else (undo, page operations) re-renders them all, since pages
	 * may have moved.
	 */
	function apply(result: EditResult, page?: number) {
		setHistory(result.history);
		setSession((current) =>
			current ? { ...current, pages: result.pages } : current,
		);
		if (page === undefined) {
			setEpoch((value) => value + 1);
			setVersions(result.pages.map(() => 0));
			setSelection(null);
		} else {
			setVersions((current) =>
				current.map((version, index) =>
					index === page ? version + 1 : version,
				),
			);
		}
		setCurrentPage((current) => Math.min(current, result.pages.length - 1));
	}

	/** Runs one change; on failure still re-renders so open edit boxes close. */
	async function change<T extends EditResult>(
		run: () => Promise<T>,
		page?: number,
	): Promise<T | null> {
		setBusy(true);
		setNotice(null);
		try {
			const result = await run();
			apply(result, page);
			if (search.query.trim() !== "") void runSearch(search.query);
			return result;
		} catch (error) {
			showError(error);
			if (page !== undefined) {
				setVersions((current) =>
					current.map((v, i) => (i === page ? v + 1 : v)),
				);
			}
			return null;
		} finally {
			setBusy(false);
		}
	}

	async function download(current: Session) {
		setBusy(true);
		setSaving(true);
		try {
			const { bytes } = await current.client.request({ type: "save" });
			downloadPdf(bytes, editedFileName(current.fileName));
			bridge.send({ type: HOST_MESSAGE_TYPE.event, name: "edit_saved" });
		} catch (error) {
			showError(error);
		} finally {
			setBusy(false);
			setSaving(false);
		}
	}

	function closeFile() {
		if (
			history.canUndo &&
			!window.confirm(
				"Close this PDF? Edits you haven't downloaded will be lost.",
			)
		) {
			return;
		}
		setSession(null);
		setNotice(null);
		resetWorkspace();
	}

	function chooseTool(next: Tool) {
		setTool(next);
		setPlacing(null);
		if (next !== "select") setSelection(null);
	}

	function startPlacing(picture: Picture) {
		if (placing) URL.revokeObjectURL(placing.url);
		setPlacing({
			bytes: picture.bytes,
			aspect: picture.aspect,
			widthPt: picture.widthPt,
			url: URL.createObjectURL(
				new Blob([picture.bytes as BlobPart], { type: "image/png" }),
			),
		});
		setTool("select");
		setSelection(null);
	}

	function stopPlacing() {
		if (placing) URL.revokeObjectURL(placing.url);
		setPlacing(null);
	}

	async function addImage(file: File) {
		try {
			startPlacing(await readPicture(file));
		} catch {
			setNotice(errorMessage("unsupported_image"));
		}
	}

	async function createItem(
		current: Session,
		page: number,
		item: NewItem,
		style: ItemStyle,
	) {
		setStyles((all) => ({ ...all, [item.kind]: style }));
		const wasPlacing = item.kind === "image";
		if (wasPlacing) stopPlacing();
		const result = await change(
			() => current.client.request({ type: "addItem", page, item, style }),
			page,
		);
		if (!result) return;
		if (wasPlacing || !isSticky(tool)) {
			setTool("select");
			setSelection({ page, id: result.id, item: null });
		}
	}

	function updateItem(
		current: Session,
		page: number,
		id: number,
		patch: ItemPatch,
	) {
		const kind = selection?.id === id ? selection.item?.kind : undefined;
		const style = patch.style;
		if (kind && style) setStyles((all) => ({ ...all, [kind]: style }));
		return change(
			() => current.client.request({ type: "updateItem", page, id, patch }),
			page,
		);
	}

	function deleteItem(current: Session, page: number, id: number) {
		setSelection(null);
		return change(
			() => current.client.request({ type: "deleteItem", page, id }),
			page,
		);
	}

	const runSearch = useCallback(
		async (query: string) => {
			if (!session) return;
			if (query.trim() === "") {
				setSearch((current) => ({ ...current, query, hits: null, index: 0 }));
				return;
			}
			setSearch((current) => ({ ...current, query, searching: true }));
			try {
				const { hits } = await session.client.request({
					type: "search",
					needle: query,
				});
				setSearch((current) => {
					const index = Math.min(current.index, Math.max(0, hits.length - 1));
					const fresh = current.query !== query || current.hits === null;
					return {
						...current,
						hits,
						index: fresh ? 0 : index,
						searching: false,
					};
				});
			} catch (error) {
				setSearch((current) => ({ ...current, searching: false }));
				showError(error);
			}
		},
		[session, showError],
	);

	/** Scrolls so a page (and optionally a spot on it) is in view. */
	const reveal = useCallback(
		(page: number, rect?: Rect) => {
			const node = scroller.current;
			const frame = node?.querySelector<HTMLElement>(
				`[data-page-frame="${page}"]`,
			);
			const size = session?.pages[page];
			if (!node || !frame || !size) return;
			const top = rect
				? frame.offsetTop +
					(rect[1] - size.y) * zoom -
					node.clientHeight * HIT_VIEW_SHARE
				: frame.offsetTop - JUMP_MARGIN_PX;
			node.scrollTo({ top, behavior: rect ? "auto" : "smooth" });
			if (!rect) setCurrentPage(page);
		},
		[session, zoom],
	);

	/** Bring the active search match into view whenever it changes. */
	const activeHit = search.hits?.[search.index] ?? null;
	useEffect(() => {
		if (activeHit) reveal(activeHit.page, activeHit.rects[0]);
	}, [activeHit, reveal]);

	const hitsByPage = useMemo(() => {
		const byPage = new Map<number, Rect[]>();
		for (const hit of search.hits ?? []) {
			byPage.set(hit.page, [...(byPage.get(hit.page) ?? []), ...hit.rects]);
		}
		return byPage;
	}, [search.hits]);

	function onScroll() {
		const node = scroller.current;
		if (!node) return;
		scrollAnchor.current =
			(node.scrollTop + node.clientHeight / 2) / node.scrollHeight;
		const line = node.scrollTop + node.clientHeight * CURRENT_PAGE_LINE;
		const frames = node.querySelectorAll<HTMLElement>("[data-page-frame]");
		let current = 0;
		frames.forEach((frame, index) => {
			if (frame.offsetTop <= line) current = index;
		});
		setCurrentPage(current);
	}

	/** Shortcuts read the latest state through this ref; the listener stays put. */
	const shortcut = useRef<
		(action: ShortcutAction, event: KeyboardEvent) => void
	>(() => {});
	shortcut.current = (action, event) => {
		if (!session || signing) return;
		const item = selection?.item;
		const nudge = (dx: number, dy: number) => {
			if (!selection || !item || MARKUP_KINDS.has(item.kind)) return;
			event.preventDefault();
			const step = event.shiftKey ? NUDGE_FAR_PT : NUDGE_PT;
			void updateItem(session, selection.page, item.id, {
				bounds: translateRect(item.bounds, dx * step, dy * step),
			});
		};
		switch (action) {
			case "undo":
				event.preventDefault();
				if (history.canUndo && !busy)
					void change(() => session.client.request({ type: "undo" }));
				return;
			case "redo":
				event.preventDefault();
				if (history.canRedo && !busy)
					void change(() => session.client.request({ type: "redo" }));
				return;
			case "save":
				event.preventDefault();
				if (!busy) void download(session);
				return;
			case "search":
				event.preventDefault();
				setSearch((current) => ({ ...current, open: true }));
				return;
			case "zoomIn":
			case "zoomOut":
				event.preventDefault();
				setZoomMode(stepZoom(zoom, action === "zoomIn" ? 1 : -1));
				return;
			case "zoomFit":
				event.preventDefault();
				setZoomMode("auto");
				return;
			case "delete":
				if (selection) {
					event.preventDefault();
					void deleteItem(session, selection.page, selection.id);
				}
				return;
			case "escape":
				if (placing) stopPlacing();
				else if (search.open) setSearch(CLOSED_SEARCH);
				else if (tool !== "select") setTool("select");
				else setSelection(null);
				return;
			case "nudgeLeft":
				return nudge(-1, 0);
			case "nudgeRight":
				return nudge(1, 0);
			case "nudgeUp":
				return nudge(0, -1);
			case "nudgeDown":
				return nudge(0, 1);
		}
	};

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const action = resolveShortcut(event, isTyping(event.target));
			if (action) shortcut.current(action, event);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	if (!session) {
		return (
			<StartScreen
				rootRef={root}
				busy={opening}
				notice={notice}
				features={EDITOR_FEATURES}
				onFile={open}
			/>
		);
	}

	const toolKind = kindOfTool(tool);
	const toolStyle = toolKind ? styles[toolKind] : DEFAULT_ITEM_STYLE.text;
	const hint = placing
		? "Click on the page to place it. Press Esc to cancel."
		: tool === "select"
			? null
			: TOOL_INFO[tool].hint;

	return (
		<div ref={root} className="flex h-svh flex-col bg-ground text-ink">
			<EditorHeader
				fileName={session.fileName}
				pageCount={pages.length}
				canUndo={history.canUndo}
				canRedo={history.canRedo}
				busy={busy}
				saving={saving}
				onUndo={() => change(() => session.client.request({ type: "undo" }))}
				onRedo={() => change(() => session.client.request({ type: "redo" }))}
				onOpenAnother={closeFile}
				onDownload={() => download(session)}
			/>
			<EditorToolbar
				tool={placing ? "select" : tool}
				searchOpen={search.open}
				onTool={chooseTool}
				onImage={addImage}
				onSign={() => setSigning(true)}
				onToggleSearch={() =>
					setSearch((current) =>
						current.open ? CLOSED_SEARCH : { ...current, open: true },
					)
				}
			/>

			<div className="relative flex min-h-0 flex-1">
				{sidebarOpen && (
					<div className="absolute inset-y-0 left-0 z-30 flex shadow-xl md:static md:shadow-none">
						<PageSidebar
							client={session.client}
							pages={pages}
							renderKeys={versions.map((version) => `${epoch}.${version}`)}
							current={currentPage}
							onGoTo={(page) => {
								reveal(page);
								if (window.innerWidth < SIDEBAR_MIN_WINDOW_PX)
									setSidebarOpen(false);
							}}
						/>
					</div>
				)}

				<div className="relative min-w-0 flex-1">
					<main
						ref={scroller}
						onScroll={onScroll}
						className="absolute inset-0 overflow-auto"
					>
						<div className="flex min-w-max flex-col items-center gap-6 px-6 pt-5 pb-10">
							{pages.map((size, index) => (
								<section
									key={index}
									aria-label={`Page ${index + 1}`}
									className="group/page flex flex-col items-center gap-1.5"
								>
									<PageActions
										index={index}
										width={Math.max(size.width * zoom, PAGE_HEADER_MIN_PX)}
										canDelete={pages.length > 1}
										disabled={busy}
										onRotate={(degrees) =>
											change(() =>
												session.client.request({
													type: "rotatePage",
													page: index,
													degrees,
												}),
											)
										}
										onInsert={() =>
											change(() =>
												session.client.request({
													type: "insertPage",
													after: index,
												}),
											)
										}
										onDelete={() =>
											change(() =>
												session.client.request({
													type: "deletePage",
													page: index,
												}),
											)
										}
									/>
									<EditorPage
										client={session.client}
										index={index}
										size={size}
										zoom={zoom}
										renderKey={`${epoch}.${versions[index] ?? 0}`}
										tool={tool}
										toolStyle={toolStyle}
										placing={placing}
										selectedId={selection?.page === index ? selection.id : null}
										hits={hitsByPage.get(index) ?? []}
										activeHit={activeHit?.page === index ? activeHit.rects : []}
										onSelect={(item) =>
											setSelection(
												item ? { page: index, id: item.id, item } : null,
											)
										}
										onCreate={(item, style) =>
											createItem(session, index, item, style)
										}
										onUpdateItem={(id, patch) =>
											updateItem(session, index, id, patch)
										}
										onDeleteItem={(id) => deleteItem(session, index, id)}
										onReplace={(line, text, style?: TextStyle) =>
											change(
												() =>
													session.client.request({
														type: "replace",
														page: index,
														line,
														text,
														style,
													}),
												index,
											)
										}
										onError={showError}
									/>
								</section>
							))}
						</div>
					</main>

					{hint && (
						<div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4">
							<p className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink/90 py-1.5 pr-1.5 pl-4 text-sm text-white shadow-lg">
								{hint}
								<button
									type="button"
									onClick={() => (placing ? stopPlacing() : setTool("select"))}
									className="rounded-full px-2.5 py-0.5 text-white/80 text-xs hover:bg-white/15 hover:text-white"
								>
									{placing ? "Cancel" : "Done"}
								</button>
							</p>
						</div>
					)}

					{search.open && (
						<SearchBar
							count={search.hits?.length ?? null}
							index={search.index}
							searching={search.searching}
							onSearch={runSearch}
							onStep={(direction) =>
								setSearch((current) => {
									const count = current.hits?.length ?? 0;
									if (count === 0) return current;
									return {
										...current,
										index: (current.index + direction + count) % count,
									};
								})
							}
							onClose={() => setSearch(CLOSED_SEARCH)}
						/>
					)}

					{notice && (
						<div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
							<p
								role="status"
								aria-live="polite"
								className="pointer-events-auto flex max-w-xl items-center gap-2 rounded-xl bg-ink py-2 pr-2 pl-4 text-sm text-white shadow-xl"
							>
								{notice}
								<button
									type="button"
									aria-label="Dismiss"
									onClick={() => setNotice(null)}
									className="grid size-7 shrink-0 place-items-center rounded-lg text-white/70 hover:bg-white/15 hover:text-white"
								>
									<X size={15} aria-hidden />
								</button>
							</p>
						</div>
					)}
				</div>
			</div>

			<StatusBar
				sidebarOpen={sidebarOpen}
				page={currentPage}
				pageCount={pages.length}
				zoom={zoom}
				zoomMode={zoomMode}
				sourceUrl={SOURCE_URL}
				onToggleSidebar={() => setSidebarOpen((open) => !open)}
				onGoTo={reveal}
				onZoomMode={setZoomMode}
				onZoomStep={(direction) => setZoomMode(stepZoom(zoom, direction))}
			/>

			{signing && (
				<SignatureDialog
					onClose={() => setSigning(false)}
					onDone={(picture) => {
						setSigning(false);
						startPlacing(picture);
					}}
				/>
			)}
		</div>
	);
}

/**
 * Page number and page operations above each page. On devices with a
 * pointer the actions show on hover or focus, to keep the stack calm.
 */
function PageActions({
	index,
	width,
	canDelete,
	disabled,
	onRotate,
	onInsert,
	onDelete,
}: {
	index: number;
	width: number;
	canDelete: boolean;
	disabled: boolean;
	onRotate: (degrees: number) => void;
	onInsert: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="flex h-8 items-center justify-between" style={{ width }}>
			<span className="font-medium text-ink-soft text-xs tabular-nums">
				Page {index + 1}
			</span>
			<div className="flex items-center gap-0.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/page:opacity-100 [@media(hover:hover)]:group-hover/page:opacity-100">
				<IconButton
					icon={RotateCcw}
					label="Rotate left"
					size="sm"
					disabled={disabled}
					onClick={() => onRotate(-QUARTER_TURN)}
				/>
				<IconButton
					icon={RotateCw}
					label="Rotate right"
					size="sm"
					disabled={disabled}
					onClick={() => onRotate(QUARTER_TURN)}
				/>
				<IconButton
					icon={FilePlus2}
					label="Insert blank page after"
					size="sm"
					disabled={disabled}
					onClick={onInsert}
				/>
				<IconButton
					icon={Trash2}
					label="Delete page"
					size="sm"
					disabled={disabled || !canDelete}
					onClick={onDelete}
					className="hover:bg-red-50! hover:text-red-600!"
				/>
			</div>
		</div>
	);
}
