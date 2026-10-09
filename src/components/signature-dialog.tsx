import { Eraser, Upload, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { type Picture, readPicture, trimmedPicture } from "../lib/images";
import { rgbToHex } from "../lib/item-style";
import type { Rgb } from "../lib/protocol";
import { IconButton } from "./ui";

type Mode = "draw" | "type" | "upload";

/** Signature ink: black, dark blue. */
const INK_COLORS: readonly Rgb[] = [
	[0.07, 0.09, 0.15],
	[0.1, 0.22, 0.6],
];
/** Pad size in CSS pixels; the canvas backs it at device resolution. */
const PAD_HEIGHT_PX = 200;
const PEN_WIDTH_PX = 2.6;
/** A signature is placed about this wide, like a pen signature on paper. */
const SIGNATURE_WIDTH_PT = 160;
/** Typed signatures are drawn this large before trimming, then scaled down. */
const TYPED_FONT_PX = 96;
const TYPED_PADDING_PX = 24;
/** Canvas height for typed signatures, in font sizes: room for flourishes. */
const TYPED_HEIGHT_EM = 1.6;

/** Handwriting faces commonly installed on each platform. */
const SCRIPT_FONTS = [
	{
		label: "Script",
		css: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive',
	},
	{
		label: "Brush",
		css: '"Brush Script MT", "Bradley Hand", "Segoe Print", cursive',
	},
	{
		label: "Note",
		css: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive',
	},
];

const TABS: { mode: Mode; label: string }[] = [
	{ mode: "draw", label: "Draw" },
	{ mode: "type", label: "Type" },
	{ mode: "upload", label: "Upload" },
];

type SignatureDialogProps = {
	onDone: (picture: Picture) => void;
	onClose: () => void;
};

/**
 * Make a signature by drawing, typing or uploading an image. The result is
 * a trimmed transparent PNG, placed on the page like an image.
 */
export function SignatureDialog({ onDone, onClose }: SignatureDialogProps) {
	const [mode, setMode] = useState<Mode>("draw");
	const [ink, setInk] = useState(INK_COLORS[0]);
	const [typed, setTyped] = useState("");
	const [font, setFont] = useState(0);
	const [drawn, setDrawn] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pad = useRef<HTMLCanvasElement>(null);
	const last = useRef<[number, number] | null>(null);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	/** Back the pad with device pixels so strokes stay crisp. */
	useLayoutEffect(() => {
		const canvas = pad.current;
		if (!canvas || mode !== "draw") return;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = canvas.clientWidth * ratio;
		canvas.height = PAD_HEIGHT_PX * ratio;
		const context = canvas.getContext("2d");
		context?.scale(ratio, ratio);
		setDrawn(false);
	}, [mode]);

	function stroke(to: [number, number]) {
		const context = pad.current?.getContext("2d");
		const from = last.current;
		if (!context || !from) return;
		context.strokeStyle = rgbToHex(ink);
		context.lineWidth = PEN_WIDTH_PX;
		context.lineCap = "round";
		context.lineJoin = "round";
		context.beginPath();
		context.moveTo(from[0], from[1]);
		context.lineTo(to[0], to[1]);
		context.stroke();
		last.current = to;
		setDrawn(true);
	}

	function clear() {
		const canvas = pad.current;
		canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
		setDrawn(false);
	}

	async function placeTyped() {
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (!context || typed.trim() === "") return;
		const fontCss = `${TYPED_FONT_PX}px ${SCRIPT_FONTS[font].css}`;
		context.font = fontCss;
		const width = context.measureText(typed).width;
		canvas.width = Math.ceil(width + TYPED_PADDING_PX * 2);
		canvas.height = Math.ceil(TYPED_FONT_PX * TYPED_HEIGHT_EM);
		context.font = fontCss;
		context.fillStyle = rgbToHex(ink);
		context.textBaseline = "middle";
		context.fillText(typed, TYPED_PADDING_PX, canvas.height / 2);
		const picture = await trimmedPicture(canvas, SIGNATURE_WIDTH_PT);
		if (picture) onDone(picture);
	}

	async function placeDrawn() {
		if (!pad.current) return;
		const picture = await trimmedPicture(pad.current, SIGNATURE_WIDTH_PT);
		if (picture) onDone(picture);
	}

	async function upload(file: File) {
		try {
			const picture = await readPicture(file);
			onDone({ ...picture, widthPt: SIGNATURE_WIDTH_PT });
		} catch {
			setError("That image couldn't be read. Use a PNG or JPEG.");
		}
	}

	const canUse =
		mode === "draw" ? drawn : mode === "type" ? typed.trim() !== "" : false;

	return (
		<div
			className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px]"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="signature-title"
				className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
			>
				<div className="flex items-center justify-between border-line border-b px-5 py-3.5">
					<h2 id="signature-title" className="font-semibold text-ink">
						Create your signature
					</h2>
					<IconButton icon={X} label="Close" size="sm" onClick={onClose} />
				</div>

				<div className="px-5 pt-4">
					<div role="tablist" className="inline-flex rounded-lg bg-ground p-1">
						{TABS.map((tab) => (
							<button
								key={tab.mode}
								type="button"
								role="tab"
								aria-selected={mode === tab.mode}
								onClick={() => setMode(tab.mode)}
								className={`rounded-md px-3.5 py-1.5 font-medium text-sm ${
									mode === tab.mode
										? "bg-white text-ink shadow-sm"
										: "text-ink-soft hover:text-ink"
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>

				<div className="px-5 py-4">
					{mode === "draw" && (
						<div className="relative">
							<canvas
								ref={pad}
								aria-label="Signature pad"
								className="block w-full touch-none rounded-xl border border-line-strong border-dashed bg-[linear-gradient(to_bottom,transparent_calc(100%-56px),var(--color-line)_calc(100%-56px),var(--color-line)_calc(100%-55px),transparent_calc(100%-55px))]"
								style={{ height: PAD_HEIGHT_PX, cursor: "crosshair" }}
								onPointerDown={(event) => {
									event.currentTarget.setPointerCapture(event.pointerId);
									const bounds = event.currentTarget.getBoundingClientRect();
									last.current = [
										event.clientX - bounds.left,
										event.clientY - bounds.top,
									];
								}}
								onPointerMove={(event) => {
									if (!last.current) return;
									const bounds = event.currentTarget.getBoundingClientRect();
									stroke([
										event.clientX - bounds.left,
										event.clientY - bounds.top,
									]);
								}}
								onPointerUp={() => {
									last.current = null;
								}}
							/>
							{!drawn && (
								<p className="pointer-events-none absolute inset-0 grid place-items-center text-ink-soft text-sm">
									Sign here with your mouse or finger
								</p>
							)}
							<button
								type="button"
								onClick={clear}
								className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-ink-soft text-xs hover:bg-ground hover:text-ink"
							>
								<Eraser size={14} aria-hidden /> Clear
							</button>
						</div>
					)}

					{mode === "type" && (
						<div className="flex flex-col gap-3">
							<input
								aria-label="Your name"
								placeholder="Type your name"
								value={typed}
								onChange={(event) => setTyped(event.target.value)}
								className="h-11 rounded-lg border border-line-strong px-3 text-ink focus-visible:outline-2 focus-visible:outline-primary"
							/>
							<div className="grid gap-2 sm:grid-cols-3">
								{SCRIPT_FONTS.map((option, index) => (
									<button
										key={option.label}
										type="button"
										aria-pressed={font === index}
										onClick={() => setFont(index)}
										className={`h-16 truncate rounded-lg border px-3 text-2xl ${
											font === index
												? "border-primary bg-primary-wash"
												: "border-line hover:border-line-strong"
										}`}
										style={{ fontFamily: option.css, color: rgbToHex(ink) }}
									>
										{typed.trim() || "Your name"}
									</button>
								))}
							</div>
						</div>
					)}

					{mode === "upload" && (
						<label className="flex h-[200px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-line-strong border-dashed text-center text-ink-soft text-sm hover:border-primary focus-within:outline-2 focus-within:outline-primary">
							<Upload size={22} aria-hidden />
							<span>
								<span className="font-semibold text-ink">Choose an image</span>{" "}
								of your signature
							</span>
							<span className="text-xs">
								PNG with a transparent background works best
							</span>
							<input
								type="file"
								accept="image/png,image/jpeg,image/webp"
								className="sr-only"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (file) upload(file);
									event.target.value = "";
								}}
							/>
						</label>
					)}
					{error && <p className="mt-2 text-red-600 text-sm">{error}</p>}
				</div>

				{mode !== "upload" && (
					<div className="flex items-center gap-3 border-line border-t px-5 py-3.5">
						<span className="text-ink-soft text-xs">Ink</span>
						{INK_COLORS.map((color) => (
							<button
								key={rgbToHex(color)}
								type="button"
								aria-label={`Ink ${rgbToHex(color)}`}
								aria-pressed={color === ink}
								onClick={() => setInk(color)}
								className={`size-6 rounded-full ${color === ink ? "ring-2 ring-primary ring-offset-2" : ""}`}
								style={{ background: rgbToHex(color) }}
							/>
						))}
						<button
							type="button"
							disabled={!canUse}
							onClick={() => (mode === "draw" ? placeDrawn() : placeTyped())}
							className="ml-auto rounded-lg bg-primary px-4 py-2 font-semibold text-sm text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
						>
							Place signature
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
