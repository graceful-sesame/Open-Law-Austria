import { db, rawDb } from "./db";
import {
  cachedDocuments,
  lawIndex,
  bookmarks,
  notes,
  userCollections,
  userLaws,
  type CachedDocument,
  type InsertCachedDocument,
  type LawIndex,
  type InsertLawIndex,
  type Bookmark,
  type InsertBookmark,
  type Note,
  type InsertNote,
  type UserCollection,
  type InsertUserCollection,
  type UserLaw,
  type InsertUserLaw,
  highlights,
  type Highlight,
  type InsertHighlight,
} from "@shared/schema";
import { eq, and, like, or, inArray, sql } from "drizzle-orm";

// ─── Natural paragraph sort helper ──────────────────────────────────────────
//
// Austrian legal paragraph labels can look like:
//   "§ 1", "§ 1a", "§ 1b", "§ 2", "§ 10", "§ 196a", "§ 279",
//   "Art. 1", "Art. II", "Art. III", "Art. 4 § 2", "Art. 4 § 3",
//   "Anlage 1", "Anlage 2a"
// and the BGBl.-header entry sometimes becomes "§ 0" or has no number at all.
//
// We want: plain §-paragraphs FIRST, then Artikel (incl. "Art. X § Y"),
// then Anlagen, then everything else. IMPORTANT: "Art. 4 § 2" contains a
// §-sign — so we must check for "Art" BEFORE checking for §, otherwise the
// composite labels would be sorted in with the plain paragraphs.
function classifyLabel(s: string): 0 | 1 | 2 | 3 {
  const lower = s.toLowerCase();
  if (/\bart(\.|ikel)?\b/i.test(s)) return 1;
  if (/\banlage\b/i.test(lower)) return 2;
  if (/§/.test(s) || /^\s*\d/.test(s)) return 0;
  return 3;
}

// Extract the first numeric group and the (optional) single-letter suffix.
// Returns [num, suffix, rest] where num is +Infinity if no number exists
// (pushes labels without a number to the end of their class).
function parseLabel(s: string): { num: number; suffix: string; rest: string } {
  const m = s.match(/(\d+)\s*([a-zA-Z]?)/);
  if (!m) return { num: Number.POSITIVE_INFINITY, suffix: "", rest: s };
  return { num: parseInt(m[1], 10), suffix: (m[2] || "").toLowerCase(), rest: s };
}

// Roman numeral parser — Austrian Artikel labels often look like "Art. III",
// "Art. IV". Returns +Infinity for non-Roman strings so they sort after numeric ones.
function parseRoman(s: string): number {
  const m = s.match(/\b([IVXLCDM]+)\b/i);
  if (!m) return Number.POSITIVE_INFINITY;
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const str = m[1].toLowerCase();
  let total = 0;
  for (let i = 0; i < str.length; i++) {
    const cur = map[str[i]];
    const next = map[str[i + 1]];
    if (!cur) return Number.POSITIVE_INFINITY;
    if (next && cur < next) total -= cur;
    else total += cur;
  }
  return total > 0 ? total : Number.POSITIVE_INFINITY;
}

// Parse an "Artikel" label, which may be:
//   "Art. 4"            → { artNum: 4, paraNum: -1 }
//   "Art. 4 § 2"        → { artNum: 4, paraNum: 2, paraSuffix: "" }
//   "Art. 4 § 2a"       → { artNum: 4, paraNum: 2, paraSuffix: "a" }
//   "Art. III"          → { artNum: 3 (roman), paraNum: -1 }
// paraNum = -1 means "plain Art. X without §" → must come BEFORE "Art. X § Y".
function parseArtikel(s: string): { artNum: number; artSuffix: string; paraNum: number; paraSuffix: string } {
  // Strip the leading "Art."/"Artikel" (incl. trailing dot/whitespace) so we
  // can isolate the article number. The trailing dot is *not* a word char,
  // so we have to consume it explicitly.
  const stripped = s.replace(/\bart(ikel)?\.?\s*/i, "").trim();
  // Try arabic number first.
  const arabic = stripped.match(/^(\d+)\s*([a-zA-Z]?)/);
  let artNum: number;
  let artSuffix = "";
  let afterArt = stripped;
  if (arabic) {
    artNum = parseInt(arabic[1], 10);
    artSuffix = (arabic[2] || "").toLowerCase();
    afterArt = stripped.slice(arabic[0].length);
  } else {
    artNum = parseRoman(stripped);
    const rom = stripped.match(/^([IVXLCDM]+)/i);
    if (rom) afterArt = stripped.slice(rom[0].length);
  }
  // Now look for an optional "§ N" tail.
  const para = afterArt.match(/§\s*(\d+)\s*([a-zA-Z]?)/);
  if (para) {
    return {
      artNum,
      artSuffix,
      paraNum: parseInt(para[1], 10),
      paraSuffix: (para[2] || "").toLowerCase(),
    };
  }
  return { artNum, artSuffix, paraNum: -1, paraSuffix: "" };
}

