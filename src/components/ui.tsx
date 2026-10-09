import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Icon size used across bars, in CSS pixels. */
export const ICON_SIZE = 18;
export const SMALL_ICON_SIZE = 16;

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	icon: LucideIcon;
	label: string;
	/** Shown next to the icon from the `sm` breakpoint up. */
	showLabel?: boolean;
	active?: boolean;
	size?: "md" | "sm";
};

/**
 * Square-ish icon button with an accessible name and a tooltip. Active
 * buttons (the current tool, a toggled style) get the brand wash.
 */
export function IconButton({
	icon: Icon,
	label,
	showLabel = false,
	active = false,
	size = "md",
	className = "",
	...rest
}: IconButtonProps) {
	const iconSize = size === "sm" ? SMALL_ICON_SIZE : ICON_SIZE;
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={rest["aria-pressed"] ?? (active || undefined)}
			className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-35 ${
				size === "sm" ? "h-8 min-w-8 px-1.5" : "h-9 min-w-9 px-2"
			} ${
				active
					? "bg-primary-wash text-primary-ink"
					: "text-ink-soft hover:bg-ground hover:text-ink"
			} ${className}`}
			{...rest}
		>
			<Icon size={iconSize} strokeWidth={1.9} aria-hidden />
			{showLabel && <span className="hidden lg:inline">{label}</span>}
		</button>
	);
}

/** Thin vertical rule between button groups. */
export function Divider() {
	return <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-line" />;
}

/** Floating white panel used by popovers and contextual bars. */
export function Panel({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`rounded-xl border border-line bg-white shadow-[0_4px_12px_rgb(23_32_51/0.1),0_1px_3px_rgb(23_32_51/0.08)] ${className}`}
		>
			{children}
		</div>
	);
}

/** Small spinner for busy states. */
export function Spinner({ className = "" }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
		/>
	);
}
