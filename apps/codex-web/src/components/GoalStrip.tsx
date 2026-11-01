import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";

import type { Goal, Harness } from "../harness/model.ts";
import { compactNumber, duration, t } from "../i18n.ts";
import { base } from "../ui/base.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuHeading, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import { color, control, media, radius, space, text } from "../ui/tokens.stylex.ts";

const LIMITS = [100_000, 500_000, 1_000_000, 5_000_000];

const styles = stylex.create({
	root: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		minHeight: "2.5rem",
		paddingBlock: space.xxs,
		paddingInlineStart: space.md,
		paddingInlineEnd: space.xs,
		borderRadius: radius.md,
		backgroundColor: color.surface,
	},
	mark: { display: "flex", flexShrink: 0, color: color.muted },
	body: { display: "flex", flexDirection: "column", flexGrow: 1, gap: "0.0625rem", minWidth: 0 },
	objective: {
		display: "block",
		width: "100%",
		padding: 0,
		overflow: "hidden",
		borderWidth: 0,
		backgroundColor: "transparent",
		color: color.text,
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: text.sm,
		lineHeight: 1.4,
		textAlign: "start",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	whole: { overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
	meta: { color: color.faint, fontSize: text.xs, fontVariantNumeric: "tabular-nums" },
	warn: { color: color.removed },
	limitTrigger: { minHeight: control.md, paddingInline: 0, width: control.md },
	pauseText: { display: { default: "inline", [media.narrow]: "none" } },
});

function usage(goal: Goal): string {
	const tokens = goal.tokenBudget
		? `${compactNumber(goal.tokensUsed)} / ${compactNumber(goal.tokenBudget)}`
		: compactNumber(goal.tokensUsed);
	return [
		t.goalStatus[goal.status],
		goal.seconds > 0 ? duration(goal.seconds * 1000) : "",
		goal.tokensUsed > 0 || goal.tokenBudget ? tokens : "",
	]
		.filter(Boolean)
		.join(" · ");
}

// A goal keeps working by itself, run after run. So what it is, what it has used, and how to stop it
// are always in view, right above the input.
export function GoalStrip(props: { harness: Harness; id: string; goal: Goal }) {
	const [whole, setWhole] = createSignal(false);
	const stoppable = () => props.goal.status === "active";
	const resumable = () => props.goal.status === "paused" || props.goal.status === "blocked";
	return (
		<section aria-label={t.goal} {...stylex.attrs(styles.root)}>
			<span {...stylex.attrs(styles.mark)}>
				<Icon name="goal" />
			</span>
			<div {...stylex.attrs(styles.body)}>
				<button
					type="button"
					aria-expanded={whole() ? "true" : "false"}
					{...stylex.attrs(styles.objective, base.focusRing, whole() && styles.whole)}
					onClick={() => setWhole((own) => !own)}
				>
					{props.goal.objective}
				</button>
				<span
					{...stylex.attrs(
						styles.meta,
						(props.goal.status === "blocked" ||
							props.goal.status === "usageLimited" ||
							props.goal.status === "budgetLimited") &&
							styles.warn,
					)}
				>
					{usage(props.goal)}
				</span>
			</div>
			<Show when={stoppable()}>
				<Button variant="ghost" aria-label={t.pause} onClick={() => void props.harness.pauseGoal(props.id, true)}>
					<Icon name="pause" />
					<span {...stylex.attrs(styles.pauseText)}>{t.pause}</span>
				</Button>
			</Show>
			<Show when={resumable()}>
				<Button variant="ghost" aria-label={t.resume} onClick={() => void props.harness.pauseGoal(props.id, false)}>
					<Icon name="play" />
					<span {...stylex.attrs(styles.pauseText)}>{t.resume}</span>
				</Button>
			</Show>
			<Menu
				label={t.goalActions}
				tip={t.goalActions}
				align="end"
				triggerStyle={styles.limitTrigger}
				trigger={<Icon name="more" />}
			>
				<MenuHeading>{t.tokenLimit}</MenuHeading>
				<MenuItem
					label={t.noLimit}
					checked={props.goal.tokenBudget === null}
					onSelect={() => void props.harness.limitGoal(props.id, null)}
				/>
				<For each={LIMITS}>
					{(limit) => (
						<MenuItem
							label={compactNumber(limit)}
							checked={props.goal.tokenBudget === limit}
							onSelect={() => void props.harness.limitGoal(props.id, limit)}
						/>
					)}
				</For>
				<MenuSeparator />
				<MenuItem
					label={t.clearGoal}
					icon={<Icon name="close" />}
					onSelect={() => void props.harness.clearGoal(props.id)}
				/>
			</Menu>
		</section>
	);
}
