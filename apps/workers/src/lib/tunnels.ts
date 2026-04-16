import {
	buildTunnelConnectPath,
	normalizeSubdomain,
} from "@hostc/tunnel-protocol";

export function createRandomSubdomain(): string {
	return `t-${crypto.randomUUID().slice(0, 8)}`;
}

export function extractTunnelSubdomain(
	hostname: string,
	publicBaseDomain: string,
): string | null {
	const normalizedHostname = normalizeHostname(hostname);
	const normalizedBaseDomain = normalizeHostname(publicBaseDomain);

	if (normalizedHostname === normalizedBaseDomain) {
		return null;
	}

	if (normalizedHostname.endsWith(`.${normalizedBaseDomain}`)) {
		const candidate = normalizedHostname.slice(
			0,
			-(normalizedBaseDomain.length + 1),
		);

		if (!candidate || candidate.includes(".")) {
			return null;
		}

		return normalizeSubdomain(candidate);
	}

	const labels = normalizedHostname.split(".");

	if (labels.length < 3) {
		return null;
	}

	const [subdomain] = labels;

	return normalizeSubdomain(subdomain);
}

export function buildTunnelWebSocketUrl(
	requestUrl: URL,
	tunnelId: string,
	connectToken: string,
): string {
	const websocketUrl = new URL(buildTunnelConnectPath(tunnelId), requestUrl);

	websocketUrl.protocol = websocketUrl.protocol === "http:" ? "ws:" : "wss:";
	websocketUrl.search = new URLSearchParams({ token: connectToken }).toString();

	return websocketUrl.toString();
}

function normalizeHostname(value: string): string {
	return value.trim().toLowerCase().replace(/\.$/, "");
}
