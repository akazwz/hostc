import { defineFileRoute } from "@solidjs/router/fs";

import { Guide } from "../../components/Guide.tsx";
import { WEBHOOKS } from "../../content/guides.ts";

export const route = defineFileRoute("/:lang?/test-webhooks-locally", { matchFilters: { lang: ["zh"] } });

export default function Page() {
	return <Guide guide={WEBHOOKS} />;
}
