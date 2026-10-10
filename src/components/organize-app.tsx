import {
	ArrowLeft,
	ArrowRight,
	Check,
	FileOutput,
	ListChecks,
	MoveHorizontal,
	RotateCcw,
	RotateCw,
	Trash2,
	X,
} from "lucide-react";
import {
	type DragEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { downloadPdf } from "../lib/download";
import { EditorClient, EditorRequestError } from "../lib/editor-client";
import {
	extractedFileName,
	isPdfFile,
	MAX_EDIT_BYTES,
	organizedFileName,
} from "../lib/files";
import { createHostBridge, HOST_MESSAGE_TYPE } from "../lib/host-bridge";
import {
	errorMessage,
	NOT_PDF_MESSAGE,
	TOO_LARGE_MESSAGE,
} from "../lib/messages";
import {
	movedPositions,
	normalizePages,
	rangeSelection,
	stepTarget,
} from "../lib/organize";
import {
	type EditResult,
	EMPTY_HISTORY,
	type HistoryState,
	type PageSize,
} from "../lib/protocol";
import { resolveShortcut, type ShortcutAction } from "../lib/shortcuts";
import { SOURCE_URL } from "../lib/source";
import type { Feature } from "./drop-zone";
import { EditorHeader } from "./editor-toolbar";
import { Thumbnail } from "./page-sidebar";
import { StartScreen } from "./start-screen";
import { Divider, IconButton } from "./ui";

/** What the organizer can do, shown before a file is picked. */
const ORGANIZE_FEATURES: readonly Feature[] = [
	{ icon: MoveHorizontal, label: "Drag to reorder" },
	{ icon: RotateCw, label: "Rotate" },
	{ icon: Trash2, label: "Delete pages" },
	{ icon: FileOutput, label: "Extract pages" },
];

/** Card width in CSS pixels: two columns fit a phone, many a laptop. */
const CARD_WIDTH_PX = 136;
/** Notices close themselves after this long. */
const NOTICE_MS = 6000;
const QUARTER_TURN = 90;
/** Firefox only starts a drag when some data is set. */
const DRAG_DATA_TYPE = "text/plain";

type Session = { client: EditorClient; fileName: string; pages: PageSize[] };
type Bridge = ReturnType<typeof createHostBridge>;

/** Focus is in a field where keys belong to typing, not to shortcuts. */
function isTyping(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
	);
}

/**
 * Page organizer: every page as a thumbnail in a grid. Pick pages, then
 * move, rotate, delete, or extract them; drag to reorder. Same engine and
 * worker as the editor, so every change is applied to the PDF at once and
 * one undo step reverts it.
 */
