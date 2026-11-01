import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { pageRoutes } from "virtual:file-routes";

// The one router of the app. Its routes are the files under src/routes.
export const Router = createRouter({ routes: fileRoutes(pageRoutes) });

// Typed addresses, inferred from the route files: `paths()` is "/". Use them in `href`.
export const { paths } = Router;
