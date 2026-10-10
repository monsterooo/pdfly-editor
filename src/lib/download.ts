/** Give the browser a moment to start the download before revoking. */
const REVOKE_DELAY_MS = 10_000;

/** Hands a PDF made in the tab to the browser as a download. */
export function downloadPdf(bytes: Uint8Array, fileName: string) {
	const url = URL.createObjectURL(
		new Blob([bytes as BlobPart], { type: "application/pdf" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