function compareParagraph(a: string, b: string): number {
  const ca = classifyLabel(a);
  const cb = classifyLabel(b);
  if (ca !== cb) return ca - cb;

  // Within the Artikel class, sort by article number, then by article suffix,
  // then by inner § number, then by suffix. Plain "Art. X" (paraNum = -1)
  // comes before "Art. X § 2".
  if (ca === 1) {
    const pa = parseArtikel(a);
    const pb = parseArtikel(b);
    if (pa.artNum !== pb.artNum) return pa.artNum - pb.artNum;
    if (pa.artSuffix !== pb.artSuffix) return pa.artSuffix.localeCompare(pb.artSuffix);
    if (pa.paraNum !== pb.paraNum) return pa.paraNum - pb.paraNum;
    if (pa.paraSuffix !== pb.paraSuffix) return pa.paraSuffix.localeCompare(pb.paraSuffix);
    return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
  }

  const pa = parseLabel(a);
  const pb = parseLabel(b);
  if (pa.num !== pb.num) return pa.num - pb.num;
  if (pa.suffix !== pb.suffix) return pa.suffix.localeCompare(pb.suffix);
  return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
}

export interface IStorage {
  // Cached documents
  getCachedDocument(dokumentnummer: string): CachedDocument | undefined;
  getCachedDocumentsForLaw(gesetzesnummer: string): CachedDocument[];
  upsertCachedDocument(doc: InsertCachedDocument): CachedDocument;
  searchCachedDocuments(query: string, gesetzesnummern?: string[]): CachedDocument[];

  // Law index
  getLawIndex(gesetzesnummer: string): LawIndex | undefined;
  upsertLawIndex(entry: InsertLawIndex): LawIndex;

  // Bookmarks
  getBookmarks(): Bookmark[];
  getBookmark(dokumentnummer: string): Bookmark | undefined;
  addBookmark(bm: InsertBookmark): Bookmark;
  removeBookmark(dokumentnummer: string): void;

  // Notes
  getNotesForDocument(dokumentnummer: string): Note[];
  getAllNotes(): Note[];
  addNote(note: InsertNote): Note;
  updateNote(id: number, content: string): Note | undefined;
  deleteNote(id: number): void;

  // User Collections
  getUserCollections(): UserCollection[];
  getUserCollection(collectionId: string): UserCollection | undefined;
  addUserCollection(col: InsertUserCollection): UserCollection;
  updateUserCollection(collectionId: string, data: Partial<InsertUserCollection>): UserCollection | undefined;
  deleteUserCollection(collectionId: string): void;

  // User Laws
  getUserLaws(): UserLaw[];
  getUserLawsForCollection(collectionId: string): UserLaw[];
  getUserLaw(lawId: string): UserLaw | undefined;
  getUserLawByGesetzesnummer(gesetzesnummer: string): UserLaw | undefined;
  addUserLaw(law: InsertUserLaw): UserLaw;
  updateUserLaw(lawId: string, data: Partial<InsertUserLaw>): UserLaw | undefined;
  deleteUserLaw(lawId: string): void;

  // Custom ordering of laws inside a collection
  getLawOrder(collectionId: string): Map<string, number>;
  setLawOrder(collectionId: string, lawIds: string[]): void;
  removeLawFromOrder(collectionId: string, lawId: string): void;

  // Highlights (Textmarker)
  getHighlight(dokumentnummer: string): Highlight | undefined;
  upsertHighlight(dokumentnummer: string, htmlContent: string): Highlight;
  deleteHighlight(dokumentnummer: string): void;

  // Settings
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
}

export class DatabaseStorage implements IStorage {
  // ─── Cached Documents ───────────────────────────────────────────────────

  getCachedDocument(dokumentnummer: string): CachedDocument | undefined {
    return db
      .select()
      .from(cachedDocuments)
      .where(eq(cachedDocuments.dokumentnummer, dokumentnummer))
      .get();
  }

  getCachedDocumentsForLaw(gesetzesnummer: string): CachedDocument[] {
    const rows = db
      .select()
      .from(cachedDocuments)
      .where(eq(cachedDocuments.gesetzesnummer, gesetzesnummer))
      .all();
    // Natural sort by artikelParagraphAnlage so the sidebar reflects the
    // law's logical structure regardless of insertion order in the DB.
    // Handles e.g. "§ 1", "§ 1a", "§ 2", "§ 10", "§ 196a", "Art. III",
    // "Anlage 2". Rows without a number fall back to a pure locale compare.
    return rows.sort((a, b) => compareParagraph(a.artikelParagraphAnlage ?? "", b.artikelParagraphAnlage ?? ""));
  }

