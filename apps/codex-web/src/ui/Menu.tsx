import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createUniqueId, type ParentProps, Show } from "solid-js";

import { base } from "./base.ts";
import { Icon } from "./Icon.tsx";
import { color, control, media, motion, radius, shadow, space, text } from "./tokens.stylex.ts";

const LINE = "1.125rem";

const styles = stylex.create({
	trigger: {
		display: "inline-flex",
		alignItems: "center",
		gap: "0.3125rem",
		flexShrink: 0,
		justifyContent: "center",
		minWidth: control.md,
		minHeight: control.md,
		paddingInline: space.sm,
		borderWidth: 0,
		borderRadius: radius.full,
		backgroundColor: {
			default: "transparent",
			[media.hover]: { default: "transparent", ":hover": color.hover },
			":active": color.press,
			":popover-open": color.selected,
		},
		color: { default: color.muted, [media.hover]: { default: color.muted, ":hover": color.text } },
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: text.sm,
		fontWeight: 500,
		whiteSpace: "nowrap",
		transitionDuration: motion.quick,
		transitionProperty: "background-color, color",
		WebkitTapHighlightColor: "transparent",
	},
	// On a phone a menu is a sheet at the bottom, within reach of a thumb.
	panel: {
		position: "fixed",
		inset: {
			default: "auto",
			[media.narrow]: "auto 0 0 0",
		},
		width: { default: "max-content", [media.narrow]: "100%" },
		minWidth: { default: "13rem", [media.narrow]: "100%" },
		maxWidth: { default: "22rem", [media.narrow]: "100%" },
		maxHeight: { default: "min(70dvh, 28rem)", [media.narrow]: "70dvh" },
		margin: 0,
		padding: "0.375rem",
		paddingBlockEnd: { default: "0.375rem", [media.narrow]: `max(${space.sm}, env(safe-area-inset-bottom))` },
		overflowY: "auto",
		borderWidth: 0,
		borderRadius: { default: radius.lg, [media.narrow]: `${radius.xl} ${radius.xl} 0 0` },
		backgroundColor: color.overlay,
		boxShadow: shadow.float,
		opacity: { default: 0, ":popover-open": { default: 1, "@starting-style": 0 } },
		translate: {
			default: "0 0",
			":popover-open": { default: "0 0", "@starting-style": { default: "0 -0.25rem", [media.narrow]: "0 100%" } },
		},
		transitionDuration: motion.move,
		transitionProperty: "opacity, translate",
		transitionTimingFunction: motion.ease,
		color: color.text,
		"::backdrop": { backgroundColor: { default: "transparent", [media.narrow]: color.scrim } },
	},
	item: {
		display: "flex",
		alignItems: "flex-start",
		gap: space.sm,
		width: "100%",
		minHeight: control.md,
		// Centers one line in the row; with a description below, the row grows and the icon stays on the first line.
		paddingBlock: `calc((${control.md} - ${LINE}) / 2)`,
		paddingInline: space.sm,
		borderWidth: 0,
		borderRadius: radius.sm,
		backgroundColor: {
			default: "transparent",
			[media.hover]: { default: "transparent", ":hover": { default: color.hover, ":disabled": "transparent" } },
		},
		color: { default: color.text, ":disabled": color.muted },
		cursor: { default: "pointer", ":disabled": "default" },
		fontFamily: "inherit",
		fontSize: text.sm,
		textAlign: "start",
		opacity: { default: 1, ":disabled": 0.5 },
	},
	itemBody: { display: "flex", flexDirection: "column", flexGrow: 1, gap: "0.0625rem", minWidth: 0, lineHeight: LINE },
	// As tall as the first line of text, so that what is in it sits on that line.
	itemMark: { display: "flex", alignItems: "center", flexShrink: 0, height: LINE },
	description: { color: color.muted, fontSize: text.xs, lineHeight: 1.3 },
	check: { display: "flex", alignItems: "center", flexShrink: 0, height: LINE, color: color.text },
	heading: {
		margin: 0,
		paddingBlock: space.xs,
		paddingInline: space.sm,
		color: color.muted,
		fontSize: text.xs,
		fontWeight: 500,
	},
	separator: {
		height: "1px",
		marginBlock: space.xs,
		marginInline: space.sm,
		borderWidth: 0,
		backgroundColor: color.line,
	},
	fill: { flexGrow: 1 },
});

function place(trigger: HTMLElement, panel: HTMLElement, alignEnd: boolean) {
	if (matchMedia("(max-width: 767px)").matches) {
		panel.style.left = "";
		panel.style.top = "";
		panel.style.bottom = "";
		return;
	}
	const anchor = trigger.getBoundingClientRect();
	const box = panel.getBoundingClientRect();
	const gap = 6;
	const start = alignEnd ? anchor.right - box.width : anchor.left;
	const left = Math.min(Math.max(8, start), innerWidth - box.width - 8);
	// Below if it fits or there is more room there, otherwise above.
	const below = anchor.bottom + gap + box.height <= innerHeight - 8 || anchor.top < box.height + gap + 8;
	panel.style.left = `${left}px`;
	// Held by the edge nearest the trigger, so that a panel whose content grows grows away from it.
	panel.style.top = below ? `${anchor.bottom + gap}px` : "auto";
	panel.style.bottom = below ? "auto" : `${innerHeight - anchor.top + gap}px`;
}

