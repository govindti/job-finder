import * as controller from "./exports.controller.js";
import type { ApiRoutes } from "../../common/http/route.js";

export const exportsRoutes = {
    "/api/export/sheets": { POST: controller.exportSheets },
    "/api/export/sheets/status": { GET: controller.status },
} satisfies ApiRoutes;
