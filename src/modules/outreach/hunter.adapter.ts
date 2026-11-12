import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/app-error.js";

const accountSchema = z.object({
    data: z.object({
        plan_name: z.string().default(""),
        requests: z.object({ used: z.number().default(0), available: z.number().default(0) }).default({}),
    }),
});

export async function getHunterStatus() {
    if (!env.HUNTER_API_KEY) return { configured: false as const };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetch(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(env.HUNTER_API_KEY)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Hunter status ${response.status}`);
        const { data } = accountSchema.parse(await response.json());
        return { configured: true as const, plan: data.plan_name, used: data.requests.used, available: data.requests.available };
    } catch (cause) {
        throw new AppError("HUNTER_STATUS_FAILED", { cause });
    } finally {
        clearTimeout(timer);
    }
}
