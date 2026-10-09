/**
 * Picture helpers for the Image and Sign tools. Browser-only (canvas,
 * createImageBitmap); kept apart from the pure modules so those stay
 * testable in Node.
 */

/** Types MuPDF decodes itself; anything else goes through a canvas. */
const NATIVE_TYPES = new Set(["image/png", "image/jpeg"]);

/** CSS pixels per point: images are placed at their natural 96 dpi size. */
const PX_PER_PT = 96 / 72;

/** Pictures larger than this, in pixels per side, are scaled down first. */
const MAX_IMAGE_SIDE_PX = 3000;

export type Picture = {
	bytes: Uint8Array;
	/** Height over width. */
	aspect: number;
	/** Natural width in points. */
	widthPt: number;
};

function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) return reject(new Error("canvas export failed"));
			blob
				.arrayBuffer()
				.then((buffer) => resolve(new Uint8Array(buffer)), reject);
		}, "image/png");
	});
}

/**
 * Reads an image file. PNG and JPEG keep their bytes (JPEG stays small);
 * other formats, and very large pictures, are redrawn as PNG.
 */
export async function readPicture(file: File): Promise<Picture> {
	const bitmap = await createImageBitmap(file);
	const { width, height } = bitmap;
	const aspect = height / width;
	const scale = Math.min(1, MAX_IMAGE_SIDE_PX / Math.max(width, height));
	try {
		if (NATIVE_TYPES.has(file.type) && scale === 1) {
			return {
				bytes: new Uint8Array(await file.arrayBuffer()),
				aspect,
				widthPt: width / PX_PER_PT,
			};
		}
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		canvas
			.getContext("2d")
			?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		return {
			bytes: await canvasPng(canvas),
			aspect,
			widthPt: width / PX_PER_PT,
		};
	} finally {
		bitmap.close();
	}
}

/** Alpha below this counts as empty when trimming a signature. */
const ALPHA_EMPTY = 8;
const RGBA = 4;
const ALPHA_OFFSET = 3;
/** Transparent margin kept around a trimmed signature, in pixels. */
const TRIM_PADDING_PX = 6;

/**
 * Crops a canvas to its drawn pixels and exports it as PNG, so a signature
 * is placed by its ink rather than by the whole pad. Null if nothing is drawn.
 */
export async function trimmedPicture(
	canvas: HTMLCanvasElement,
	/** Width the signature should be placed at, in points. */
	widthPt: number,
): Promise<Picture | null> {
	const context = canvas.getContext("2d");
	if (!context) return null;
	const { width, height } = canvas;
	const { data } = context.getImageData(0, 0, width, height);
	let x0 = width;
	let y0 = height;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (data[(y * width + x) * RGBA + ALPHA_OFFSET] > ALPHA_EMPTY) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
		}
	}
	if (x1 < 0) return null;
	x0 = Math.max(0, x0 - TRIM_PADDING_PX);
	y0 = Math.max(0, y0 - TRIM_PADDING_PX);
	x1 = Math.min(width - 1, x1 + TRIM_PADDING_PX);
	y1 = Math.min(height - 1, y1 + TRIM_PADDING_PX);

	const crop = document.createElement("canvas");
	crop.width = x1 - x0 + 1;
	crop.height = y1 - y0 + 1;
	crop
		.getContext("2d")
		?.drawImage(
			canvas,
			x0,
			y0,
			crop.width,
			crop.height,
			0,
			0,
			crop.width,
			crop.height,
		);
	return {
		bytes: await canvasPng(crop),
		aspect: crop.height / crop.width,
		widthPt,
	};
}
