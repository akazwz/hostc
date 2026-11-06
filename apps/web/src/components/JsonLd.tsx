import { Script } from "@solidjs/meta";

/** Structured data describing a page to search engines. */
export function JsonLd(props: { data: Record<string, unknown> }) {
	return (
		<Script type="application/ld+json" key="structured-data">
			{JSON.stringify({ "@context": "https://schema.org", ...props.data })}
		</Script>
	);
}
