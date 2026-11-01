/**
 * Whether two plain values hold the same data. Rebuilt data can keep the objects it had, so that what
 * is rendered from them stays in place: a selection, a scroll position, and the time to render again.
 */
export function same(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
		return false;
	}
	if (Array.isArray(a) !== Array.isArray(b)) {
		return false;
	}
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) {
		return false;
	}
	return keys.every((key) => same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
