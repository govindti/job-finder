import { getQuery, toBool } from "../../common/http/request.js";

export const parseDryRun = (req: Request) => toBool(getQuery(req).dry_run, false);
