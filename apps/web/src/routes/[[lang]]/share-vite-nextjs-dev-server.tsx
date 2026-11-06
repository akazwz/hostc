import { defineFileRoute } from "@solidjs/router/fs";

import { Guide } from "../../components/Guide.tsx";
import { DEV_SERVERS } from "../../content/guides.ts";

export const route = defineFileRoute("/:lang?/share-vite-nextjs-dev-server", { matchFilters: { lang: ["zh"] } });

export default function Page() {
	return <Guide guide={DEV_SERVERS} />;
}
