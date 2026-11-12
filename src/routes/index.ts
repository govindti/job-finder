import { jobsRoutes } from "./jobs.js";
import { companiesRoutes } from "./companies.js";
import { outreachRoutes } from "./outreach.js";
import { emailRoutes } from "./email.js";
import { exportRoutes } from "./export.js";
import { profilesRoutes } from "./profiles.js";

// Native Bun route tables retain the existing /api paths and HTTP methods.
export const apiRoutes = {
    ...jobsRoutes,
    ...companiesRoutes,
    ...outreachRoutes,
    ...emailRoutes,
    ...exportRoutes,
    ...profilesRoutes,
} satisfies Bun.Serve.Routes<undefined, string>;