export function OrganizeApp({ bridge }: { bridge: Bridge }) {
	const [session, setSession] = useState<Session | null>(null);
	const [opening, setOpening] = useState(false);
	const [busy, setBusy] = useState(false);
	const [saving, setSaving] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
	/** Bumped after every change; pages may have moved, so all re-render. */
	const [epoch, setEpoch] = useState(0);
	const [selected, setSelected] = useState<number[]>([]);
	/** Where a Shift-click range starts. */
	const anchor = useRef<number | null>(null);
	const [dragging, setDragging] = useState<number[] | null>(null);
	const [dropBefore, setDropBefore] = useState<number | null>(null);
	const root = useRef<HTMLDivElement>(null);

	const pages = session?.pages ?? [];
	const count = pages.length;

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

	/** One worker per opened file; keyed on the client, not the session. */
	const client = session?.client;
	useEffect(() => () => client?.terminate(), [client]);

	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(null), NOTICE_MS);
		return () => clearTimeout(timer);
	}, [notice]);

	/** Unsaved changes: ask before the tab closes. */
	useEffect(() => {
		if (!history.canUndo) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [history.canUndo]);

	const showError = useCallback((error: unknown) => {
		if (error instanceof EditorRequestError)
			setNotice(errorMessage(error.code, error.detail));
		else setNotice(errorMessage("internal"));
	}, []);

	function resetWorkspace() {
		setHistory(EMPTY_HISTORY);
		setEpoch((value) => value + 1);
		setSelected([]);
		anchor.current = null;
		setDragging(null);
		setDropBefore(null);
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
			setSession({ client, fileName: file.name, pages });
			bridge.send({ type: HOST_MESSAGE_TYPE.event, name: "organize_opened" });
		} catch (error) {
			client.terminate();
			showError(error);
			bridge.send({ type: HOST_MESSAGE_TYPE.event, name: "organize_failed" });
		} finally {
			setOpening(false);
		}
	}

	/**
	 * Runs one change and takes in its result. `nextSelection` gets the new
	 * page count and says which pages stay picked; by default none do.
	 */
	async function change(
		run: () => Promise<EditResult>,
		nextSelection: (pageCount: number) => number[] = () => [],
	) {
		setBusy(true);
		setNotice(null);
		try {
			const result = await run();
			setHistory(result.history);
			setSession((current) =>
				current ? { ...current, pages: result.pages } : current,
			);
			setEpoch((value) => value + 1);
			setSelected(
				normalizePages(nextSelection(result.pages.length), result.pages.length),
			);
		} catch (error) {
			showError(error);
		} finally {
			setBusy(false);
		}
	}

	function move(current: Session, moving: number[], before: number) {
		const picked = normalizePages(moving, current.pages.length);
		if (picked.length === 0) return;
		return change(
			() =>
				current.client.request({ type: "movePages", pages: picked, before }),
			(pageCount) => movedPositions(pageCount, picked, before),
		);
	}

	function step(current: Session, direction: -1 | 1) {
		const before = stepTarget(selected, direction, current.pages.length);
		if (before !== null) void move(current, selected, before);
	}

	function rotate(current: Session, degrees: number) {
		const picked = selected;
		return change(
			() =>
				current.client.request({ type: "rotatePages", pages: picked, degrees }),
			() => picked,
		);
	}

	function remove(current: Session) {
		const picked = selected;
		return change(() =>
			current.client.request({ type: "deletePages", pages: picked }),
		);
	}

	/** Downloads the whole PDF, or only the picked pages. */
	async function save(current: Session, only?: number[]) {
		setBusy(true);
		setSaving(true);
		try {
			if (only) {
				const { bytes } = await current.client.request({
					type: "extractPages",
					pages: only,
				});
				downloadPdf(bytes, extractedFileName(current.fileName));
			} else {
				const { bytes } = await current.client.request({ type: "save" });
				downloadPdf(bytes, organizedFileName(current.fileName));
			}
			bridge.send({ type: HOST_MESSAGE_TYPE.event, name: "organize_saved" });
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
				"Close this PDF? Changes you haven't downloaded will be lost.",
			)
		) {
			return;
		}
		setSession(null);
		setNotice(null);
		resetWorkspace();
	}

	/** Plain click toggles a page, Shift-click picks the range from the last click. */
	function pick(index: number, shift: boolean) {
		if (shift && anchor.current !== null) {
			const range = rangeSelection(anchor.current, index);
			setSelected((current) => normalizePages([...current, ...range], count));
			return;
		}
		anchor.current = index;
		setSelected((current) =>
			current.includes(index)
				? current.filter((page) => page !== index)
				: normalizePages([...current, index], count),
		);
	}

	function startDrag(event: DragEvent<HTMLButtonElement>, index: number) {
		/** Dragging a picked page carries the whole selection; any other page goes alone. */
		const carried = selected.includes(index) ? selected : [index];
		if (!selected.includes(index)) setSelected([index]);
		setDragging(carried);
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData(DRAG_DATA_TYPE, String(index + 1));
	}

	function dragOver(event: DragEvent<HTMLLIElement>, index: number) {
		if (!dragging) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		const box = event.currentTarget.getBoundingClientRect();
		/** Left half drops before this page, right half after it. */
		setDropBefore(event.clientX < box.left + box.width / 2 ? index : index + 1);
	}

	function endDrag() {
		setDragging(null);
		setDropBefore(null);
	}

	function drop(current: Session, event: DragEvent) {
		event.preventDefault();
		if (dragging && dropBefore !== null) {
			void move(current, dragging, dropBefore);
		}
		endDrag();
	}

	/** Shortcuts read the latest state through this ref; the listener stays put. */
	const shortcut = useRef<
		(action: ShortcutAction, event: KeyboardEvent) => void
	>(() => {});
	shortcut.current = (action, event) => {
		if (!session) return;
		const hasSelection = selected.length > 0;
		switch (action) {
			case "undo":
			case "redo":
				event.preventDefault();
				if (!busy && history[action === "undo" ? "canUndo" : "canRedo"])
					void change(() => session.client.request({ type: action }));
				return;
			case "save":
				event.preventDefault();
				if (!busy) void save(session);
				return;
			case "selectAll":
				event.preventDefault();
				setSelected(pages.map((_, index) => index));
				return;
			case "escape":
				setSelected([]);
				return;
			case "delete":
				if (hasSelection && !busy) {
					event.preventDefault();
					void remove(session);
				}
				return;
			case "nudgeLeft":
			case "nudgeRight":
				if (hasSelection && !busy) {
					event.preventDefault();
					step(session, action === "nudgeLeft" ? -1 : 1);
				}
				return;
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
				features={ORGANIZE_FEATURES}
				onFile={open}
			/>
		);
	}

	const none = selected.length === 0;
	const allPicked = selected.length === count;
	const canStepLeft = stepTarget(selected, -1, count) !== null;
	const canStepRight = stepTarget(selected, 1, count) !== null;

	return (
		<div ref={root} className="flex h-svh flex-col bg-ground text-ink">
			<EditorHeader
				fileName={session.fileName}
				pageCount={count}
				canUndo={history.canUndo}
				canRedo={history.canRedo}
				busy={busy}
				saving={saving}
				onUndo={() => change(() => session.client.request({ type: "undo" }))}
				onRedo={() => change(() => session.client.request({ type: "redo" }))}
				onOpenAnother={closeFile}
				onDownload={() => save(session)}
			/>

			<nav
				aria-label="Page actions"
				className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-line border-b bg-white px-2 sm:justify-center"
			>
				<span className="shrink-0 whitespace-nowrap px-2 text-ink-soft text-sm tabular-nums">
					{none ? "Select pages" : `${selected.length} selected`}
				</span>
				<IconButton
					icon={allPicked ? X : ListChecks}
					label={allPicked ? "Clear selection (Esc)" : "Select all (Ctrl+A)"}
					disabled={busy}
					onClick={() =>
						setSelected(allPicked ? [] : pages.map((_, index) => index))
					}
				/>
				<Divider />
				<IconButton
					icon={ArrowLeft}
					label="Move earlier (←)"
					disabled={busy || !canStepLeft}
					onClick={() => step(session, -1)}
				/>
				<IconButton
					icon={ArrowRight}
					label="Move later (→)"
					disabled={busy || !canStepRight}
					onClick={() => step(session, 1)}
				/>
				<Divider />
				<IconButton
					icon={RotateCcw}
					label="Rotate left"
					disabled={busy || none}
					onClick={() => rotate(session, -QUARTER_TURN)}
				/>
				<IconButton
					icon={RotateCw}
					label="Rotate right"
					disabled={busy || none}
					onClick={() => rotate(session, QUARTER_TURN)}
				/>
				<IconButton
					icon={Trash2}
					label="Delete pages (Delete)"
					disabled={busy || none || allPicked}
					onClick={() => remove(session)}
					className="hover:bg-red-50! hover:text-red-600!"
				/>
				<Divider />
				<IconButton
					icon={FileOutput}
					label="Extract selected pages"
					showLabel
					disabled={busy || none}
					onClick={() => save(session, selected)}
				/>
			</nav>

			<main className="relative min-h-0 flex-1 overflow-auto">
				<ul
					aria-label="Pages"
					className="mx-auto flex max-w-6xl flex-wrap justify-center gap-5 px-4 pt-6 pb-10"
					onDrop={(event) => drop(session, event)}
					onDragOver={(event) => {
						if (dragging) event.preventDefault();
					}}
				>
					{pages.map((size, index) => {
						const isPicked = selected.includes(index);
						const isDragged = dragging?.includes(index) ?? false;
						return (
							<li
								key={index}
								className="relative flex flex-col items-center gap-1.5"
								onDragOver={(event) => dragOver(event, index)}
							>
								{dropBefore === index && <DropMark side="left" />}
								{dropBefore === count && index === count - 1 && (
									<DropMark side="right" />
								)}
								<button
									type="button"
									draggable={!busy}
									aria-pressed={isPicked}
									aria-label={`Page ${index + 1}`}
									disabled={busy}
									onClick={(event) => pick(index, event.shiftKey)}
									onDragStart={(event) => startDrag(event, index)}
									onDragEnd={endDrag}
									className={`group relative cursor-grab rounded-md focus-visible:outline-none active:cursor-grabbing disabled:cursor-wait ${isDragged ? "opacity-40" : ""}`}
								>
									<Thumbnail
										client={session.client}
										index={index}
										size={size}
										renderKey={String(epoch)}
										active={isPicked}
										width={CARD_WIDTH_PX}
									/>
									{isPicked && (
										<span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-primary text-white shadow-sm">
											<Check size={14} strokeWidth={3} aria-hidden />
										</span>
									)}
								</button>
								<span
									className={`text-xs tabular-nums ${isPicked ? "font-semibold text-primary-ink" : "text-ink-soft"}`}
								>
									{index + 1}
								</span>
							</li>
						);
					})}
				</ul>

				{notice && (
					<div className="pointer-events-none sticky inset-x-0 bottom-4 z-40 flex justify-center px-4">
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
			</main>

			<footer className="flex h-9 shrink-0 items-center justify-between gap-3 border-line border-t bg-white px-4 text-ink-soft text-xs">
				<span className="truncate">
					Click pages to select them, Shift-click for a range. Drag to reorder.
				</span>
				<a
					href={SOURCE_URL}
					target="_blank"
					rel="noreferrer"
					className="shrink-0 underline underline-offset-2 hover:text-ink"
				>
					Source code (AGPL-3.0)
				</a>
			</footer>
		</div>
	);
}

/** Where dragged pages will land: a bar in the gap beside a card. */
function DropMark({ side }: { side: "left" | "right" }) {
	return (
		<span
			aria-hidden
			className={`absolute top-0 bottom-6 w-1 rounded-full bg-primary ${side === "left" ? "-left-3" : "-right-3"}`}
		/>
	);
}
