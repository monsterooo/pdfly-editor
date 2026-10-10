/**
 * Which app the page shows. The host picks it with `?mode=` on the frame
 * URL, so one deployed editor serves both the editor and the organizer.
 */
export type AppMode = "edit" | "organize";

export function appMode(search: string): AppMode {
	return new URLSearchParams(search).get("mode") === "organize"
		? "organize"
		: "edit";
}
