import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";

import type { Harness } from "../harness/model.ts";
import { t } from "../i18n.ts";
import { base } from "../ui/base.ts";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuHeading, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import { Steps } from "../ui/Steps.tsx";
import { color, control, media, motion, radius, space, text } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	// Gives way before the buttons beside it do.
	trigger: { flexShrink: 1, minWidth: 0, minHeight: control.lg, paddingInline: "0.625rem" },
	name: {
		maxWidth: { default: "11rem", [media.narrow]: "7rem" },
		overflow: "hidden",
		color: color.text,
		textOverflow: "ellipsis",
	},
	effort: { flexShrink: 0, color: color.muted, fontWeight: 400 },
	panel: { width: { default: "17.5rem", [media.narrow]: "100%" }, padding: space.sm },
	// The model, and the way to change it.
	current: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		gap: "0.3125rem",
		width: "100%",
		minHeight: control.md,
		borderWidth: 0,
		borderRadius: radius.sm,
		backgroundColor: { default: "transparent", [media.hover]: { default: "transparent", ":hover": color.hover } },
		color: color.text,
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: text.md,
		fontWeight: 500,
	},
	chevron: {
		display: "flex",
		color: color.muted,
		transitionDuration: motion.move,
		transitionProperty: "transform",
		transitionTimingFunction: motion.ease,
	},
	chevronOpen: { transform: "rotate(90deg)" },
	steps: { paddingBlock: space.sm, paddingInline: space.xxs },
	list: { paddingBlockEnd: space.xs },
});

const effortName = (effort: string) => t.efforts[effort] ?? effort;

// Which model, and how hard it thinks. How hard is what changes from one request to the next, so it is
// the first thing here and one drag away; the models are one step further in.
export function ModelPicker(props: { harness: Harness }) {
	const [listing, setListing] = createSignal(false);
	let current: HTMLButtonElement | undefined;
	const efforts = () => props.harness.model()?.efforts ?? [];
	const level = () => Math.max(0, efforts().indexOf(props.harness.effort() ?? ""));
	return (
		<Show when={props.harness.model()}>
			{(model) => (
				<Menu
					label={t.model}
					align="end"
					triggerStyle={styles.trigger}
					panelStyle={styles.panel}
					trigger={
						<>
							<span {...stylex.attrs(styles.name)}>{model().name}</span>
							<Show when={props.harness.effort()}>
								{(effort) => <span {...stylex.attrs(styles.effort)}>{effortName(effort())}</span>}
							</Show>
							<Icon name="chevronDown" small />
						</>
					}
				>
					<button
						ref={(element) => {
							current = element;
						}}
						type="button"
						aria-expanded={listing() ? "true" : "false"}
						{...stylex.attrs(styles.current, base.focusRing)}
						onClick={() => setListing((open) => !open)}
					>
						<span>{model().name}</span>
						<Show when={props.harness.effort()}>
							{(effort) => <span {...stylex.attrs(styles.effort)}>{effortName(effort())}</span>}
						</Show>
						<span {...stylex.attrs(styles.chevron, listing() && styles.chevronOpen)}>
							<Icon name="chevronRight" small />
						</span>
					</button>
					<Show when={listing()}>
						<div {...stylex.attrs(styles.list)}>
							<MenuHeading>{t.model}</MenuHeading>
							<For each={props.harness.models()}>
								{(option) => (
									<MenuItem
										label={option.name}
										description={option.description}
										checked={option.id === model().id}
										stayOpen
										onSelect={() => {
											props.harness.setModel(option.id);
											setListing(false);
											// The chosen row is about to go, with the keyboard on it.
											current?.focus();
										}}
									/>
								)}
							</For>
						</div>
					</Show>
					<Show when={efforts().length > 1}>
						<div {...stylex.attrs(styles.steps)}>
							<Steps
								label={t.effort}
								value={level()}
								count={efforts().length}
								valueText={effortName(efforts()[level()] ?? "")}
								onChange={(value) => {
									const next = efforts()[value];
									if (next) {
										props.harness.setEffort(next);
									}
								}}
							/>
						</div>
					</Show>
					<Show when={model().fast}>
						<MenuSeparator />
						<MenuItem
							label={t.fast}
							description={t.fastHint}
							icon={<Icon name="bolt" />}
							checked={props.harness.fast()}
							stayOpen
							onSelect={() => props.harness.setFast(!props.harness.fast())}
						/>
					</Show>
				</Menu>
			)}
		</Show>
	);
}
