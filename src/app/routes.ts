import { mergeRoutes } from "../common/http/route.js";
import { jobsRoutes } from "../modules/jobs/jobs.routes.js";
import { companiesRoutes } from "../modules/companies/companies.routes.js";
import { profilesRoutes } from "../modules/profiles/profiles.routes.js";
import { outreachRoutes } from "../modules/outreach/outreach.routes.js";
import { collectionRoutes } from "../modules/collection/collection.routes.js";
import { emailRoutes } from "../modules/email/email.routes.js";
import { exportsRoutes } from "../modules/exports/exports.routes.js";
import { automationRoutes } from "../modules/automation/automation.routes.js";

export const apiRoutes = mergeRoutes(jobsRoutes, companiesRoutes, profilesRoutes, outreachRoutes, collectionRoutes, emailRoutes, exportsRoutes, automationRoutes);
