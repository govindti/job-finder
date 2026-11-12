import * as controller from "./automation.controller.js";
import type { ApiRoutes } from "../../common/http/route.js";

export const automationRoutes = {
    "/api/collect": { POST: controller.collect },
    "/api/outreach/refresh": { POST: controller.refresh },
    "/api/email/run-pipeline": { POST: controller.pipeline },
    "/api/run-now": { POST: controller.runNow },
    "/api/profiles/rescore-all": { POST: controller.rescore },
} satisfies ApiRoutes;
