import { ErrorCode, type ApiErrorBody } from "../../src/common/errors/error-codes";

export const errorMessages: Record<ErrorCode, string> = {
    INVALID_JSON: "The request contains invalid JSON.",
    INVALID_REQUEST: "The request could not be read. Please try again.",
    VALIDATION_ERROR: "Check the supplied fields and try again.",
    REQUEST_TOO_LARGE: "The request exceeds the 100 KiB limit.",
    ROUTE_NOT_FOUND: "This API endpoint is unavailable.",
    METHOD_NOT_ALLOWED: "This action is not supported for this endpoint.",
    JOB_NOT_FOUND: "This job no longer exists. Refresh the jobs list.",
    COMPANY_NOT_FOUND: "This company no longer exists.",
    OUTREACH_NOT_FOUND: "This outreach item no longer exists. Refresh the list.",
    PROFILE_NOT_FOUND: "This profile no longer exists. Select another profile.",
    QUERY_NOT_FOUND: "This search query no longer exists. Refresh the queries.",
    PRESET_NOT_FOUND: "The selected preset could not be found.",
    INVALID_PRESET: "The selected preset is invalid.",
    ACTIVE_PROFILE_DELETE_FORBIDDEN: "Activate another profile before deleting this one.",
    NO_ACTIVE_PROFILE: "Activate a profile before editing search queries.",
    RESOURCE_CONFLICT: "These values are already in use. Choose different values.",
    NOT_IMPLEMENTED: "This feature is not implemented yet.",
    DATABASE_NOT_CONFIGURED: "The API database needs to be configured.",
    EMAIL_NOT_CONFIGURED: "Configure the sender email and app password before sending a digest.",
    RECIPIENT_NOT_CONFIGURED: "Set a recipient email in your profile or environment.",
    SHEETS_NOT_CONFIGURED: "Configure a Google Sheet before exporting.",
    SHEETS_CREDENTIALS_MISSING: "Configure Google Sheets credentials before exporting.",
    EMAIL_DELIVERY_FAILED: "Email delivery failed. Check the delivery status before retrying.",
    SHEETS_EXPORT_FAILED: "Google Sheets export failed. Check the sheet permissions.",
    HUNTER_STATUS_FAILED: "Hunter account status is temporarily unavailable.",
    INTERNAL_ERROR: "Something went wrong on the server. Please try again later.",
};

export class ApiError extends Error implements ApiErrorBody {
    readonly err_code: string;
    readonly status_code: number;
    readonly err_mess: string;

    constructor(body: ApiErrorBody) {
        const knownMessage = Object.hasOwn(errorMessages, body.err_code) ? errorMessages[body.err_code as ErrorCode] : undefined;
        super(knownMessage || body.err_mess || "The request failed.");
        this.name = "ApiError";
        this.err_code = body.err_code;
        this.status_code = body.status_code;
        this.err_mess = body.err_mess;
    }
}

export function formatApiError(error: unknown, fallback = "The request failed."): string {
    return error instanceof Error ? error.message : fallback;
}
