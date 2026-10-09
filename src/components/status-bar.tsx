import {
	ChevronDown,
	ChevronUp,
	PanelLeft,
	PanelLeftClose,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import { useEffect, useState } from "react";

import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEPS, type ZoomMode } from "../lib/zoom";
import { Divider, IconButton } from "./ui";

const PERCENT = 100;

/** Zoom modes that follow the window, with their menu labels. */
const FIT_MODES = [
	{ mode: "auto", label: "Auto", menu: "Automatic" },
	{ mode: "fit-width", label: "Width", menu: "Fit width" },
	{ mode: "fit-page", label: "Page", menu: "Fit page" },
] as const;

type StatusBarProps = {
	sidebarOpen: boolean;
	page: number;
	pageCount: number;
	zoom: number;
	zoomMode: ZoomMode;
	sourceUrl: string;
	onToggleSidebar: () => void;
	onGoTo: (page: number) => void;
	onZoomMode: (mode: ZoomMode) => void;
	onZoomStep: (direction: 1 | -1) => void;
};

/**
 * Bottom bar: thumbnails toggle, page navigation and zoom, plus the AGPL
 * source link that has to stay visible on every screen of the editor.
 */
export function StatusBar(props: StatusBarProps) {
	const [draft, setDraft] = useState(String(props.page + 1));
	useEffect(() => setDraft(String(props.page + 1)), [props.page]);

	function commitPage() {
		const target = Number.parseInt(draft, 10);
		if (Number.isFinite(target)) {
			props.onGoTo(Math.min(props.pageCount, Math.max(1, target)) - 1);
		} else {
			setDraft(String(props.page + 1));
		}
	}

	/** A picked zoom shows as its preset, or as "custom" after Ctrl+wheel. */
	const zoomValue =
		typeof props.zoomMode !== "number"
			? props.zoomMode
			: (ZOOM_STEPS as readonly number[]).includes(props.zoomMode)
				? String(props.zoomMode)
				: "custom";

	return (
		<footer className="flex h-11 shrink-0 items-center gap-1 border-line border-t bg-white px-2 text-sm">
			<IconButton
				icon={props.sidebarOpen ? PanelLeftClose : PanelLeft}
				label={props.sidebarOpen ? "Hide pages" : "Show pages"}
				size="sm"
				onClick={props.onToggleSidebar}
			/>
			<Divider />
			<IconButton
				icon={ChevronUp}
				label="Previous page"
				size="sm"
				className="max-sm:hidden"
				disabled={props.page === 0}
				onClick={() => props.onGoTo(props.page - 1)}
			/>
			<form
				className="flex items-center gap-1.5 text-ink-soft"
				onSubmit={(event) => {
					event.preventDefault();
					commitPage();
				}}
			>
				<input
					aria-label="Page number"
					inputMode="numeric"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commitPage}
					onFocus={(event) => event.target.select()}
					className="h-7 w-10 rounded-md border border-line bg-white text-center text-ink tabular-nums focus-visible:outline-2 focus-visible:outline-primary"
				/>
				<span className="whitespace-nowrap tabular-nums">
					/ {props.pageCount}
				</span>
			</form>
			<IconButton
				icon={ChevronDown}
				label="Next page"
				size="sm"
				className="max-sm:hidden"
				disabled={props.page >= props.pageCount - 1}
				onClick={() => props.onGoTo(props.page + 1)}
			/>

			<div className="mx-auto" />

			<IconButton
				icon={ZoomOut}
				label="Zoom out (Ctrl+−)"
				size="sm"
				className="max-sm:hidden"
				disabled={props.zoom <= MIN_ZOOM}
				onClick={() => props.onZoomStep(-1)}
			/>
			<select
				aria-label="Zoom"
				value={zoomValue}
				onChange={(event) => {
					const value = event.target.value;
					const fit = FIT_MODES.find((option) => option.mode === value);
					props.onZoomMode(fit ? fit.mode : Number(value));
				}}
				className="h-8 w-[6.75rem] rounded-lg sm:w-[8rem] border border-line bg-white px-2 text-ink tabular-nums hover:border-line-strong focus-visible:outline-2 focus-visible:outline-primary"
			>
				{zoomValue === "custom" && (
					<option value="custom" disabled>
						{Math.round(props.zoom * PERCENT)}%
					</option>
				)}
				{FIT_MODES.map(({ mode, label, menu }) => (
					<option key={mode} value={mode}>
						{zoomValue === mode
							? `${Math.round(props.zoom * PERCENT)}% · ${label}`
							: menu}
					</option>
				))}
				{ZOOM_STEPS.map((step) => (
					<option key={step} value={step}>
						{Math.round(step * PERCENT)}%
					</option>
				))}
			</select>
			<IconButton
				icon={ZoomIn}
				label="Zoom in (Ctrl+=)"
				size="sm"
				className="max-sm:hidden"
				disabled={props.zoom >= MAX_ZOOM}
				onClick={() => props.onZoomStep(1)}
			/>
			<span className="max-sm:hidden">
				<Divider />
			</span>
			<a
				href={props.sourceUrl}
				target="_blank"
				rel="noreferrer"
				className="shrink-0 px-1.5 text-ink-soft text-xs underline-offset-2 hover:text-ink hover:underline"
			>
				<span className="sm:hidden">Source</span>
				<span className="hidden sm:inline">Source code (AGPL-3.0)</span>
			</a>
		</footer>
	);
}
