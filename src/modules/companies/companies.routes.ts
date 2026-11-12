import * as controller from "./companies.controller.js";
import type { ApiRoutes } from "../../common/http/route.js";

export const companiesRoutes = {
    "/api/companies": { GET: controller.list, POST: controller.create },
    "/api/companies/stats": { GET: controller.stats },
    "/api/companies/:companyId": { PATCH: controller.update, DELETE: controller.pause },
    "/api/companies/:companyId/activate": { POST: controller.activate },
    "/api/companies/seed": { POST: controller.seed },
    "/api/companies/mega-seed": { POST: controller.megaSeed },
    "/api/companies/detect-ats": { POST: controller.discover },
    "/api/companies/discover": { POST: controller.discover },
} satisfies ApiRoutes;
