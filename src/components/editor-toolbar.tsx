import {
	ArrowUpRight,
	Circle,
	Download,
	Eraser,
	FileText,
	FolderOpen,
	Highlighter,
	ImagePlus,
	type LucideIcon,
	Minus,
	MousePointer2,
	Pencil,
	Redo2,
	Search,
	Signature,
	Square,
	Strikethrough,
	Type,
	Underline,
	Undo2,
} from "lucide-react";
import { Fragment, useRef } from "react";

import { TOOL_GROUPS, TOOL_INFO, type Tool } from "../lib/tools";
import { Divider, IconButton, Spinner } from "./ui";

const TOOL_ICON: Record<Tool, LucideIcon> = {
	select: MousePointer2,
	text: Type,
	whiteout: Eraser,
	highlight: Highlighter,
	underline: Underline,
	strikeout: Strikethrough,
	rect: Square,
	ellipse: Circle,
	line: Minus,
	arrow: ArrowUpRight,
	ink: Pencil,
};

/** Image types MuPDF reads directly; others are converted to PNG first. */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

type HeaderProps = {
	fileName: string;
	pageCount: number;
	canUndo: boolean;
	canRedo: boolean;
	busy: boolean;
	saving: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onOpenAnother: () => void;
	onDownload: () => void;
};

/** Top bar: the file, history, and the way out (download or another file). */
export function EditorHeader(props: HeaderProps) {
	return (
		<header className="flex h-14 shrink-0 items-center gap-2 border-line border-b bg-white px-3 sm:px-4">
			<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-wash text-primary-ink">
				<FileText size={18} aria-hidden />
			</span>
			<div className="mr-auto min-w-0">
				<p
					className="truncate font-semibold text-ink text-sm leading-tight"
					title={props.fileName}
				>
					{props.fileName}
				</p>
				<p className="text-ink-soft text-xs leading-tight">
					{props.pageCount} {props.pageCount === 1 ? "page" : "pages"}
					{props.busy && !props.saving && (
						<span className="ml-2 inline-flex items-center gap-1 align-middle">
							<Spinner className="size-3 border-[1.5px]" /> Updating
						</span>
					)}
				</p>
			</div>
			<IconButton
				icon={Undo2}
				label="Undo (Ctrl+Z)"
				disabled={!props.canUndo || props.busy}
				onClick={props.onUndo}
			/>
			<IconButton
				icon={Redo2}
				label="Redo (Ctrl+Shift+Z)"
				disabled={!props.canRedo || props.busy}
				onClick={props.onRedo}
			/>
			<Divider />
			<IconButton
				icon={FolderOpen}
				label="Open another PDF"
				onClick={props.onOpenAnother}
			/>
			<button
				type="button"
				disabled={props.busy}
				onClick={props.onDownload}
				className="ml-1 inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-3.5 font-semibold text-sm text-white shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-60"
			>
				{props.saving ? <Spinner /> : <Download size={17} aria-hidden />}
				<span className="hidden sm:inline">
					{props.saving ? "Saving…" : "Download"}
				</span>
			</button>
		</header>
	);
}

type ToolbarProps = {
	tool: Tool;
	searchOpen: boolean;
	onTool: (tool: Tool) => void;
	onImage: (file: File) => void;
	onSign: () => void;
	onToggleSearch: () => void;
};

/**
 * Tool strip under the header. Scrolls sideways on narrow screens rather
 * than wrapping, so the page area keeps a fixed top.
 */
export function EditorToolbar(props: ToolbarProps) {
	const picker = useRef<HTMLInputElement>(null);

	return (
		<nav
			aria-label="Tools"
			className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-line border-b bg-white px-2 sm:justify-center"
		>
			{TOOL_GROUPS.map((group, groupIndex) => (
				<Fragment key={group.join()}>
					{groupIndex > 0 && <Divider />}
					{group.map((tool) => (
						<IconButton
							key={tool}
							icon={TOOL_ICON[tool]}
							label={TOOL_INFO[tool].label}
							showLabel={tool === "select" || tool === "text"}
							active={props.tool === tool}
							onClick={() => props.onTool(tool)}
						/>
					))}
					{groupIndex === 1 && (
						<>
							<IconButton
								icon={Signature}
								label="Sign"
								showLabel
								onClick={props.onSign}
							/>
							<IconButton
								icon={ImagePlus}
								label="Image"
								showLabel
								onClick={() => picker.current?.click()}
							/>
						</>
					)}
				</Fragment>
			))}
			<Divider />
			<IconButton
				icon={Search}
				label="Find text (Ctrl+F)"
				active={props.searchOpen}
				onClick={props.onToggleSearch}
			/>
			<input
				ref={picker}
				type="file"
				accept={IMAGE_ACCEPT}
				className="sr-only"
				tabIndex={-1}
				aria-hidden
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) props.onImage(file);
					event.target.value = "";
				}}
			/>
		</nav>
	);
}
