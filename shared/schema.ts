import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Cached law document (one paragraph/article = one document in RIS)
export const cachedDocuments = sqliteTable("cached_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gesetzesnummer: text("gesetzesnummer").notNull(),
  dokumentnummer: text("dokumentnummer").notNull().unique(),
  abkuerzung: text("abkuerzung"),
  kurztitel: text("kurztitel"),
  artikelParagraphAnlage: text("artikel_paragraph_anlage"),
  inhalt: text("inhalt"), // HTML content
  abschnitt: text("abschnitt"), // heading/section info as JSON
  inkrafttretedatum: text("inkrafttretedatum"),
  dokumentUrl: text("dokument_url"),
  cachedAt: integer("cached_at").notNull(),
});

export const insertCachedDocumentSchema = createInsertSchema(cachedDocuments).omit({ id: true });
export type InsertCachedDocument = z.infer<typeof insertCachedDocumentSchema>;
export type CachedDocument = typeof cachedDocuments.$inferSelect;

// Law index (metadata per Gesetz)
export const lawIndex = sqliteTable("law_index", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gesetzesnummer: text("gesetzesnummer").notNull().unique(),
  abkuerzung: text("abkuerzung").notNull(),
  title: text("title").notNull(),
  totalDocs: integer("total_docs").default(0),
  cachedAt: integer("cached_at").notNull(),
});

export const insertLawIndexSchema = createInsertSchema(lawIndex).omit({ id: true });
export type InsertLawIndex = z.infer<typeof insertLawIndexSchema>;
export type LawIndex = typeof lawIndex.$inferSelect;

// Bookmarks (Favoriten)
export const bookmarks = sqliteTable("bookmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dokumentnummer: text("dokumentnummer").notNull(),
  gesetzesnummer: text("gesetzesnummer").notNull(),
  abkuerzung: text("abkuerzung").notNull(),
  artikelParagraphAnlage: text("artikel_paragraph_anlage").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const insertBookmarkSchema = createInsertSchema(bookmarks).omit({ id: true });
export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Bookmark = typeof bookmarks.$inferSelect;

// Notes (Notizen)
export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dokumentnummer: text("dokumentnummer").notNull(),
  gesetzesnummer: text("gesetzesnummer").notNull(),
  abkuerzung: text("abkuerzung").notNull(),
  artikelParagraphAnlage: text("artikel_paragraph_anlage").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const insertNoteSchema = createInsertSchema(notes).omit({ id: true });
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Note = typeof notes.$inferSelect;

// ─── User-defined Collections & Laws (Admin/Modular system) ─────────────────

// Collections (sowohl eingebaute (seeded) als auch user-defined werden hier gespeichert)
export const userCollections = sqliteTable("user_collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  collectionId: text("collection_id").notNull().unique(), // slug, e.g. "arbeitsrecht"
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("blue"),   // Tailwind color
  icon: text("icon").notNull().default("BookOpen"), // Lucide icon name
  isBuiltin: integer("is_builtin").notNull().default(0), // 1 = urspr. eingebaut (beim ersten Start geseedet)
  sortIndex: integer("sort_index").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const insertUserCollectionSchema = createInsertSchema(userCollections).omit({ id: true });
export type InsertUserCollection = z.infer<typeof insertUserCollectionSchema>;
export type UserCollection = typeof userCollections.$inferSelect;

// Laws (eingebaute + user-defined, alle in DB, frei editierbar)
export const userLaws = sqliteTable("user_laws", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lawId: text("law_id").notNull().unique(),           // slug, e.g. "avg"
  collectionId: text("collection_id").notNull(),       // ref to user_collections.collection_id
  gesetzesnummer: text("gesetzesnummer").notNull().unique(),
  abkuerzung: text("abkuerzung").notNull(),
  title: text("title").notNull(),
  shortDescription: text("short_description").default(""),
  isBuiltin: integer("is_builtin").notNull().default(0),     // 1 = urspr. eingebaut
  autoUpdate: integer("auto_update").notNull().default(1),   // 1 = auto updates an, 0 = aus
  createdAt: integer("created_at").notNull(),
});

export const insertUserLawSchema = createInsertSchema(userLaws).omit({ id: true });
export type InsertUserLaw = z.infer<typeof insertUserLawSchema>;
export type UserLaw = typeof userLaws.$inferSelect;

// Highlights (Textmarker) – server-seitig gespeichert
export const highlights = sqliteTable("highlights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dokumentnummer: text("dokumentnummer").notNull().unique(),
  htmlContent: text("html_content").notNull(), // gesamter innerHTML mit <mark class="ola-hl">-Tags
  updatedAt: integer("updated_at").notNull(),
});

export const insertHighlightSchema = createInsertSchema(highlights).omit({ id: true });
export type InsertHighlight = z.infer<typeof insertHighlightSchema>;
export type Highlight = typeof highlights.$inferSelect;
