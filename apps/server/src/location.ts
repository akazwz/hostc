/** Minimal geolocation fields read from Cloudflare's `request.cf`. */
export type CfLocation = {
	readonly country?: string;
	readonly continent?: string;
	readonly longitude?: string | number;
};

/**
 * Northeast Asia-Pacific countries whose direct traffic benefits from `apac-ne`, especially when
 * mainland China users reach Cloudflare through preferred CNAMEs that land in North America or Europe.
 */
const NORTHEAST_ASIA = new Set(["CN", "HK", "MO", "TW", "JP", "KR", "MN"]);
const SOUTHEAST_ASIA = new Set(["SG", "MY", "TH", "VN", "ID", "PH", "MM", "KH", "LA", "BN", "TL"]);
const MIDDLE_EAST = new Set(["AE", "SA", "IL", "QA", "KW", "BH", "OM", "JO", "LB", "IQ", "TR", "YE", "SY", "PS"]);

/**
 * Picks a Durable Object `locationHint` near the developer creating the tunnel.
 * Returns `undefined` when Cloudflare's geolocation metadata is missing or ambiguous (e.g. local dev, Tor),
 * letting Cloudflare fall back to the default placement near the handling PoP.
 */
export function locationHintFromCf(cf?: CfLocation | CfProperties): DurableObjectLocationHint | undefined {
	if (!cf || !("country" in cf || "continent" in cf || "longitude" in cf)) {
		return undefined;
	}
	const geo = cf as CfLocation;
	const country = typeof geo.country === "string" ? geo.country.toUpperCase() : undefined;
	if (country && country !== "XX" && country !== "T1") {
		if (NORTHEAST_ASIA.has(country)) {
			return "apac-ne";
		}
		if (SOUTHEAST_ASIA.has(country)) {
			return "apac-se";
		}
		if (MIDDLE_EAST.has(country)) {
			return "me";
		}
	}

	const continent = typeof geo.continent === "string" ? geo.continent.toUpperCase() : undefined;
	const longitude = parseLongitude(geo.longitude);
	switch (continent) {
		case "AS":
			return "apac";
		case "OC":
			return "oc";
		case "AF":
			return "afr";
		case "SA":
			return "sam";
		case "EU":
			return longitude !== null && longitude >= 15 ? "eeur" : "weur";
		case "NA":
			if (longitude === null) {
				return undefined;
			}
			return longitude < -100 ? "wnam" : "enam";
		default:
			return undefined;
	}
}

function parseLongitude(value: string | number | undefined): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}
