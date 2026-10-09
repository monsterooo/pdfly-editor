import { useState } from "react";

import { MAX_EDIT_MB } from "../lib/files";

type DropZoneProps = {
	busy: boolean;
	onFile: (file: File) => void;
};

/**
 * Drop target and file picker. The whole label is the hit area; the input
 * is visually hidden but still reachable by keyboard and screen readers.
 */
export function DropZone({ busy, onFile }: DropZoneProps) {
	const [hot, setHot] = useState(false);

	return (
		<label
			className={`flex min-h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors focus-within:outline-2 focus-within:outline-primary ${
				hot
					? "border-primary bg-primary-wash"
					: "border-line-strong bg-white hover:border-primary"
			}`}
			onDragOver={(event) => {
				event.preventDefault();
				setHot(true);
			}}
			onDragLeave={() => setHot(false)}
			onDrop={(event) => {
				event.preventDefault();
				setHot(false);
				const file = event.dataTransfer.files?.[0];
				if (file) onFile(file);
			}}
		>
			<input
				className="sr-only"
				type="file"
				accept="application/pdf,.pdf"
				aria-label="PDF file"
				disabled={busy}
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) onFile(file);
					event.target.value = "";
				}}
			/>
			<span className="rounded-md bg-primary px-5 py-2.5 font-semibold text-white">
				{busy ? "Opening…" : "Choose PDF"}
			</span>
			<span className="text-ink-soft">
				or drop it here · up to {MAX_EDIT_MB} MB
			</span>
			<span className="text-ink-soft text-sm">
				Your file stays in your browser. Nothing is uploaded.
			</span>
		</label>
	);
}
