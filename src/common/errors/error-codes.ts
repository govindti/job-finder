// Browser-safe API contract: no server imports or runtime configuration.
export const ErrorCode = {
    INVALID_JSON: "INVALID_JSON",
    INVALID_REQUEST: "INVALID_REQUEST",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    REQUEST_TOO_LARGE: "REQUEST_TOO_LARGE",
    ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
    METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
    JOB_NOT_FOUND: "JOB_NOT_FOUND",
    COMPANY_NOT_FOUND: "COMPANY_NOT_FOUND",
    OUTREACH_NOT_FOUND: "OUTREACH_NOT_FOUND",
    PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
    QUERY_NOT_FOUND: "QUERY_NOT_FOUND",
    PRESET_NOT_FOUND: "PRESET_NOT_FOUND",
    INVALID_PRESET: "INVALID_PRESET",
    ACTIVE_PROFILE_DELETE_FORBIDDEN: "ACTIVE_PROFILE_DELETE_FORBIDDEN",
    NO_ACTIVE_PROFILE: "NO_ACTIVE_PROFILE",
    RESOURCE_CONFLICT: "RESOURCE_CONFLICT",
    NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
    DATABASE_NOT_CONFIGURED: "DATABASE_NOT_CONFIGURED",
    EMAIL_NOT_CONFIGURED: "EMAIL_NOT_CONFIGURED",
    RECIPIENT_NOT_CONFIGURED: "RECIPIENT_NOT_CONFIGURED",
    SHEETS_NOT_CONFIGURED: "SHEETS_NOT_CONFIGURED",
    SHEETS_CREDENTIALS_MISSING: "SHEETS_CREDENTIALS_MISSING",
    EMAIL_DELIVERY_FAILED: "EMAIL_DELIVERY_FAILED",
    SHEETS_EXPORT_FAILED: "SHEETS_EXPORT_FAILED",
    HUNTER_STATUS_FAILED: "HUNTER_STATUS_FAILED",
    INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

export interface ApiErrorBody {
    err_code: string;
    status_code: number;
    err_mess: string;
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
    if (typeof value !== "object" || value === null) return false;
    const body = value as Record<string, unknown>;
    return typeof body.err_code === "string" && body.err_code.length > 0
        && typeof body.err_mess === "string"
        && typeof body.status_code === "number" && Number.isInteger(body.status_code)
        && body.status_code >= 400 && body.status_code <= 599;
}
