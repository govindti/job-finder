import type { BunRequest } from "bun";
import { AppError } from "../errors/app-error.js";
import { readBody } from "./request.js";

export type ApiRequest = BunRequest<string>;
export type ApiHandler = (req: ApiRequest) => Response | Promise<Response>;
export type ApiRoutes = Record<string, Partial<Record<"GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD" | "OPTIONS", ApiHandler>>>;

/** Bun matches paths/parameters; this shared boundary enforces HTTP policies. */
export function bindRoutes(routes: ApiRoutes): Record<string, ApiHandler> {
    return Object.fromEntries(Object.entries(routes).map(([path, methods]) => {
        const allowed = Object.keys(methods);
        if (methods.GET && !methods.HEAD) allowed.push("HEAD");
        const handler: ApiHandler = async (req) => {
            await readBody(req);
            const method = req.method as keyof typeof methods;
            const action = Object.hasOwn(methods, method) ? methods[method] : undefined;
            const execute = action ?? (method === "HEAD" ? methods.GET : undefined);
            if (!execute) {
                throw new AppError("METHOD_NOT_ALLOWED", { headers: { Allow: allowed.join(", ") } });
            }
            return execute(req);
        };
        return [path, handler];
    }));
}

export function mergeRoutes(...modules: ApiRoutes[]): ApiRoutes {
    const routes: ApiRoutes = {};
    for (const module of modules) {
        for (const [path, methods] of Object.entries(module)) {
            if (Object.hasOwn(routes, path)) throw new Error(`Duplicate route path: ${path}`);
            routes[path] = methods;
        }
    }
    return routes;
}