const ITEM = "button:not(:disabled)";
const ITEM_CHECKED = `${ITEM}[aria-checked="true"]`;

// The browser closes a popover on a click outside it and still delivers that click to whatever is
// underneath. Closing a menu should not also open the conversation that happened to be under the finger.
function closeOnly(panel: HTMLElement, trigger: HTMLElement) {
	const swallow = (event: MouseEvent) => {
		const target = event.target as Node;
		document.removeEventListener("click", swallow, true);
		if (!panel.contains(target) && !trigger.contains(target)) {
			event.preventDefault();
			event.stopPropagation();
		}
	};
	document.addEventListener("click", swallow, true);
	// Closed some other way, with no click to come.
	const closed = (event: Event) => {
		if ((event as ToggleEvent).newState === "closed") {
			panel.removeEventListener("toggle", closed);
			setTimeout(() => document.removeEventListener("click", swallow, true), 400);
		}
	};
	panel.addEventListener("toggle", closed);
}

function moveFocus(event: KeyboardEvent & { currentTarget: HTMLElement }) {
	const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEM)];
	const index = items.indexOf(document.activeElement as HTMLElement);
	const next =
		event.key === "ArrowDown"
			? items[(index + 1) % items.length]
			: event.key === "ArrowUp"
				? items[(index - 1 + items.length) % items.length]
				: event.key === "Home"
					? items[0]
					: event.key === "End"
						? items.at(-1)
						: undefined;
	if (next) {
		event.preventDefault();
		next.focus();
	}
}

// A button that opens a list of choices. The browser's popover handles the top layer, Esc and a click
// outside, and placement is computed because anchor positioning is not widely available yet.
export function Menu(
	props: ParentProps<{
		label: string;
		// Shown as a hint on hover, when the trigger is only an icon.
		tip?: string;
		trigger: JSX.Element;
		triggerStyle?: stylex.StyleXStyles;
		panelStyle?: stylex.StyleXStyles;
		// Which edge of the trigger the panel lines up with.
		align?: "start" | "end";
	}>,
) {
	const id = createUniqueId();
	let trigger: HTMLButtonElement | undefined;
	return (
		<>
			<button
				type="button"
				ref={(element) => {
					trigger = element;
				}}
				popovertarget={id}
				aria-label={props.label}
				data-tip={props.tip}
				{...stylex.attrs(styles.trigger, base.focusRing, props.triggerStyle)}
			>
				{props.trigger}
			</button>
			<div
				id={id}
				popover="auto"
				role="menu"
				aria-label={props.label}
				{...stylex.attrs(styles.panel, props.panelStyle)}
				onKeyDown={moveFocus}
				onToggle={(event) => {
					if (event.newState === "open" && trigger) {
						place(trigger, event.currentTarget, props.align === "end");
						// Where the keyboard continues; a popover does not move focus by itself.
						const panel = event.currentTarget;
						closeOnly(panel, trigger);
						(panel.querySelector<HTMLElement>(ITEM_CHECKED) ?? panel.querySelector<HTMLElement>(ITEM))?.focus();
					}
				}}
			>
				{props.children}
			</div>
		</>
	);
}

export function MenuHeading(props: ParentProps) {
	return <p {...stylex.attrs(styles.heading)}>{props.children}</p>;
}

export function MenuSeparator() {
	return <hr {...stylex.attrs(styles.separator)} />;
}

// One choice in a menu. Choosing it closes the menu unless `stayOpen` is set.
export function MenuItem(props: {
	label: string;
	description?: string | null | undefined;
	icon?: JSX.Element;
	checked?: boolean;
	disabled?: boolean;
	stayOpen?: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			role={props.checked === undefined ? "menuitem" : "menuitemradio"}
			aria-checked={props.checked === undefined ? undefined : props.checked ? "true" : "false"}
			disabled={props.disabled ?? false}
			{...stylex.attrs(styles.item, base.focusRing)}
			onClick={(event) => {
				if (!props.stayOpen) {
					event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
				}
				props.onSelect();
			}}
		>
			<Show when={props.icon}>
				<span {...stylex.attrs(styles.itemMark)}>{props.icon}</span>
			</Show>
			<span {...stylex.attrs(styles.itemBody)}>
				<span>{props.label}</span>
				<Show when={props.description}>
					{(description) => <span {...stylex.attrs(styles.description)}>{description()}</span>}
				</Show>
			</span>
			<Show when={props.checked}>
				<span {...stylex.attrs(styles.check)}>
					<Icon name="check" small />
				</span>
			</Show>
		</button>
	);
}
