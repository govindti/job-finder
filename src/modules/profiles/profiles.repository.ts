import { query, queryOne } from "../../infrastructure/database/connection.js";
import { utcNowIso } from "../../common/utils/time.js";
import type { ProfileConfig, ProfileDbRow } from "./profiles.types.js";

export async function readActiveProfileId(): Promise<number | null> {
    const row = await queryOne<{ value: string }>("SELECT value FROM app_settings WHERE key = 'active_profile_id'");
    if (!row) return null;
    const id = Number.parseInt(row.value, 10);
    return Number.isNaN(id) ? null : id;
}

export function readProfileRow(id: number): Promise<ProfileDbRow | undefined> {
    return queryOne<ProfileDbRow>("SELECT * FROM profiles WHERE id = $1", [id]);
}

export async function listProfileRows(): Promise<ProfileDbRow[]> {
    return (await query<ProfileDbRow>("SELECT * FROM profiles ORDER BY id")).rows;
}

export function findProfileByName(name: string): Promise<{ id: number } | undefined> {
    return queryOne<{ id: number }>("SELECT id FROM profiles WHERE name = $1", [name]);
}

export async function insertProfile(name: string, description: string, config: ProfileConfig, source: string): Promise<number> {
    const ts = utcNowIso();
    const row = await queryOne<{ id: number }>(
        `INSERT INTO profiles (name, description, config_json, created_at, updated_at, source)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [name, description, JSON.stringify(config), ts, ts, source],
    );
    if (!row) throw new Error("Profile insert returned no id");
    return row.id;
}

export async function updateProfileRow(id: number, fields: { name?: string; description?: string; config?: ProfileConfig; source?: string }): Promise<void> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        const column = key === "config" ? "config_json" : key;
        if (!["name", "description", "config_json", "source"].includes(column)) continue;
        params.push(key === "config" ? JSON.stringify(value) : value);
        assignments.push(`${column} = $${params.length}`);
    }
    if (!assignments.length) return;
    params.push(utcNowIso());
    assignments.push(`updated_at = $${params.length}`);
    params.push(id);
    await query(`UPDATE profiles SET ${assignments.join(", ")} WHERE id = $${params.length}`, params);
}

export async function setActiveProfileId(id: number): Promise<void> {
    await query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('active_profile_id', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [String(id), utcNowIso()],
    );
}

export async function deleteProfileRow(id: number): Promise<void> {
    await query("DELETE FROM profiles WHERE id = $1", [id]);
}

export async function countProfiles(): Promise<number> {
    return (await queryOne<{ c: number }>("SELECT COUNT(*)::int AS c FROM profiles"))?.c ?? 0;
}
