import * as stylex from "@stylexjs/stylex";
import { onSettled } from "solid-js";

import { color, motion, radius, space, text } from "./tokens.stylex.ts";

const SHOW_AFTER_MS = 450;
const GAP = 6;

const styles = stylex.create({
	tip: {
		position: "fixed",
		inset: "auto",
		margin: 0,
		maxWidth: "20rem",
		paddingBlock: space.xs,
		paddingInline: space.sm,
		borderWidth: 0,
		borderRadius: radius.xs,
		backgroundColor: color.text,
		color: color.bg,
		fontSize: text.xs,
		lineHeight: 1.35,
		pointerEvents: "none",
		opacity: { default: 0, ":popover-open": { default: 1, "@starting-style": 0 } },
		transitionDuration: motion.quick,
		transitionProperty: "opacity",
	},
});

// The one hint layer of the page: a control says `data-tip="…"`. The native `title` waits a second,
// never shows for the keyboard and cannot be styled. Touch screens get no hints, as there is no hover.
export function TooltipLayer() {
	let tip: HTMLDivElement | undefined;
	const show = (target: HTMLElement) => {
		if (!tip) {
			return;
		}
		tip.textContent = target.dataset.tip ?? "";
		tip.showPopover();
		const anchor = target.getBoundingClientRect();
		const box = tip.getBoundingClientRect();
		const above = anchor.top - box.height - GAP;
		tip.style.top = `${above >= 8 ? above : anchor.bottom + GAP}px`;
		tip.style.left = `${Math.min(Math.max(8, anchor.left + anchor.width / 2 - box.width / 2), innerWidth - box.width - 8)}px`;
	};
	const focus = (event: Event) => {
		const target = (event.target as Element | null)?.closest?.<HTMLElement>("[data-tip]");
		if (target?.matches(":focus-visible")) {
			show(target);
		}
	};
	onSettled(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const hide = () => {
			clearTimeout(timer);
			if (tip?.matches(":popover-open")) {
				tip.hidePopover();
			}
		};
		const over = (event: Event) => {
			if (matchMedia("(hover: none)").matches) {
				return;
			}
			const target = (event.target as Element | null)?.closest?.<HTMLElement>("[data-tip]");
			hide();
			if (target) {
				timer = setTimeout(() => show(target), SHOW_AFTER_MS);
			}
		};
		document.addEventListener("pointerover", over, true);
		document.addEventListener("focusin", focus, true);
		document.addEventListener("focusout", hide, true);
		document.addEventListener("pointerdown", hide, true);
		document.addEventListener("scroll", hide, true);
		return () => {
			hide();
			document.removeEventListener("pointerover", over, true);
			document.removeEventListener("focusin", focus, true);
			document.removeEventListener("focusout", hide, true);
			document.removeEventListener("pointerdown", hide, true);
			document.removeEventListener("scroll", hide, true);
		};
	});
	return (
		<div
			ref={(element) => {
				tip = element;
			}}
			popover="manual"
			role="tooltip"
			{...stylex.attrs(styles.tip)}
		/>
	);
}
