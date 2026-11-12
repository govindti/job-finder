import * as controller from "./outreach.controller.js";
import type { ApiRoutes } from "../../common/http/route.js";

export const outreachRoutes = {
    "/api/outreach": { GET: controller.list },
    "/api/outreach/stats": { GET: controller.stats },
    "/api/outreach/bulk-delete": { POST: controller.bulkDelete },
    "/api/outreach/generate": { POST: controller.generate },
    "/api/outreach/:outreachId/status": { PATCH: controller.updateStatus },
    "/api/outreach/:outreachId/notes": { PATCH: controller.updateNotes },
    "/api/hunter/status": { GET: controller.hunterStatus },
} satisfies ApiRoutes;
