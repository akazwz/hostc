import { defineFileRoute } from "@solidjs/router/fs";

import { Guide } from "../../components/Guide.tsx";
import { COMPARISON } from "../../content/guides.tsx";

export const route = defineFileRoute("/:lang?/ngrok-alternative", { matchFilters: { lang: ["zh"] } });

export default function Page() {
	return <Guide guide={COMPARISON} />;
}
