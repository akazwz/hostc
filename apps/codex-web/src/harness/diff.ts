export type DiffLine = {
	kind: "add" | "remove" | "context" | "hunk";
	text: string;
	oldLine: number | null;
	newLine: number | null;
};
export type DiffFile = { path: string; added: number; removed: number; lines: DiffLine[] };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parses a unified diff. A diff with no file headers, as one file change carries, is one file. */
export function parseDiff(text: string, fallbackPath = ""): DiffFile[] {
	const files: DiffFile[] = [];
	let file: DiffFile | null = null;
	let oldLine = 1;
	let newLine = 1;
	// `--- x` inside a hunk is a removed line, not a file header.
	let inHunk = false;
	const start = (path: string) => {
		file = { path, added: 0, removed: 0, lines: [] };
		files.push(file);
		oldLine = 1;
		newLine = 1;
		inHunk = false;
		return file;
	};
	const lines = text.split("\n");
	if (lines.at(-1) === "") {
		lines.pop();
	}
	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			const match = / b\/(.+)$/.exec(line);
			start(match?.[1] ?? line);
			continue;
		}
		if (!inHunk && line.startsWith("+++ ")) {
			if (file && line !== "+++ /dev/null") {
				(file as DiffFile).path = line.slice(4).replace(/^b\//, "");
			}
			continue;
		}
		if (
			!inHunk &&
			(line.startsWith("--- ") ||
				line.startsWith("index ") ||
				/^(new|deleted) file mode/.test(line) ||
				/^(rename|similarity) /.test(line))
		) {
			continue;
		}
		const current: DiffFile = file ?? start(fallbackPath);
		const hunk = HUNK.exec(line);
		if (hunk) {
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[2]);
			inHunk = true;
			current.lines.push({ kind: "hunk", text: line, oldLine: null, newLine: null });
		} else if (line.startsWith("+")) {
			current.added++;
			current.lines.push({ kind: "add", text: line.slice(1), oldLine: null, newLine: newLine++ });
		} else if (line.startsWith("-")) {
			current.removed++;
			current.lines.push({ kind: "remove", text: line.slice(1), oldLine: oldLine++, newLine: null });
		} else if (!line.startsWith("\\")) {
			current.lines.push({ kind: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
		}
	}
	return files;
}

export function diffTotals(files: readonly DiffFile[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const file of files) {
		added += file.added;
		removed += file.removed;
	}
	return { added, removed };
}

const parsed = new WeakMap<object, DiffFile[]>();

/** The files of something edited, parsed once however often they are asked for. */
export function filesOf(edit: { files: readonly { path: string; diff: string }[] }): DiffFile[] {
	let files = parsed.get(edit);
	if (!files) {
		files = edit.files.flatMap((file) => parseDiff(file.diff, file.path));
		parsed.set(edit, files);
	}
	return files;
}
