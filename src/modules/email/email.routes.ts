import * as controller from "./email.controller.js";
import type { ApiRoutes } from "../../common/http/route.js";

export const emailRoutes = {
    "/api/email/send-now": { POST: controller.send },
    "/api/email/status": { GET: controller.status },
} satisfies ApiRoutes;
