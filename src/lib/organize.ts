/**
 * Page arithmetic for the organizer: which pages a request means, where a
 * move puts them, and how a selection grows. Pure, so the engine and the UI
 * agree on every index and Node tests check it without MuPDF.
 */

/** Distinct page indices inside the document, ascending. */
export function normalizePages(
	indices: readonly number[],
	count: number,
): number[] {
	return [...new Set(indices)]
		.filter((index) => Number.isInteger(index) && index >= 0 && index < count)
		.sort((a, b) => a - b);
}

/**
 * Index the moved block starts at once the pages are taken out.
 * `before` counts in the current order; `count` means "to the end".
 */
export function moveStart(pages: readonly number[], before: number): number {
	return before - pages.filter((page) => page < before).length;
}

/**
 * The document order after moving `indices` before page `before`, as the
 * old index of each page. The moved pages keep their own order.
 */
export function moveOrder(
	count: number,
	indices: readonly number[],
	before: number,
): number[] {
	const pages = normalizePages(indices, count);
	const moved = new Set(pages);
	const rest: number[] = [];
	for (let index = 0; index < count; index++) {
		if (!moved.has(index)) rest.push(index);
	}
	const at = moveStart(pages, Math.max(0, Math.min(before, count)));
	return [...rest.slice(0, at), ...pages, ...rest.slice(at)];
}

/** True when an order leaves every page where it was. */
export function isIdentity(order: readonly number[]): boolean {
	return order.every((page, index) => page === index);
}

/** Where the moved pages end up, so the selection can follow them. */
export function movedPositions(
	count: number,
	indices: readonly number[],
	before: number,
): number[] {
	const moved = new Set(normalizePages(indices, count));
	const positions: number[] = [];
	moveOrder(count, indices, before).forEach((page, position) => {
		if (moved.has(page)) positions.push(position);
	});
	return positions;
}

/**
 * The `before` index that shifts the selected pages one step left (-1) or
 * right (+1) as a block. Null when the block is already at that edge.
 */
export function stepTarget(
	indices: readonly number[],
	direction: -1 | 1,
	count: number,
): number | null {
	const pages = normalizePages(indices, count);
	if (pages.length === 0) return null;
	const first = pages[0];
	const last = pages[pages.length - 1];
	if (direction < 0) return first === 0 ? null : first - 1;
	/** "Before the page after the next one" puts the block one step later. */
	return last === count - 1 ? null : last + 2;
}

/** Every page from the anchor to the clicked page, either way round. */
export function rangeSelection(anchor: number, index: number): number[] {
	const from = Math.min(anchor, index);
	const to = Math.max(anchor, index);
	return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

/** Selected pages remaining after `deleted` are removed, renumbered. */
export function selectionAfterDelete(
	selected: readonly number[],
	deleted: readonly number[],
): number[] {
	const gone = new Set(deleted);
	return selected
		.filter((page) => !gone.has(page))
		.map((page) => page - deleted.filter((d) => d < page).length);
}
