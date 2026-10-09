import { useEffect, useRef, useState } from "react";

import type { EditorClient } from "../lib/editor-client";
import type { PageSize } from "../lib/protocol";

/** Thumbnail width in CSS pixels. */
const THUMB_WIDTH_PX = 132;
/** Thumbnails are small; twice their CSS size is sharp on any screen. */
const THUMB_PIXEL_RATIO = 2;
/** Start rendering thumbnails a little before they scroll into view. */
const THUMB_PRELOAD_MARGIN = "300px";

type PageSidebarProps = {
	client: EditorClient;
	pages: PageSize[];
	renderKeys: string[];
	current: number;
	onGoTo: (page: number) => void;
};

/**
 * Page thumbnails for overview and navigation. Each thumbnail renders the
 * full page (added items included) only when scrolled near, and again when
 * its page changes.
 */
export function PageSidebar({
	client,
	pages,
	renderKeys,
	current,
	onGoTo,
}: PageSidebarProps) {
	const list = useRef<HTMLElement>(null);

	/** Keep the current page's thumbnail in view as the document scrolls. */
	useEffect(() => {
		const item = list.current?.querySelector<HTMLElement>(
			`[data-page="${current}"]`,
		);
		item?.scrollIntoView({ block: "nearest" });
	}, [current]);

	return (
		<aside
			ref={list}
			aria-label="Pages"
			className="flex w-[11.5rem] shrink-0 flex-col items-center gap-4 overflow-y-auto border-line border-r bg-white px-4 py-5"
		>
			{pages.map((size, index) => (
				<button
					key={index}
					type="button"
					data-page={index}
					aria-label={`Go to page ${index + 1}`}
					aria-current={index === current ? "page" : undefined}
					onClick={() => onGoTo(index)}
					className="group flex flex-col items-center gap-1.5 focus-visible:outline-none"
				>
					<Thumbnail
						client={client}
						index={index}
						size={size}
						renderKey={renderKeys[index] ?? ""}
						active={index === current}
					/>
					<span
						className={`text-xs tabular-nums ${index === current ? "font-semibold text-primary-ink" : "text-ink-soft"}`}
					>
						{index + 1}
					</span>
				</button>
			))}
		</aside>
	);
}

function Thumbnail({
	client,
	index,
	size,
	renderKey,
	active,
}: {
	client: EditorClient;
	index: number;
	size: PageSize;
	renderKey: string;
	active: boolean;
}) {
	const box = useRef<HTMLSpanElement>(null);
	const [visible, setVisible] = useState(false);
	const [image, setImage] = useState<string | null>(null);
	const renderedKey = useRef<string | null>(null);
	const height = (size.height / size.width) * THUMB_WIDTH_PX;

	useEffect(() => {
		const node = box.current;
		if (!node) return;
		const observer = new IntersectionObserver(
			([entry]) => setVisible(entry.isIntersecting),
			{ rootMargin: THUMB_PRELOAD_MARGIN },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const key = `${renderKey}:${size.width}x${size.height}`;
		if (!visible || renderedKey.current === key) return;
		let cancelled = false;
		const scale = (THUMB_WIDTH_PX / size.width) * THUMB_PIXEL_RATIO;
		client
			.request({ type: "render", page: index, scale, hideItems: false })
			.then(({ png }) => {
				if (cancelled) return;
				const url = URL.createObjectURL(
					new Blob([png as BlobPart], { type: "image/png" }),
				);
				setImage((previous) => {
					if (previous) URL.revokeObjectURL(previous);
					return url;
				});
				renderedKey.current = key;
			})
			/** A missing thumbnail is not worth an error message. */
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [client, index, size, renderKey, visible]);

	useEffect(
		() => () => {
			if (image) URL.revokeObjectURL(image);
		},
		[image],
	);

	return (
		<span
			ref={box}
			className={`block overflow-hidden rounded-md bg-white transition-shadow ${
				active
					? "ring-2 ring-primary ring-offset-2"
					: "ring-1 ring-line group-hover:ring-line-strong group-focus-visible:ring-2 group-focus-visible:ring-primary"
			}`}
			style={{ width: THUMB_WIDTH_PX, height }}
		>
			{image && (
				<img src={image} alt="" className="block size-full" draggable={false} />
			)}
		</span>
	);
}
