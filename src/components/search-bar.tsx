import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton, Panel, Spinner } from "./ui";

/** Wait this long after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 250;

type SearchBarProps = {
	/** null while no search has run for the current text. */
	count: number | null;
	index: number;
	searching: boolean;
	onSearch: (query: string) => void;
	onStep: (direction: 1 | -1) => void;
	onClose: () => void;
};

/**
 * Find-in-document panel. Searches as you type; Enter and Shift+Enter step
 * through the matches, Escape closes.
 */
export function SearchBar({
	count,
	index,
	searching,
	onSearch,
	onStep,
	onClose,
}: SearchBarProps) {
	const [query, setQuery] = useState("");
	const field = useRef<HTMLInputElement>(null);
	const searched = useRef("");

	useEffect(() => field.current?.focus(), []);

	useEffect(() => {
		if (query === searched.current) return;
		const timer = setTimeout(() => {
			searched.current = query;
			onSearch(query);
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, onSearch]);

	const status =
		query.trim() === "" || count === null
			? ""
			: count === 0
				? "No matches"
				: `${index + 1} of ${count}`;

	return (
		<Panel className="absolute top-3 right-3 z-40 flex items-center gap-1 p-1.5 pl-3">
			<Search size={16} className="shrink-0 text-ink-soft" aria-hidden />
			<input
				ref={field}
				type="text"
				aria-label="Find in document"
				placeholder="Find in document"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						if (query !== searched.current) {
							searched.current = query;
							onSearch(query);
						} else onStep(event.shiftKey ? -1 : 1);
					}
					if (event.key === "Escape") {
						event.stopPropagation();
						onClose();
					}
				}}
				className="h-8 w-40 bg-transparent text-ink text-sm outline-none placeholder:text-ink-soft/70 sm:w-56"
			/>
			<span
				role="status"
				aria-live="polite"
				className="min-w-16 text-right text-ink-soft text-xs tabular-nums"
			>
				{searching ? <Spinner className="size-3 border-[1.5px]" /> : status}
			</span>
			<IconButton
				icon={ChevronUp}
				label="Previous match"
				size="sm"
				disabled={!count}
				onClick={() => onStep(-1)}
			/>
			<IconButton
				icon={ChevronDown}
				label="Next match"
				size="sm"
				disabled={!count}
				onClick={() => onStep(1)}
			/>
			<IconButton icon={X} label="Close search" size="sm" onClick={onClose} />
		</Panel>
	);
}
