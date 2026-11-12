import { ErrorCode } from "./error-codes.js";

const definitions: Record<ErrorCode, readonly [number, string]> = {
    INVALID_JSON: [400, "Invalid JSON body"],
    INVALID_REQUEST: [400, "Unable to read the request"],
    VALIDATION_ERROR: [422, "Invalid request data"],
    REQUEST_TOO_LARGE: [413, "Request body exceeds the 100 KiB limit"],
    ROUTE_NOT_FOUND: [404, "Route not found"],
    METHOD_NOT_ALLOWED: [405, "Method not allowed"],
    JOB_NOT_FOUND: [404, "Job not found"],
    COMPANY_NOT_FOUND: [404, "Company not found"],
    OUTREACH_NOT_FOUND: [404, "Outreach item not found"],
    PROFILE_NOT_FOUND: [404, "Profile not found"],
    QUERY_NOT_FOUND: [404, "Search query not found"],
    PRESET_NOT_FOUND: [404, "Preset not found"],
    INVALID_PRESET: [422, "Invalid profile preset"],
    ACTIVE_PROFILE_DELETE_FORBIDDEN: [409, "Cannot delete the active profile. Activate another first."],
    NO_ACTIVE_PROFILE: [409, "Activate a profile before editing search queries"],
    RESOURCE_CONFLICT: [409, "A resource with these values already exists"],
    NOT_IMPLEMENTED: [501, "This operation is not implemented"],
    DATABASE_NOT_CONFIGURED: [503, "The database is not configured"],
    EMAIL_NOT_CONFIGURED: [503, "Configure the sender email and app password before sending a digest"],
    RECIPIENT_NOT_CONFIGURED: [503, "Configure a recipient email on the profile or in the environment"],
    SHEETS_NOT_CONFIGURED: [503, "Configure a Google Sheet before exporting"],
    SHEETS_CREDENTIALS_MISSING: [503, "Google Sheets credentials are not configured"],
    EMAIL_DELIVERY_FAILED: [502, "Email delivery failed. Check the delivery status before retrying."],
    SHEETS_EXPORT_FAILED: [502, "Google Sheets export failed"],
    HUNTER_STATUS_FAILED: [502, "Unable to retrieve Hunter account status"],
    INTERNAL_ERROR: [500, "An unexpected error occurred"],
};

export class AppError extends Error {
    readonly status_code: number;
    readonly headers: HeadersInit | undefined;

    constructor(
        public readonly err_code: ErrorCode,
        options: { message?: string; cause?: unknown; headers?: HeadersInit } = {},
    ) {
        const [status, message] = definitions[err_code];
        super(options.message ?? message, { cause: options.cause });
        this.name = "AppError";
        this.status_code = status;
        this.headers = options.headers;
    }
}
