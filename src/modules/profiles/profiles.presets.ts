import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/app-error.js";
type Rec = Record<string, unknown>;

// ── Preset import / export ────────────────────────────────────────────

export interface PresetMeta {
  slug: string;
  name: string;
  description: string;
}

export function readPreset(slug: string): { name: string; description: string; config: Rec } {
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) throw new AppError("INVALID_PRESET");
  const file = path.join(env.PROFILES_DIR, `${slug}.yaml`);
  if (!fs.existsSync(file)) throw new AppError("PRESET_NOT_FOUND");
  const text = fs.readFileSync(file, "utf8");
  let data: Rec;
  try {
    const parsed: unknown = YAML.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Invalid preset");
    data = parsed as Rec;
  } catch (cause) {
    throw new AppError("INVALID_PRESET", { cause });
  }
  const { name, description, ...config } = data;
  return { name: typeof name === "string" ? name : slug, description: typeof description === "string" ? description : "", config };
}

export function listPresets(): PresetMeta[] {
  const dir = env.PROFILES_DIR;
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  const presets: PresetMeta[] = [];
  for (const file of files) {
    const meta = readPresetMeta(path.join(dir, file));
    if (meta) presets.push(meta);
  }
  return presets;
}

function readPresetMeta(filePath: string): PresetMeta | null {
  let data: Rec;
  try {
    data = (YAML.parse(fs.readFileSync(filePath, "utf-8")) as Rec) ?? {};
  } catch {
    return null;
  }
  const slug = path.basename(filePath, ".yaml");
  return {
    slug,
    name: typeof data.name === "string" ? data.name : slug,
    description: typeof data.description === "string" ? data.description : "",
  };
}
