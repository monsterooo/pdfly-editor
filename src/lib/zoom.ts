import type { PageSize } from "./protocol";

/**
 * Zoom presets, in CSS pixels per PDF point. 1 is "actual size" at 96 dpi
 * (a point is 1/72 in, so 100% is a bit smaller than print).
 */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/**
 * How the zoom is chosen. The fit modes follow the window as it resizes;
 * a number is a zoom the visitor picked.
 */
export type ZoomMode = "auto" | "fit-width" | "fit-page" | number;

/**
 * "auto" fits the width but stops here, so a wide window does not blow a
 * page up to poster size (pdf.js does the same).
 */
export const AUTO_MAX_ZOOM = 1.25;

/** Room around a page inside the scroller, in CSS pixels per side. */
export const PAGE_GUTTER_PX = 24;

export function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Zoom for a mode in a viewport. Fit width uses the widest page so every
 * page fits; fit page also fits the tallest page's height; auto is fit
 * width up to AUTO_MAX_ZOOM.
 */
export function resolveZoom(
	mode: ZoomMode,
	pages: readonly PageSize[],
	viewport: { width: number; height: number },
): number {
	if (typeof mode === "number") return clampZoom(mode);
	if (pages.length === 0) return 1;
	const room = (size: number) => Math.max(1, size - PAGE_GUTTER_PX * 2);
	const widest = Math.max(...pages.map((page) => page.width));
	const byWidth = room(viewport.width) / widest;
	if (mode === "fit-width") return clampZoom(byWidth);
	if (mode === "auto") return clampZoom(Math.min(byWidth, AUTO_MAX_ZOOM));
	const tallest = Math.max(...pages.map((page) => page.height));
	return clampZoom(Math.min(byWidth, room(viewport.height) / tallest));
}

/**
 * Next preset above (direction 1) or below (-1) the current zoom. Steps
 * from wherever a fit mode left the zoom, not from the nearest preset, so
 * zooming in always gets bigger.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
	/** Treat zooms within a hair of a preset as that preset. */
	const EPSILON = 0.001;
	if (direction === 1) {
		return ZOOM_STEPS.find((step) => step > current + EPSILON) ?? MAX_ZOOM;
	}
	return (
		[...ZOOM_STEPS].reverse().find((step) => step < current - EPSILON) ??
		MIN_ZOOM
	);
}

/** Device pixels per point to render at: sharp on retina, bounded in memory. */
export function renderScale(
	zoom: number,
	page: PageSize,
	devicePixelRatio: number,
): number {
	/** Retina is sharp at 2; going higher multiplies WASM memory for little gain. */
	const MAX_PIXEL_RATIO = 2;
	/** About a 4K screen's worth of pixels; bigger PNGs make renders crawl. */
	const MAX_RENDER_PIXELS = 16_000_000;
	const scale = zoom * Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO);
	const limit = Math.sqrt(MAX_RENDER_PIXELS / (page.width * page.height));
	return Math.min(scale, limit);
}
