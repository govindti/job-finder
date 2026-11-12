import type { ApiRequest } from "../../common/http/route.js";
import { parseExportQuery } from "./exports.dto.js";
import * as service from "./exports.service.js";

export async function exportSheets(req: ApiRequest): Promise<Response> {
    return Response.json(await service.exportJobs(parseExportQuery(req)));
}
export function status(): Response { return Response.json(service.getSheetsStatus()); }
