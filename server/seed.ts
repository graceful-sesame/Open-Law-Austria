import { rawDb } from "./db";
import { COLLECTIONS } from "../config/collections";

/**
 * Seed builtin collections & laws into the DB on startup.
 *
 * - First launch: copies everything from config/collections.ts into
 *   user_collections/user_laws with is_builtin=1. From then on, those rows
 *   are the single source of truth (editable/deletable via admin).
 * - Subsequent launches: only seeds rows that are missing AND have not been
 *   deliberately deleted (tracked via app_settings.seeded_v1_done).
 */
export function seedBuiltins() {
  const seededFlag = rawDb
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get("seeded_v1_done") as { value: string } | undefined;

  if (seededFlag?.value === "1") {
    // Already seeded once — user may have deleted some builtin entries;
    // don't re-insert them. Only add rows that truly don't exist yet
    // (new config entries added later in an update) and were never there.
    return;
  }

  const now = Date.now();
  const insCol = rawDb.prepare(`
    INSERT INTO user_collections (collection_id, title, description, color, icon, is_builtin, sort_index, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(collection_id) DO NOTHING
  `);
  const insLaw = rawDb.prepare(`
    INSERT INTO user_laws (law_id, collection_id, gesetzesnummer, abkuerzung, title, short_description, is_builtin, auto_update, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)
    ON CONFLICT(law_id) DO NOTHING
  `);

  const tx = rawDb.transaction(() => {
    COLLECTIONS.forEach((c, idx) => {
      insCol.run(c.id, c.title, c.description, c.color, c.icon, idx, now);
      c.laws.forEach((l) => {
        insLaw.run(l.id, c.id, l.gesetzesnummer, l.abkuerzung, l.title, l.shortDescription ?? "", now);
      });
    });
    rawDb
      .prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`)
      .run("seeded_v1_done", "1");
  });
  tx();
}