  upsertCachedDocument(doc: InsertCachedDocument): CachedDocument {
    // Single-statement upsert: avoids the prior SELECT + conditional INSERT/UPDATE.
    return db
      .insert(cachedDocuments)
      .values({ ...doc, cachedAt: Date.now() })
      .onConflictDoUpdate({
        target: cachedDocuments.dokumentnummer,
        set: { ...doc, cachedAt: Date.now() },
      })
      .returning()
      .get();
  }

  searchCachedDocuments(query: string, gesetzesnummern?: string[]): CachedDocument[] {
    const pattern = `%${query.toLowerCase()}%`;
    // Push filtering to SQL: avoid loading all documents + all HTML into memory.
    // LIKE on lower() is fast for short fields; inhalt search runs in SQLite
    // page cache rather than pulling every HTML blob into the JS heap.
    const textCondition = or(
      sql`lower(${cachedDocuments.artikelParagraphAnlage}) LIKE ${pattern}`,
      sql`lower(${cachedDocuments.kurztitel}) LIKE ${pattern}`,
      sql`lower(${cachedDocuments.inhalt}) LIKE ${pattern}`,
    );

    if (gesetzesnummern && gesetzesnummern.length > 0) {
      return db
        .select()
        .from(cachedDocuments)
        .where(and(inArray(cachedDocuments.gesetzesnummer, gesetzesnummern), textCondition))
        .all();
    }
    return db.select().from(cachedDocuments).where(textCondition).all();
  }

  // ─── Law Index ──────────────────────────────────────────────────────────

  getLawIndex(gesetzesnummer: string): LawIndex | undefined {
    return db
      .select()
      .from(lawIndex)
      .where(eq(lawIndex.gesetzesnummer, gesetzesnummer))
      .get();
  }

  upsertLawIndex(entry: InsertLawIndex): LawIndex {
    // Single-statement upsert.
    return db
      .insert(lawIndex)
      .values({ ...entry, cachedAt: Date.now() })
      .onConflictDoUpdate({
        target: lawIndex.gesetzesnummer,
        set: { ...entry, cachedAt: Date.now() },
      })
      .returning()
      .get();
  }

  // ─── Bookmarks ──────────────────────────────────────────────────────────

  getBookmarks(): Bookmark[] {
    return db.select().from(bookmarks).all();
  }

