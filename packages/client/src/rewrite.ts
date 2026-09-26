import type { HeaderList } from "@hostc/protocol";

/**
 * Makes a public request look like it was made to the local server directly,
 * so dev servers that check Host or Origin (Vite, Next.js) accept it.
 */
export function toLocalRequestHeaders(headers: HeaderList, publicOrigin: string, target: URL): HeaderList {
	const result: HeaderList = [["host", target.host]];
	for (const [name, value] of headers) {
		const lower = name.toLowerCase();
		if (lower === "host") {
			continue;
		}
		if ((lower === "origin" || lower === "referer") && value.startsWith(publicOrigin)) {
			result.push([name, target.origin + value.slice(publicOrigin.length)]);
			continue;
		}
		result.push([name, value]);
	}
	return result;
}

/** Points redirects at the local server back at the public URL. */
export function toPublicResponseHeaders(headers: HeaderList, publicOrigin: string, target: URL): HeaderList {
	const localOrigins = localOriginsFor(target);
	return headers.map(([name, value]) => {
		if (name.toLowerCase() !== "location") {
			return [name, value];
		}
		for (const origin of localOrigins) {
			if (value === origin || value.startsWith(`${origin}/`) || value.startsWith(`${origin}?`)) {
				return [name, publicOrigin + value.slice(origin.length)];
			}
		}
		return [name, value];
	});
}

/** `http://localhost:3000` is also reachable as 127.0.0.1 and [::1]; apps redirect to any of them. */
function localOriginsFor(target: URL): string[] {
	const origins = new Set([target.origin]);
	const loopback = ["localhost", "127.0.0.1", "[::1]"];
	if (loopback.includes(target.hostname)) {
		for (const host of loopback) {
			origins.add(`${target.protocol}//${host}${target.port ? `:${target.port}` : ""}`);
		}
	}
	return [...origins];
}

/** Node's rawHeaders format: `[name, value, name, value, ...]`. */
export function fromRawHeaders(raw: string[]): HeaderList {
	const result: HeaderList = [];
	for (let index = 0; index + 1 < raw.length; index += 2) {
		result.push([raw[index] as string, raw[index + 1] as string]);
	}
	return result;
}

export function toRawHeaders(headers: HeaderList): string[] {
	return headers.flat();
}
