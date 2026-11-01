import { flush } from "solid-js";

// Runs a state change as a view transition: the browser takes a picture of every element
// that has a `viewTransitionName`, applies the change, and animates from the old picture to
// the new one. Call it from an event handler, with the writes inside `update`:
//
//   onClick={() => transition(() => setCount((value) => value + 1))}
//
// Solid applies writes on the next microtask, and the browser takes the new picture as soon
// as the callback returns, so the writes are flushed here; without that the two pictures
// would be the same. Where the browser has no view transitions, or the reader has asked
// for reduced motion, the change is applied at once and nothing moves.
export function transition(update: () => void) {
	const change = () => {
		update();
		flush();
	};
	if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
		change();
		return;
	}
	// A transition cut short by the next one rejects `ready`. Its change has been applied
	// all the same, so there is nothing to report.
	document.startViewTransition(change).ready.catch(() => {});
}
