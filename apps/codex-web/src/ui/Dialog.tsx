import * as stylex from "@stylexjs/stylex";
import { createEffect, type ParentProps, Show, createUniqueId } from "solid-js";

import { color, media, radius, shadow, space, text } from "./tokens.stylex.ts";

const styles = stylex.create({
	dialog: {
		width: { default: "min(26rem, calc(100vw - 2rem))", [media.narrow]: "100%" },
		maxWidth: { default: "none", [media.narrow]: "100%" },
		margin: { default: "auto", [media.narrow]: "auto 0 0" },
		padding: 0,
		overflow: "clip",
		borderWidth: 0,
		borderRadius: { default: radius.lg, [media.narrow]: `${radius.xl} ${radius.xl} 0 0` },
		backgroundColor: color.overlay,
		boxShadow: shadow.float,
		color: color.text,
		"::backdrop": { backgroundColor: color.scrim },
	},
	body: {
		display: "flex",
		flexDirection: "column",
		gap: space.md,
		padding: space.xl,
		paddingBlockEnd: { default: space.xl, [media.narrow]: `max(${space.xl}, env(safe-area-inset-bottom))` },
	},
	title: { margin: 0, fontSize: text.md, fontWeight: 600 },
	hint: { margin: 0, color: color.muted, fontSize: text.sm },
});

// A modal question. The native <dialog> traps focus, handles Esc and blocks the page behind it.
export function Dialog(props: ParentProps<{ open: boolean; title: string; hint?: string; onClose: () => void }>) {
	let element: HTMLDialogElement | undefined;
	const titleId = createUniqueId();
	createEffect(
		() => props.open,
		(open) => {
			if (open) {
				element?.showModal();
			} else {
				element?.close();
			}
		},
	);
	return (
		<dialog
			aria-labelledby={titleId}
			ref={(node) => {
				element = node;
			}}
			{...stylex.attrs(styles.dialog)}
			onClose={() => props.onClose()}
		>
			<div {...stylex.attrs(styles.body)}>
				<h2 id={titleId} {...stylex.attrs(styles.title)}>
					{props.title}
				</h2>
				<Show when={props.hint}>{(hint) => <p {...stylex.attrs(styles.hint)}>{hint()}</p>}</Show>
				{props.children}
			</div>
		</dialog>
	);
}
