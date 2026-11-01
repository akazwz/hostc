import * as stylex from "@stylexjs/stylex";
import { createSignal, For } from "solid-js";

import { base } from "../ui/base.ts";
import { Button } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { Disclosure, DisclosureButton } from "../ui/Disclosure.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { TextInput } from "../ui/Field.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Menu, MenuHeading, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import { Ring } from "../ui/Ring.tsx";
import { Dot, Skeleton, Spinner } from "../ui/Spinner.tsx";
import { Steps } from "../ui/Steps.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import { color, font, space, text } from "../ui/tokens.stylex.ts";
import { TooltipLayer } from "../ui/Tooltip.tsx";

const styles = stylex.create({
	page: {
		display: "flex",
		flexDirection: "column",
		gap: space.xxl,
		maxWidth: "52rem",
		marginInline: "auto",
		padding: space.xl,
	},
	section: { display: "flex", flexDirection: "column", gap: space.md },
	title: { margin: 0, color: color.faint, fontSize: text.sm, fontWeight: 500 },
	row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.sm },
	stack: { display: "flex", flexDirection: "column", gap: space.sm },
	swatch: {
		display: "flex",
		alignItems: "flex-end",
		width: "6rem",
		height: "3.5rem",
		padding: space.xs,
		borderRadius: "0.5rem",
		boxShadow: `inset 0 0 0 1px ${color.line}`,
		fontSize: text.xs,
	},
	canvas: { backgroundColor: color.canvas },
	bg: { backgroundColor: color.bg },
	surface: { backgroundColor: color.surface },
	raised: { backgroundColor: color.raised },
	overlay: { backgroundColor: color.overlay },
	accent: { backgroundColor: color.accent, color: color.onAccent },
	display: { fontSize: text.display, fontWeight: 600, letterSpacing: "-0.02em" },
	lg: { fontSize: text.lg, fontWeight: 600 },
	read: { fontSize: text.read },
	md: { fontSize: text.md },
	sm: { fontSize: text.sm, color: color.muted },
	xs: { fontSize: text.xs, color: color.faint },
	mono: { fontFamily: font.mono, fontSize: text.xs },
	field: { maxWidth: "20rem" },
});

const ICONS: IconName[] = [
	"arrowUp",
	"stop",
	"plus",
	"back",
	"chevronDown",
	"chevronRight",
	"close",
	"check",
	"more",
	"search",
	"copy",
	"folder",
	"file",
	"branch",
	"diff",
	"bolt",
	"shield",
	"image",
	"at",
	"spark",
	"list",
	"fork",
	"undo",
	"warn",
	"bell",
	"panel",
	"archive",
	"pencil",
	"compress",
	"eye",
	"terminal",
	"account",
	"goal",
];

