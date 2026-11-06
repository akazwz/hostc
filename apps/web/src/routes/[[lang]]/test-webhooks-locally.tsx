import { defineFileRoute } from "@solidjs/router/fs";

import { Guide } from "../../components/Guide.tsx";
import { WEBHOOKS } from "../../content/guides.tsx";

export const route = defineFileRoute("/:lang?/test-webhooks-locally", { matchFilters: { lang: ["zh"] } });

export default function Page() {
	return <Guide guide={WEBHOOKS} />;
}
