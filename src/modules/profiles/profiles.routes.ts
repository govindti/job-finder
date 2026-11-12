import * as controller from "./profiles.controller.js";
import type { ApiRoutes } from "../../common/http/route.js";

export const profilesRoutes = {
    "/api/profiles": { GET: controller.list, POST: controller.create },
    "/api/profiles/active": { GET: controller.active },
    "/api/profiles/import": { POST: controller.importPreset },
    "/api/profiles/:pid": { GET: controller.get, PUT: controller.update, DELETE: controller.remove },
    "/api/profiles/:pid/activate": { POST: controller.activate },
    "/api/profiles/:pid/duplicate": { POST: controller.duplicate },
    "/api/profiles/:pid/export": { GET: controller.exportYaml },
    "/api/search-queries": { GET: controller.queries, POST: controller.addQuery },
    "/api/search-queries/:qid": { PATCH: controller.updateQuery, DELETE: controller.removeQuery },
} satisfies ApiRoutes;
