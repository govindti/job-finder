import { query, queryOne } from "../../infrastructure/database/connection.js";
import { utcNowIso } from "../../common/utils/time.js";

// ── API usage tracking ────────────────────────────────────────────────

export async function logApiCall(apiName: string, success = true, notes = ""): Promise<void> {
    await query(
        "INSERT INTO api_usage (api_name, called_at, success, notes) VALUES ($1, $2, $3, $4)",
        [apiName, utcNowIso(), success ? 1 : 0, notes],
    );
}

export async function getApiUsage(
    apiName: string,
): Promise<{ month: number; today: number; total: number }> {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1)).toISOString().replace("Z", "");
    const todayStart = new Date(Date.UTC(y, m, now.getUTCDate())).toISOString().replace("Z", "");
    const month = await queryOne<{ c: number }>(
        "SELECT COUNT(*)::int AS c FROM api_usage WHERE api_name=$1 AND called_at >= $2",
        [apiName, monthStart],
    );
    const today = await queryOne<{ c: number }>(
        "SELECT COUNT(*)::int AS c FROM api_usage WHERE api_name=$1 AND called_at >= $2",
        [apiName, todayStart],
    );
    const total = await queryOne<{ c: number }>(
        "SELECT COUNT(*)::int AS c FROM api_usage WHERE api_name=$1",
        [apiName],
    );
    return { month: month?.c ?? 0, today: today?.c ?? 0, total: total?.c ?? 0 };
}
