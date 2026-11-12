import { ZodError } from "zod";
import { logger } from "../../config/logger.js";
import { AppError } from "./app-error.js";
import type { ApiErrorBody } from "./error-codes.js";

export function normalizeError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof ZodError) return new AppError("VALIDATION_ERROR", { cause: error });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return new AppError("RESOURCE_CONFLICT", { cause: error });
    }
    return new AppError("INTERNAL_ERROR", { cause: error });
}

/** All application failures are serialized here; internal causes stay in logs. */
export function errorResponse(error: unknown): Response {
    const failure = normalizeError(error);
    if (failure.status_code >= 500) {
        logger.error({ err: failure.cause ?? failure, err_code: failure.err_code }, "Request failed");
    }
    const body: ApiErrorBody = {
        err_code: failure.err_code,
        status_code: failure.status_code,
        err_mess: failure.message,
    };
    return Response.json(body, { status: failure.status_code, headers: failure.headers });
}
