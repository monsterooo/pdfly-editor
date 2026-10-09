type EditorToolbarProps = {
	fileName: string;
	zoomPercent: number;
	canZoomOut: boolean;
	canZoomIn: boolean;
	canUndo: boolean;
	canRedo: boolean;
	adding: boolean;
	busy: boolean;
	onZoomOut: () => void;
	onZoomIn: () => void;
	onToggleAdd: () => void;
	onUndo: () => void;
	onRedo: () => void;
	onDownload: () => void;
	onClose: () => void;
};

const BUTTON_CLASS =
	"rounded-md border border-line-strong bg-white px-3 py-1.5 font-medium text-ink text-sm hover:border-ink-soft disabled:cursor-not-allowed disabled:opacity-40";

/** Top bar: file, editing tools, zoom and download. Wraps on narrow screens. */
export function EditorToolbar(props: EditorToolbarProps) {
	return (
		<div className="flex flex-wrap items-center gap-2 border-line border-b bg-white/95 px-4 py-2.5 backdrop-blur">
			<p
				className="mr-auto min-w-0 truncate font-semibold text-ink"
				title={props.fileName}
			>
				{props.fileName}
			</p>
			<button
				type="button"
				aria-pressed={props.adding}
				onClick={props.onToggleAdd}
				className={`${BUTTON_CLASS} ${props.adding ? "border-primary bg-primary-wash text-primary-ink" : ""}`}
			>
				{props.adding ? "Click the page to add text" : "Add text"}
			</button>
			<button
				type="button"
				className={BUTTON_CLASS}
				disabled={!props.canUndo || props.busy}
				onClick={props.onUndo}
			>
				Undo
			</button>
			<button
				type="button"
				className={BUTTON_CLASS}
				disabled={!props.canRedo || props.busy}
				onClick={props.onRedo}
			>
				Redo
			</button>
			<div className="flex items-center gap-1">
				<button
					type="button"
					aria-label="Zoom out"
					className={BUTTON_CLASS}
					disabled={!props.canZoomOut}
					onClick={props.onZoomOut}
				>
					−
				</button>
				<span className="w-12 text-center text-ink-soft text-sm tabular-nums">
					{props.zoomPercent}%
				</span>
				<button
					type="button"
					aria-label="Zoom in"
					className={BUTTON_CLASS}
					disabled={!props.canZoomIn}
					onClick={props.onZoomIn}
				>
					+
				</button>
			</div>
			<button type="button" className={BUTTON_CLASS} onClick={props.onClose}>
				Open another
			</button>
			<button
				type="button"
				disabled={props.busy}
				onClick={props.onDownload}
				className="rounded-md bg-primary px-4 py-1.5 font-semibold text-sm text-white hover:bg-primary-hover disabled:opacity-60"
			>
				Download PDF
			</button>
		</div>
	);
}
