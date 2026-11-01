/** The last part of a path: what a folder is called in the interface. */
export function folderName(path: string): string {
	return path.split("/").filter(Boolean).at(-1) ?? path;
}