  getBookmark(dokumentnummer: string): Bookmark | undefined {
    return db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.dokumentnummer, dokumentnummer))
      .get();
  }

  addBookmark(bm: InsertBookmark): Bookmark {
    const existing = this.getBookmark(bm.dokumentnummer);
    if (existing) return existing;
    return db.insert(bookmarks).values({ ...bm, createdAt: Date.now() }).returning().get();
  }

  removeBookmark(dokumentnummer: string): void {
    db.delete(bookmarks).where(eq(bookmarks.dokumentnummer, dokumentnummer)).run();
  }

  // ─── Notes ──────────────────────────────────────────────────────────────

  getNotesForDocument(dokumentnummer: string): Note[] {
    return db
      .select()
      .from(notes)
      .where(eq(notes.dokumentnummer, dokumentnummer))
      .all();
  }

  getAllNotes(): Note[] {
    return db.select().from(notes).all();
  }

  addNote(note: InsertNote): Note {
    const now = Date.now();
    return db.insert(notes).values({ ...note, createdAt: now, updatedAt: now }).returning().get();
  }

  updateNote(id: number, content: string): Note | undefined {
    db.update(notes)
      .set({ content, updatedAt: Date.now() })
      .where(eq(notes.id, id))
      .run();
    return db.select().from(notes).where(eq(notes.id, id)).get();
  }

  deleteNote(id: number): void {
    db.delete(notes).where(eq(notes.id, id)).run();
  }

  // ─── User Collections ─────────────────────────────────────────

  getUserCollections(): UserCollection[] {
    return db.select().from(userCollections).all();
  }

  getUserCollection(collectionId: string): UserCollection | undefined {
    return db.select().from(userCollections).where(eq(userCollections.collectionId, collectionId)).get();
  }

  addUserCollection(col: InsertUserCollection): UserCollection {
    return db.insert(userCollections).values({ ...col, createdAt: col.createdAt ?? Date.now() }).returning().get();
  }

  updateUserCollection(collectionId: string, data: Partial<InsertUserCollection>): UserCollection | undefined {
    db.update(userCollections).set(data).where(eq(userCollections.collectionId, collectionId)).run();
    return this.getUserCollection(collectionId);
  }

  deleteUserCollection(collectionId: string): void {
    db.delete(userCollections).where(eq(userCollections.collectionId, collectionId)).run();
    // Also delete associated user laws
    db.delete(userLaws).where(eq(userLaws.collectionId, collectionId)).run();
  }

  // ─── User Laws ───────────────────────────────────────────────

  getUserLaws(): UserLaw[] {
    return db.select().from(userLaws).all();
  }

  getUserLawsForCollection(collectionId: string): UserLaw[] {
    return db.select().from(userLaws).where(eq(userLaws.collectionId, collectionId)).all();
  }

  getUserLaw(lawId: string): UserLaw | undefined {
    return db.select().from(userLaws).where(eq(userLaws.lawId, lawId)).get();
  }

  getUserLawByGesetzesnummer(gesetzesnummer: string): UserLaw | undefined {
    return db.select().from(userLaws).where(eq(userLaws.gesetzesnummer, gesetzesnummer)).get();
  }

  addUserLaw(law: InsertUserLaw): UserLaw {
    return db.insert(userLaws).values({ ...law, createdAt: law.createdAt ?? Date.now() }).returning().get();
  }

  updateUserLaw(lawId: string, data: Partial<InsertUserLaw>): UserLaw | undefined {
    db.update(userLaws).set(data).where(eq(userLaws.lawId, lawId)).run();
    return this.getUserLaw(lawId);
  }

  deleteUserLaw(lawId: string): void {
    // Capture gesetzesnummer before deleting so we can purge cached docs
    const law = this.getUserLaw(lawId);
    db.delete(userLaws).where(eq(userLaws.lawId, lawId)).run();
    if (law) {
      rawDb.prepare(`DELETE FROM cached_documents WHERE gesetzesnummer = ?`).run(law.gesetzesnummer);
      rawDb.prepare(`DELETE FROM law_index WHERE gesetzesnummer = ?`).run(law.gesetzesnummer);
    }
    // Remove any custom ordering rows referencing this law
    rawDb.prepare(`DELETE FROM law_order WHERE law_id = ?`).run(lawId);
  }

  // ─── Law Order (custom sorting within a collection) ───

  /** Returns map of lawId → sortIndex for the given collection. */
  getLawOrder(collectionId: string): Map<string, number> {
    const rows = rawDb
      .prepare(`SELECT law_id, sort_index FROM law_order WHERE collection_id = ?`)
      .all(collectionId) as { law_id: string; sort_index: number }[];
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.law_id, r.sort_index);
    return m;
  }

  /** Persist the full ordered list of lawIds for a collection. */
  setLawOrder(collectionId: string, lawIds: string[]): void {
    const del = rawDb.prepare(`DELETE FROM law_order WHERE collection_id = ?`);
    const ins = rawDb.prepare(
      `INSERT INTO law_order (collection_id, law_id, sort_index) VALUES (?, ?, ?)`
    );
    const tx = rawDb.transaction((ids: string[]) => {
      del.run(collectionId);
      ids.forEach((id, idx) => ins.run(collectionId, id, idx));
    });
    tx(lawIds);
  }

  /** Remove a single law from the ordering of a specific collection. */
  removeLawFromOrder(collectionId: string, lawId: string): void {
    rawDb
      .prepare(`DELETE FROM law_order WHERE collection_id = ? AND law_id = ?`)
      .run(collectionId, lawId);
  }

  // ─── Settings (key/value) ───
  getSetting(key: string): string | undefined {
    const row = rawDb.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    rawDb.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`).run(key, value);
  }

  // ─── Invalidate law cache (used when user clicks "reload") ───
  clearLawCache(gesetzesnummer: string): void {
    rawDb.prepare(`DELETE FROM cached_documents WHERE gesetzesnummer = ?`).run(gesetzesnummer);
    rawDb.prepare(`DELETE FROM law_index WHERE gesetzesnummer = ?`).run(gesetzesnummer);
  }
  // ─── Highlights (Textmarker) ────────────────────────────────────────────

  getHighlight(dokumentnummer: string): Highlight | undefined {
    return db
      .select()
      .from(highlights)
      .where(eq(highlights.dokumentnummer, dokumentnummer))
      .get();
  }

  upsertHighlight(dokumentnummer: string, htmlContent: string): Highlight {
    const now = Date.now();
    const existing = this.getHighlight(dokumentnummer);
    if (existing) {
      db.update(highlights)
        .set({ htmlContent, updatedAt: now })
        .where(eq(highlights.dokumentnummer, dokumentnummer))
        .run();
      return this.getHighlight(dokumentnummer)!;
    }
    return db.insert(highlights).values({ dokumentnummer, htmlContent, updatedAt: now }).returning().get();
  }

  deleteHighlight(dokumentnummer: string): void {
    db.delete(highlights).where(eq(highlights.dokumentnummer, dokumentnummer)).run();
  }

}

export const storage = new DatabaseStorage();
