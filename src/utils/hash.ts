import { createHash } from "node:crypto";

// MD5 hex digest of a utf-8 string.
export function md5Hex(input: string): string {
    return createHash("md5").update(input, "utf8").digest("hex");
}
