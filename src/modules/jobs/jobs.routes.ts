import * as controller from "./jobs.controller.js";
import type { ApiRoutes } from "../../common/http/route.js";

export const jobsRoutes = {
    "/api/jobs": { GET: controller.list },
    "/api/jobs/marked": { GET: controller.marked },
    "/api/jobs/:jobId": { GET: controller.get },
    "/api/jobs/:jobId/status": { PATCH: controller.updateStatus },
    "/api/jobs/:jobId/mark-for-email": { POST: controller.toggleEmailMark },
    "/api/stats": { GET: controller.stats },
    "/api/sources": { GET: controller.sources },
} satisfies ApiRoutes;