// Every base component in every state, in one place. Look here when changing `src/ui`.
export default function Design() {
	const [tab, setTab] = createSignal<"a" | "b">("a");
	const [on, setOn] = createSignal(true);
	const [step, setStep] = createSignal(1);
	return (
		<main {...stylex.attrs(styles.page)}>
			<section {...stylex.attrs(styles.section)}>
				<h2 {...stylex.attrs(styles.title)}>Levels</h2>
				<div {...stylex.attrs(styles.row)}>
					<div {...stylex.attrs(styles.swatch, styles.canvas)}>canvas</div>
					<div {...stylex.attrs(styles.swatch, styles.bg)}>bg</div>
					<div {...stylex.attrs(styles.swatch, styles.surface)}>surface</div>
					<div {...stylex.attrs(styles.swatch, styles.raised)}>raised</div>
					<div {...stylex.attrs(styles.swatch, styles.overlay)}>overlay</div>
					<div {...stylex.attrs(styles.swatch, styles.accent)}>accent</div>
				</div>
			</section>
			<section {...stylex.attrs(styles.section)}>
				<h2 {...stylex.attrs(styles.title)}>Type</h2>
				<div {...stylex.attrs(styles.stack)}>
					<span {...stylex.attrs(styles.display)}>Display, the one heading of a page</span>
					<span {...stylex.attrs(styles.lg)}>Large, a heading in a message</span>
					<span {...stylex.attrs(styles.read)}>Read, what an agent says and what a person asks</span>
					<span {...stylex.attrs(styles.md)}>Medium, the interface and the work</span>
					<span {...stylex.attrs(styles.sm)}>Small, supporting detail</span>
					<span {...stylex.attrs(styles.xs)}>Extra small, metadata</span>
					<span {...stylex.attrs(styles.mono)}>$ pnpm test --coverage, anything a machine runs or reads</span>
				</div>
			</section>
			<section {...stylex.attrs(styles.section)}>
				<h2 {...stylex.attrs(styles.title)}>Buttons</h2>
				<For each={["sm", "md", "lg"] as const}>
					{(size) => (
						<div {...stylex.attrs(styles.row)}>
							<Button size={size} variant="solid">
								Allow
							</Button>
							<Button size={size}>Allow for session</Button>
							<Button size={size} variant="ghost">
								Decline and stop
							</Button>
							<Button size={size} variant="solid" disabled>
								Disabled
							</Button>
							<Button size={size} disabled>
								Disabled
							</Button>
							<Button size={size} variant="ghost" icon aria-label="Copy" data-tip="Copy">
								<Icon name="copy" />
							</Button>
							<Button size={size} variant="strong" icon round aria-label="Send">
								<Icon name="arrowUp" />
							</Button>
							<Button size={size} variant="strong" icon round aria-label="Stop">
								<Icon name="stop" small />
							</Button>
						</div>
					)}
				</For>
				<div {...stylex.attrs(styles.row)}>
					<Button
						variant="ghost"
						on={on()}
						aria-pressed={on() ? "true" : "false"}
						onClick={() => setOn((value) => !value)}
					>
						<Icon name="bolt" />
						Toggle
					</Button>
					<Menu
						label="Menu"
						trigger={
							<>
								Menu <Icon name="chevronDown" small />
							</>
						}
					>
						<MenuHeading>Heading</MenuHeading>
						<MenuItem label="Checked" description="With a description" checked onSelect={() => undefined} />
						<MenuItem label="Not checked" checked={false} onSelect={() => undefined} />
						<MenuSeparator />
						<MenuItem label="With an icon" icon={<Icon name="fork" />} onSelect={() => undefined} />
						<MenuItem label="Disabled" disabled onSelect={() => undefined} />
					</Menu>
					<Tabs
						label="Tabs"
						value={tab()}
						options={[
							{ value: "a", label: "Last turn" },
							{ value: "b", label: "Branch" },
						]}
						onChange={setTab}
					/>
				</div>
			</section>
			<section {...stylex.attrs(styles.section)}>
				<h2 {...stylex.attrs(styles.title)}>Marks</h2>
				<div {...stylex.attrs(styles.row)}>
					<Dot tone="live" />
					<Dot tone="attention" />
					<Dot tone="done" />
					<Dot tone="failed" />
					<Spinner />
					<Ring percent={36} />
					<Ring percent={90} />
				</div>
				<div {...stylex.attrs(styles.row)}>
					<For each={ICONS}>{(name) => <Icon name={name} />}</For>
				</div>
			</section>
			<section {...stylex.attrs(styles.section)}>
				<h2 {...stylex.attrs(styles.title)}>Blocks</h2>
				<Card pad>Inset card</Card>
				<Card pad tone="raised">
					Raised card
				</Card>
				<Disclosure summary="Disclosure, closed">Folded content</Disclosure>
				<DisclosureButton open={false} onToggle={() => undefined}>
					Disclosure button
				</DisclosureButton>
				<Disclosure summary="Disclosure, open" open>
					Folded content
				</Disclosure>
				<div {...stylex.attrs(styles.field)}>
					<TextInput placeholder="Text input" aria-label="Text input" />
				</div>
				<div {...stylex.attrs(styles.field)}>
					<Steps label="Steps" value={step()} count={6} valueText={String(step())} onChange={setStep} />
				</div>
				<div {...stylex.attrs(styles.row)}>
					<input
						type="radio"
						name="sample"
						checked
						aria-label="Radio, on"
						{...stylex.attrs(base.radio, base.focusRing)}
					/>
					<input type="radio" name="sample" aria-label="Radio, off" {...stylex.attrs(base.radio, base.focusRing)} />
					<input type="checkbox" checked aria-label="Checkbox, on" {...stylex.attrs(base.checkbox, base.focusRing)} />
					<input type="checkbox" aria-label="Checkbox, off" {...stylex.attrs(base.checkbox, base.focusRing)} />
				</div>
				<div {...stylex.attrs(styles.stack)}>
					<Skeleton width="medium" />
					<Skeleton />
					<Skeleton width="short" />
				</div>
				<EmptyState title="Nothing here yet" hint="What to do about it." />
			</section>
			<TooltipLayer />
		</main>
	);
}
