import type { ApiRequest } from "../../common/http/route.js";
import { parseDryRun } from "./email.dto.js";
import * as service from "./email.service.js";

export async function send(req: ApiRequest): Promise<Response> {
    return Response.json(await service.sendDailyDigest(undefined, parseDryRun(req)));
}
export async function status(): Promise<Response> { return Response.json(await service.getEmailStatus()); }
