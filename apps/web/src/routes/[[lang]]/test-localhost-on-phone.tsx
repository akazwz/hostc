import { defineFileRoute } from "@solidjs/router/fs";

import { Guide } from "../../components/Guide.tsx";
import { PHONE } from "../../content/guides.ts";

export const route = defineFileRoute("/:lang?/test-localhost-on-phone", { matchFilters: { lang: ["zh"] } });

export default function Page() {
	return <Guide guide={PHONE} />;
}
