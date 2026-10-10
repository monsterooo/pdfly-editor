import {
	Eraser,
	FilePlus2,
	Highlighter,
	ImagePlus,
	type LucideIcon,
	Shapes,
	Signature,
	Type,
	Upload,
} from "lucide-react";
import { useState } from "react";

import { MAX_EDIT_MB } from "../lib/files";

/** One chip under the drop target: something the app can do. */
export type Feature = { icon: LucideIcon; label: string };

/** What the editor can do, shown before a file is picked. */
export const EDITOR_FEATURES: readonly Feature[] = [
	{ icon: Type, label: "Edit & add text" },
	{ icon: Signature, label: "Sign" },
	{ icon: ImagePlus, label: "Images" },
	{ icon: Highlighter, label: "Highlight" },
	{ icon: Eraser, label: "Whiteout" },
	{ icon: Shapes, label: "Shapes & drawing" },
	{ icon: FilePlus2, label: "Rotate, add & delete pages" },
];

type DropZoneProps = {
	busy: boolean;
	features: readonly Feature[];
	onFile: (file: File) => void;
};

/**
 * Drop target and file picker. The whole label is the hit area; the input
 * is visually hidden but still reachable by keyboard and screen readers.
 */
export function DropZone({ busy, features, onFile }: DropZoneProps) {
	const [hot, setHot] = useState(false);

	return (
		<div className="flex flex-col gap-4">
			<label
				className={`flex min-h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors focus-within:outline-2 focus-within:outline-primary ${
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
				<span className="grid size-12 place-items-center rounded-full bg-primary-wash text-primary-ink">
					<Upload size={22} aria-hidden />
				</span>
				<span className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-semibold text-white shadow-sm">
					{busy ? "Opening…" : "Choose PDF"}
				</span>
				<span className="text-ink-soft">
					or drop it here · up to {MAX_EDIT_MB} MB
				</span>
				<span className="text-ink-soft text-sm">
					Your file stays in your browser. Nothing is uploaded.
				</span>
			</label>
			<ul className="flex flex-wrap justify-center gap-2">
				{features.map(({ icon: Icon, label }) => (
					<li
						key={label}
						className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-ink-soft text-xs"
					>
						<Icon size={14} aria-hidden />
						{label}
					</li>
				))}
			</ul>
		</div>
	);
}
