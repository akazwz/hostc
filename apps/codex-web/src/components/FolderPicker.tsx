import * as stylex from "@stylexjs/stylex";
import { createEffect, createSignal, For, Show } from "solid-js";

import { folderName } from "../harness/folder.ts";
import type { FolderEntry, Harness } from "../harness/model.ts";
import { t } from "../i18n.ts";
import { base } from "../ui/base.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Menu, MenuHeading, MenuItem, MenuSeparator } from "../ui/Menu.tsx";
import { Skeleton } from "../ui/Spinner.tsx";
import { color, control, font, media, radius, space, text } from "../ui/tokens.stylex.ts";

const styles = stylex.create({
	name: { maxWidth: { default: "11rem", [media.narrow]: "8rem" }, overflow: "hidden", textOverflow: "ellipsis" },
	path: {
		margin: 0,
		paddingBlock: space.sm,
		paddingInline: space.md,
		borderRadius: radius.sm,
		backgroundColor: color.surface,
		fontFamily: font.mono,
		fontSize: text.xs,
		overflowWrap: "anywhere",
	},
	list: { display: "flex", flexDirection: "column", height: "16rem", overflowY: "auto" },
	entry: {
		display: "flex",
		alignItems: "center",
		gap: space.sm,
		flexShrink: 0,
		width: "100%",
		minHeight: control.lg,
		paddingInline: space.sm,
		borderWidth: 0,
		borderRadius: radius.sm,
		backgroundColor: { default: "transparent", [media.hover]: { default: "transparent", ":hover": color.hover } },
		color: color.text,
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: text.md,
		textAlign: "start",
	},
	mark: { display: "flex", color: color.muted },
	actions: { display: "flex", justifyContent: "flex-end", gap: space.sm },
	body: { display: "flex", flexDirection: "column", gap: space.md },
});

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

// Walks the machine's folders. Typing a path is no way to choose one on a phone.
function FolderDialog(props: {
	harness: Harness;
	open: boolean;
	start: string;
	onClose: () => void;
	onChoose: (path: string) => void;
}) {
	const [path, setPath] = createSignal("");
	const [entries, setEntries] = createSignal<FolderEntry[]>([]);
	const [pending, setPending] = createSignal(false);
	let serial = 0;
	const go = (target: string) => {
		const own = ++serial;
		setPending(true);
		void props.harness.readFolder(target).then((found) => {
			if (own !== serial) {
				return;
			}
			setPending(false);
			if (found) {
				setPath(target);
				setEntries(
					found
						.filter((entry) => entry.folder && !entry.name.startsWith("."))
						.toSorted((a, b) => a.name.localeCompare(b.name)),
				);
			}
		});
	};
	createEffect(
		() => props.open,
		(open) => {
			if (open) {
				go(props.start);
			}
		},
	);
	const parent = () => parentOf(path());
	return (
		<Dialog open={props.open} title={t.chooseFolder} onClose={props.onClose}>
			<div {...stylex.attrs(styles.body)}>
				<p {...stylex.attrs(styles.path)}>{path()}</p>
				<div {...stylex.attrs(styles.list)}>
					<Show when={path() !== "/"}>
						<button type="button" {...stylex.attrs(styles.entry, base.focusRing)} onClick={() => go(parent())}>
							<span {...stylex.attrs(styles.mark)}>
								<Icon name="back" />
							</span>
							{folderName(parent()) || "/"}
						</button>
					</Show>
					<For
						each={entries()}
						keyed={(entry) => entry.name}
						fallback={
							<Show when={!pending()} fallback={<Skeleton width="medium" />}>
								<EmptyState title={t.emptyFolder} />
							</Show>
						}
					>
						{(entry) => (
							<button
								type="button"
								{...stylex.attrs(styles.entry, base.focusRing)}
								onClick={() => go(`${path() === "/" ? "" : path()}/${entry().name}`)}
							>
								<span {...stylex.attrs(styles.mark)}>
									<Icon name="folder" />
								</span>
								{entry().name}
							</button>
						)}
					</For>
				</div>
				<div {...stylex.attrs(styles.actions)}>
					<Button onClick={() => props.onClose()}>{t.cancel}</Button>
					<Button
						variant="strong"
						// The folder named above is the one chosen, not one still being opened.
						disabled={pending() || !path()}
						onClick={() => {
							props.onChoose(path());
							props.onClose();
						}}
					>
						{t.useFolder}
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

// Where new work goes: a folder already in use, or any other on the machine.
export function FolderPicker(props: { harness: Harness; value: string; onChange: (path: string) => void }) {
	const [browsing, setBrowsing] = createSignal(false);
	return (
		<>
			<Menu
				label={t.folder}
				trigger={
					<>
						<Icon name="folder" />
						<span {...stylex.attrs(styles.name)}>{folderName(props.value)}</span>
						<Icon name="chevronDown" small />
					</>
				}
			>
				<MenuHeading>{t.folder}</MenuHeading>
				<For each={props.harness.folders()} keyed={(folder) => folder.path}>
					{(folder) => (
						<MenuItem
							label={folder().name}
							description={folder().path}
							checked={folder().path === props.value}
							onSelect={() => props.onChange(folder().path)}
						/>
					)}
				</For>
				<MenuSeparator />
				<MenuItem label={t.otherFolder} icon={<Icon name="folder" />} onSelect={() => setBrowsing(true)} />
			</Menu>
			<FolderDialog
				harness={props.harness}
				open={browsing()}
				start={parentOf(props.value)}
				onClose={() => setBrowsing(false)}
				onChoose={(path) => props.onChange(path)}
			/>
		</>
	);
}
