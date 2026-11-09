import pino from "pino";

// A single pino instance keeps logging structured and level-gated instead of
// scattering console output across modules.
export const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    transport: undefined,
    base: undefined,
    messageKey: "msg",
});
