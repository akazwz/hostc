import { createSignal, onSettled } from "solid-js";

import { t } from "../i18n.ts";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";

// Copies text. It says so for a moment afterwards, in its own label so a screen reader hears it too.
export function CopyButton(props: { text: string }) {
	const [copied, setCopied] = createSignal(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	onSettled(() => () => clearTimeout(timer));
	return (
		<Button
			variant="ghost"
			size="sm"
			icon
			aria-label={copied() ? t.copied : t.copy}
			data-tip={t.copy}
			onClick={() => {
				void navigator.clipboard?.writeText(props.text).then(() => {
					setCopied(true);
					clearTimeout(timer);
					timer = setTimeout(() => setCopied(false), 1500);
				});
			}}
		>
			<Icon name={copied() ? "check" : "copy"} />
		</Button>
	);
}
