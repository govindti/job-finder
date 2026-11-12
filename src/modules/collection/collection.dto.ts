import { requiredString } from "../../common/http/request.js";
import type { ApiRequest } from "../../common/http/route.js";

export const parseCrawlCompanyId = (req: ApiRequest) => requiredString(req.params.companyId, "company id");
