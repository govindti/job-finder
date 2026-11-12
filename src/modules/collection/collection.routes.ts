import * as controller from "./collection.controller.js";
import type { ApiRoutes } from "../../common/http/route.js";

export const collectionRoutes = {
    "/api/companies/crawl": { POST: controller.crawl },
    "/api/companies/:companyId/crawl": { POST: controller.crawlCompany },
    "/api/jsearch/status": { GET: controller.jsearchStatus },
} satisfies ApiRoutes;
