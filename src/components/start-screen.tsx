import type { Ref } from "react";

import { SOURCE_URL } from "../lib/source";
import { DropZone, type Feature } from "./drop-zone";

type StartScreenProps = {
	/** Measured by the app so the host can size the frame. */
	rootRef: Ref<HTMLDivElement>;
	busy: boolean;
	notice: string | null;
	features: readonly Feature[];
	onFile: (file: File) => void;
};

/**
 * What the editor and the organizer show before a PDF is open: the drop
 * target, the last notice, and the source link the AGPL asks for.
 */
export function StartScreen({
	rootRef,
	busy,
	notice,
	features,
	onFile,
}: StartScreenProps) {
	return (
		<div ref={rootRef} className="p-4">
			<div className="mx-auto flex max-w-2xl flex-col gap-3">
				<DropZone busy={busy} features={features} onFile={onFile} />
				{notice && (
					<p
						role="status"
						className="rounded-lg bg-primary-wash px-4 py-2 text-primary-ink text-sm"
					>
						{notice}
					</p>
				)}
				<p className="text-center text-ink-soft text-xs">
					Powered by MuPDF ·{" "}
					<a
						href={SOURCE_URL}
						target="_blank"
						rel="noreferrer"
						className="underline underline-offset-2 hover:text-ink"
					>
						Source code (AGPL-3.0)
					</a>
				</p>
			</div>
		</div>
	);
}
