import { currentLocale, UI } from "../i18n.ts";

/** A command to run, with a button that copies it. public/copy.js shows and wires the button. */
export function Command(props: { children: string }) {
	const ui = UI[currentLocale()];
	return (
		<div class="command">
			<span aria-hidden="true">$</span>
			<code>{props.children}</code>
			<button type="button" hidden data-copy={props.children} data-copied={ui.copied}>
				{ui.copy}
			</button>
		</div>
	);
}
