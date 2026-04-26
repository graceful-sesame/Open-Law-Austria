import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { searchBundesrecht, fetchAllDocumentsForLaw, fetchDocumentHtml, extractParagraphTitle, extractSectionInfo } from "../lib/risClient";

// Derive the paragraph-specific title from the cached HTML on the fly.
// Returns null if the paragraph has no body cached yet or no title is
// extractable (e.g. § 0 BGBl. listings). This is intentionally a pure
// derivation — we do not persist the extracted title anywhere, which
// eliminates the race conditions and override chains that plagued the
// previous design.
function deriveParagraphTitle(
  inhalt: string | null | undefined,
  paragraphLabel: string | null | undefined,
  lawTitle: string | null | undefined,
): string | null {
  if (!inhalt) return null;
  return extractParagraphTitle(
    inhalt,
    paragraphLabel ?? undefined,
    (lawTitle ?? "").trim() || undefined,
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getLawById(lawId: string) {
  const law = storage.getUserLaw(lawId);
  if (!law) return undefined;
  const col = storage.getUserCollection(law.collectionId);
  if (!col) return undefined;
  return {
    law: {
      id: law.lawId,
      gesetzesnummer: law.gesetzesnummer,
      abkuerzung: law.abkuerzung,
      title: law.title,
      shortDescription: law.shortDescription ?? "",
      autoUpdate: law.autoUpdate === 1,
      isBuiltin: law.isBuiltin === 1,
    },
    collection: {
      id: col.collectionId,
      title: col.title,
      description: col.description,
      color: col.color,
      icon: col.icon,
      isBuiltin: col.isBuiltin === 1,
    },
  };
}

function getLawByGesetzesnummer(gesetzesnummer: string) {
  const law = storage.getUserLawByGesetzesnummer(gesetzesnummer);
  if (!law) return undefined;
  return getLawById(law.lawId);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function uniqueLawSlug(base: string): Promise<string> {
  let slug = base || "gesetz";
  let i = 2;
  while (storage.getUserLaw(slug)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

async function uniqueCollectionSlug(base: string): Promise<string> {
  let slug = base || "collection";
  let i = 2;
  while (storage.getUserCollection(slug)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

// ─── Background download job tracking ──────────────────────────────────────
const downloadJobs = new Map<string, {
  gesetzesnummer: string;
  total: number;
  done: number;
  status: "running" | "done" | "error";
  error?: string;
  startedAt: number;
}>();

// Purge completed/errored jobs older than 1 hour to prevent unbounded memory growth.
const JOB_TTL_MS = 60 * 60 * 1000;
function purgeStaleDownloadJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [key, job] of downloadJobs) {
    if (job.status !== "running" && job.startedAt < cutoff) {
      downloadJobs.delete(key);
    }
  }
}

async function downloadFullLaw(
  gesetzesnummer: string,
  opts: { forceFresh?: boolean; concurrency?: number } = {}
) {
  const concurrency = opts.concurrency ?? 4;

  // Ensure we have a fresh doc list
  const docs = await fetchAllDocumentsForLaw(gesetzesnummer);

  // Purge stale jobs before registering a new one.
  purgeStaleDownloadJobs();

  // Seed job state
  downloadJobs.set(gesetzesnummer, {
    gesetzesnummer,
    total: docs.length,
    done: 0,
    status: "running",
    startedAt: Date.now(),
  });

  // Upsert metadata for every doc first (so sidebar gets populated immediately).
  // kurztitel is just stored as whatever RIS gives us — it's no longer used for
  // the sidebar title (that's derived from HTML on the fly). We keep the field
  // so admin/search tooling still has a human-readable label.
  //
  // Build a Map of already-cached docs in one batch query so the worker loop
  // below does not have to issue individual SELECT calls per document.
  const existingDocsMap = new Map(
    storage.getCachedDocumentsForLaw(gesetzesnummer).map((d) => [d.dokumentnummer, d]),
  );
  for (const doc of docs) {
    const existing = existingDocsMap.get(doc.dokumentnummer);
    storage.upsertCachedDocument({
      gesetzesnummer,
      dokumentnummer: doc.dokumentnummer,
      abkuerzung: doc.abkuerzung ?? existing?.abkuerzung ?? null,
      kurztitel: doc.kurztitel ?? existing?.kurztitel ?? null,
      artikelParagraphAnlage: doc.artikelParagraphAnlage,
      inhalt: opts.forceFresh ? null : existing?.inhalt ?? null,
      abschnitt: existing?.abschnitt ?? null,
      inkrafttretedatum: doc.inkrafttretedatum ?? existing?.inkrafttretedatum ?? null,
      dokumentUrl: doc.dokumentUrl ?? existing?.dokumentUrl ?? null,
      cachedAt: Date.now(),
    });
  }

  // Upsert index now (so UI can render sidebar even while contents still load)
  const law = storage.getUserLawByGesetzesnummer(gesetzesnummer);
  storage.upsertLawIndex({
    gesetzesnummer,
    abkuerzung: law?.abkuerzung ?? docs[0]?.abkuerzung ?? "",
    title: law?.title ?? docs[0]?.kurztitel ?? "",
    totalDocs: docs.length,
    cachedAt: Date.now(),
  });

  // Fetch missing HTML bodies with bounded concurrency
  const queue = docs.filter((d) => {
    if (opts.forceFresh) return true;
    const c = storage.getCachedDocument(d.dokumentnummer);
    return !c?.inhalt;
  });

  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const i = cursor++;
      const doc = queue[i];
      try {
        const fetchUrl = (doc.dokumentUrl && doc.dokumentUrl.startsWith("http"))
          ? doc.dokumentUrl
          : `https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=${doc.dokumentnummer}`;
        const html = await fetchDocumentHtml(fetchUrl);
        // Use the already-loaded Map entry; fall back to a DB read only if
        // the doc was somehow not present at scan time (very rare).
        const existing = existingDocsMap.get(doc.dokumentnummer)
          ?? storage.getCachedDocument(doc.dokumentnummer);
        if (existing) {
          // Extract section info (Teil/Abschnitt) from the HTML and store it.
          const sectionInfo = extractSectionInfo(html);
          storage.upsertCachedDocument({
            ...existing,
            inhalt: html,
            abschnitt: sectionInfo ? JSON.stringify(sectionInfo) : existing.abschnitt,
            cachedAt: Date.now(),
          });
        }
      } catch (e) {
        // Individual failures are tolerated; leave inhalt=null for retry later
        console.warn(`Doc ${doc.dokumentnummer} failed:`, (e as Error).message);
      }
      const job = downloadJobs.get(gesetzesnummer);
      if (job) { job.done++; downloadJobs.set(gesetzesnummer, job); }
      // Gentle rate limiting
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  // Count already-loaded docs toward progress
  const preLoaded = docs.length - queue.length;
  const job = downloadJobs.get(gesetzesnummer);
  if (job) { job.done = preLoaded; downloadJobs.set(gesetzesnummer, job); }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, () => worker());
  await Promise.all(workers);

  const finalJob = downloadJobs.get(gesetzesnummer);
  if (finalJob) {
    finalJob.status = "done";
    finalJob.done = finalJob.total;
    downloadJobs.set(gesetzesnummer, finalJob);
  }
}

// Fire-and-forget wrapper that records errors
function downloadFullLawInBackground(gesetzesnummer: string, forceFresh = false) {
  downloadFullLaw(gesetzesnummer, { forceFresh }).catch((err) => {
    const j = downloadJobs.get(gesetzesnummer);
    if (j) {
      j.status = "error";
      j.error = err?.message ?? String(err);
      downloadJobs.set(gesetzesnummer, j);
    }
    console.error(`Download failed for ${gesetzesnummer}:`, err);
  });
}

// ─── Auto-update scheduler ─────────────────────────────────────────────────
function getAutoUpdateTtlMs(): number {
  const v = storage.getSetting("auto_update_ttl_hours");
  const h = v ? parseInt(v, 10) : 24;
  return (Number.isFinite(h) && h > 0 ? h : 24) * 60 * 60 * 1000;
}

function scheduleAutoUpdates() {
  // Run every hour; refresh any law whose cache is older than TTL AND auto_update=1
  const CHECK_INTERVAL = 60 * 60 * 1000; // 1h
  setInterval(() => {
    try {
      const ttl = getAutoUpdateTtlMs();
      const laws = storage.getUserLaws();
      for (const law of laws) {
        if (law.autoUpdate !== 1) continue;
        const idx = storage.getLawIndex(law.gesetzesnummer);
        if (!idx) continue; // never loaded — leave for manual download
        if (Date.now() - idx.cachedAt > ttl) {
          console.log(`[auto-update] refreshing ${law.abkuerzung} (${law.gesetzesnummer})`);
          downloadFullLawInBackground(law.gesetzesnummer, false);
        }
      }
    } catch (e) {
      console.warn("auto-update tick failed:", e);
    }
  }, CHECK_INTERVAL);
}

// ─── Routes ────────────────────────────────────────────────────────────────

export function registerRoutes(_httpServer: Server, app: Express) {
  // Start the background scheduler once
  scheduleAutoUpdates();

  // ─── Public Collections & Laws ──────────────────────────────────────────

  app.get("/api/collections", (_req, res) => {
    res.json(buildCollectionsPayload());
  });

  app.get("/api/laws/:lawId", (req, res) => {
    const entry = getLawById(req.params.lawId);
    if (!entry) return res.status(404).json({ error: "Gesetz nicht gefunden" });

    const idx = storage.getLawIndex(entry.law.gesetzesnummer);
    res.json({ ...entry.law, collection: entry.collection, cached: !!idx, docCount: idx?.totalDocs ?? 0 });
  });

  // ─── Law Index (Paragraphenliste) ───────────────────────────────────────

  app.get("/api/laws/:lawId/index", async (req, res) => {
    const entry = getLawById(req.params.lawId);
    if (!entry) return res.status(404).json({ error: "Gesetz nicht gefunden" });
    const { law } = entry;

    const ttl = getAutoUpdateTtlMs();
    const existing = storage.getLawIndex(law.gesetzesnummer);

    // If auto-update is OFF: always serve cached (if any), never expire.
    // If auto-update is ON: expire based on ttl.
    const shouldRefresh = law.autoUpdate
      ? (!existing || Date.now() - existing.cachedAt > ttl)
      : !existing;

    if (!shouldRefresh && existing) {
      const docs = storage.getCachedDocumentsForLaw(law.gesetzesnummer);
      return res.json({ law: existing, documents: docs.map((d) => docToRef(d, law.title)) });
    }

    try {
      // Kick off a full download (includes bodies!) but don't block the response
      // on body-fetching — return metadata ASAP so the sidebar renders.
      const docs = await fetchAllDocumentsForLaw(law.gesetzesnummer);
      for (const doc of docs) {
        const prev = storage.getCachedDocument(doc.dokumentnummer);
        storage.upsertCachedDocument({
          gesetzesnummer: law.gesetzesnummer,
          dokumentnummer: doc.dokumentnummer,
          abkuerzung: doc.abkuerzung ?? law.abkuerzung,
          kurztitel: doc.kurztitel ?? prev?.kurztitel ?? law.title,
          artikelParagraphAnlage: doc.artikelParagraphAnlage,
          inhalt: prev?.inhalt ?? null,
          abschnitt: prev?.abschnitt ?? null,
          inkrafttretedatum: doc.inkrafttretedatum ?? prev?.inkrafttretedatum ?? null,
          dokumentUrl: doc.dokumentUrl ?? prev?.dokumentUrl ?? null,
          cachedAt: Date.now(),
        });
      }

      const idx = storage.upsertLawIndex({
        gesetzesnummer: law.gesetzesnummer,
        abkuerzung: law.abkuerzung,
        title: law.title,
        totalDocs: docs.length,
        cachedAt: Date.now(),
      });

      // Background fill HTML bodies (doesn't block response)
      downloadFullLawInBackground(law.gesetzesnummer, false);

      const cachedDocs = storage.getCachedDocumentsForLaw(law.gesetzesnummer);
      return res.json({ law: idx, documents: cachedDocs.map((d) => docToRef(d, law.title)) });
    } catch (err: any) {
      console.error("RIS fetch error:", err);
      // Graceful fallback: if we have *any* cache, serve it
      if (existing) {
        const docs = storage.getCachedDocumentsForLaw(law.gesetzesnummer);
        return res.json({ law: existing, documents: docs.map((d) => docToRef(d, law.title)) });
      }
      return res.status(502).json({ error: `RIS API nicht erreichbar: ${err.message}` });
    }
  });

  // ─── Einzelnes Dokument ─────────────────────────────────────────────────

  app.get("/api/document/:dokumentnummer", async (req, res) => {
    const { dokumentnummer } = req.params;
    let cached = storage.getCachedDocument(dokumentnummer);

    // Cached HTML available → serve instantly
    if (cached?.inhalt) {
      return res.json({
        ...cached,
        isBookmarked: !!storage.getBookmark(dokumentnummer),
        notes: storage.getNotesForDocument(dokumentnummer),
      });
    }

    // Otherwise fetch on demand
    try {
      const fetchUrl = (cached?.dokumentUrl && cached.dokumentUrl.startsWith("http"))
        ? cached.dokumentUrl
        : `https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=${dokumentnummer}`;
      const html = await fetchDocumentHtml(fetchUrl);

      if (cached) {
        // Extract section info (Teil/Abschnitt) from HTML and store it.
        const sectionInfo = extractSectionInfo(html);
        storage.upsertCachedDocument({
          ...cached,
          inhalt: html,
          abschnitt: sectionInfo ? JSON.stringify(sectionInfo) : cached.abschnitt,
          cachedAt: Date.now(),
        });
      } else {
        storage.upsertCachedDocument({
          gesetzesnummer: "unknown",
          dokumentnummer,
          abkuerzung: null,
          kurztitel: null,
          artikelParagraphAnlage: null,
          inhalt: html,
          abschnitt: null,
          inkrafttretedatum: null,
          dokumentUrl: fetchUrl,
          cachedAt: Date.now(),
        });
      }

      cached = storage.getCachedDocument(dokumentnummer)!;
      return res.json({
        ...cached,
        isBookmarked: !!storage.getBookmark(dokumentnummer),
        notes: storage.getNotesForDocument(dokumentnummer),
      });
    } catch (err: any) {
      if (cached) {
        return res.json({
          ...cached,
          isBookmarked: !!storage.getBookmark(dokumentnummer),
          notes: storage.getNotesForDocument(dokumentnummer),
        });
      }
      return res.status(502).json({ error: `RIS Dokument nicht ladbar: ${err.message}` });
    }
  });

  // ─── Suche ──────────────────────────────────────────────────────────────

  app.get("/api/search", async (req, res) => {
    const query = String(req.query.q ?? "").trim();
    const collectionId = req.query.collection ? String(req.query.collection) : undefined;
    const lawId = req.query.law ? String(req.query.law) : undefined;

    if (!query || query.length < 2) return res.json({ results: [], totalHits: 0 });

    // Restrict the search to the user's downloaded/added laws only — we never
    // hit the RIS API here. The user explicitly wants offline-only search
    // across already-cached content (paragraph titles + full text).
    let gesetzesnummern: string[];
    if (collectionId) {
      gesetzesnummern = storage
        .getUserLawsForCollection(collectionId)
        .map((l) => l.gesetzesnummer);
    } else if (lawId) {
      const entry = getLawById(lawId);
      gesetzesnummern = entry ? [entry.law.gesetzesnummer] : [];
    } else {
      gesetzesnummern = storage.getUserLaws().map((l) => l.gesetzesnummer);
    }

    if (gesetzesnummern.length === 0) {
      return res.json({ results: [], totalHits: 0 });
    }

    // Full-text search against cached documents (matches inhalt, paragraph
    // label, and short title — see storage.searchCachedDocuments).
    const cachedResults = storage.searchCachedDocuments(query, gesetzesnummern);

    const merged: any[] = [];
    const seen = new Set<string>();

    for (const doc of cachedResults) {
      if (seen.has(doc.dokumentnummer)) continue;
      seen.add(doc.dokumentnummer);
      // Only keep results whose law is currently in the user's library so
      // that the link target exists. Documents whose law was removed are
      // skipped silently.
      const lawEntry = doc.gesetzesnummer ? getLawByGesetzesnummer(doc.gesetzesnummer) : undefined;
      if (!lawEntry) continue;

      merged.push({
        dokumentnummer: doc.dokumentnummer,
        abkuerzung: doc.abkuerzung ?? lawEntry.law.abkuerzung ?? "?",
        artikelParagraphAnlage: doc.artikelParagraphAnlage,
        kurztitel: doc.kurztitel ?? lawEntry.law.title ?? "",
        collection: lawEntry.collection?.title ?? "",
        collectionId: lawEntry.collection?.id ?? "",
        lawId: lawEntry.law.id ?? "",
        // Prefer a snippet from the actual law text so the user sees the
        // matched phrase in context. Falls back to the short title when no
        // full text is cached yet.
        snippet: generateSnippet(doc.inhalt ?? doc.kurztitel ?? "", query),
        fromCache: true,
      });
    }

    return res.json({ results: merged.slice(0, 100), totalHits: merged.length });
  });


  // ─── Law Registry (für §-Verlinkung im Frontend) ────────────────────────

  // Gibt alle geladenen Gesetze zurück: lawId, abkuerzung, gesetzesnummer
  // Wird vom Frontend genutzt, um Abkürzungen wie "SMG" → lawId aufzulösen.
  app.get("/api/law-registry", (_req, res) => {
    const laws = storage.getUserLaws();
    res.json(
      laws.map((l) => ({
        lawId: l.lawId,
        abkuerzung: l.abkuerzung,
        gesetzesnummer: l.gesetzesnummer,
      }))
    );
  });

  // Sucht die NOR-Nummer eines Paragraphen in einem bestimmten Gesetz.
  // Abfrage: ?gesetzesnummer=10002326&para=37
  app.get("/api/find-para", (req, res) => {
    const gn = String(req.query.gesetzesnummer ?? "");
    const para = String(req.query.para ?? "").toLowerCase().trim();
    if (!gn || !para) return res.json({ dokumentnummer: null });

    const docs = storage.getCachedDocumentsForLaw(gn);
    const found = docs.find((d) => {
      const m = d.artikelParagraphAnlage?.match(
        /^(?:§§?|Art\.?|Artikel|Anlage)\s*(\S+)/i
      );
      return m && m[1].toLowerCase() === para;
    });
    return res.json({ dokumentnummer: found?.dokumentnummer ?? null });
  });

  // ─── Bookmarks ──────────────────────────────────────────────────────────

  app.get("/api/bookmarks", (_req, res) => res.json(storage.getBookmarks()));

  app.post("/api/bookmarks", (req, res) => {
    const { dokumentnummer, gesetzesnummer, abkuerzung, artikelParagraphAnlage } = req.body;
    if (!dokumentnummer || !gesetzesnummer || !abkuerzung || !artikelParagraphAnlage) {
      return res.status(400).json({ error: "Fehlende Felder" });
    }
    const bm = storage.addBookmark({ dokumentnummer, gesetzesnummer, abkuerzung, artikelParagraphAnlage, createdAt: Date.now() });
    return res.json(bm);
  });

  app.delete("/api/bookmarks/:dokumentnummer", (req, res) => {
    storage.removeBookmark(req.params.dokumentnummer);
    return res.json({ ok: true });
  });


  // ─── Highlights (Textmarker – server-seitig) ────────────────────────────

  app.get("/api/highlights/:dokumentnummer", (req, res) => {
    const hl = storage.getHighlight(req.params.dokumentnummer);
    if (!hl) return res.json({ htmlContent: null });
    return res.json({ htmlContent: hl.htmlContent });
  });

  app.put("/api/highlights/:dokumentnummer", (req, res) => {
    const { htmlContent } = req.body;
    if (typeof htmlContent !== "string") {
      return res.status(400).json({ error: "htmlContent fehlt" });
    }
    if (!htmlContent.trim() || !htmlContent.includes("ola-hl")) {
      // Wenn keine Markierungen mehr vorhanden, Eintrag löschen
      storage.deleteHighlight(req.params.dokumentnummer);
      return res.json({ ok: true });
    }
    const hl = storage.upsertHighlight(req.params.dokumentnummer, htmlContent);
    return res.json(hl);
  });

  app.delete("/api/highlights/:dokumentnummer", (req, res) => {
    storage.deleteHighlight(req.params.dokumentnummer);
    return res.json({ ok: true });
  });

  // ─── Notes ──────────────────────────────────────────────────────────────

  app.get("/api/notes", (_req, res) => res.json(storage.getAllNotes()));
  app.get("/api/notes/:dokumentnummer", (req, res) =>
    res.json(storage.getNotesForDocument(req.params.dokumentnummer)));

  app.post("/api/notes", (req, res) => {
    const { dokumentnummer, gesetzesnummer, abkuerzung, artikelParagraphAnlage, content } = req.body;
    if (!dokumentnummer || !content) return res.status(400).json({ error: "Fehlende Felder" });
    const note = storage.addNote({
      dokumentnummer,
      gesetzesnummer: gesetzesnummer ?? "unknown",
      abkuerzung: abkuerzung ?? "",
      artikelParagraphAnlage: artikelParagraphAnlage ?? "",
      content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return res.json(note);
  });

  app.patch("/api/notes/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "Inhalt fehlt" });
    const note = storage.updateNote(id, content);
    if (!note) return res.status(404).json({ error: "Notiz nicht gefunden" });
    return res.json(note);
  });

  app.delete("/api/notes/:id", (req, res) => {
    storage.deleteNote(parseInt(req.params.id, 10));
    return res.json({ ok: true });
  });

  // ─── Admin: Collections (unified DB-backed) ─────────────────────────────

  // ─── Admin auth middleware (optional ADMIN_TOKEN) ─────────────────────────
  // If the ADMIN_TOKEN env variable is set, all /api/admin/* routes require
  // an "Authorization: Bearer <token>" header. If not set, admin routes are
  // accessible without authentication (suitable for local / single-user use).
  //
  // ⚠️ WICHTIG: Wenn diese Instanz öffentlich erreichbar ist, ADMIN_TOKEN setzen!
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() || "";

  function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
    if (!ADMIN_TOKEN) { next(); return; }
    const auth = req.headers.authorization ?? "";
    if (auth === `Bearer ${ADMIN_TOKEN}`) { next(); return; }
    res.status(401).json({
      error: "Nicht autorisiert. Bitte ADMIN_TOKEN als Bearer-Token im Authorization-Header senden.",
    });
  }

  app.get("/api/admin/collections", requireAdminAuth, (_req, res) => {
    res.json(buildCollectionsPayload());
  });

  app.post("/api/admin/collections", requireAdminAuth, async (req, res) => {
    const { title, description, color, icon } = req.body;
    if (!title) return res.status(400).json({ error: "title ist Pflichtfeld" });
    const slug = await uniqueCollectionSlug(slugify(title));
    const col = storage.addUserCollection({
      collectionId: slug,
      title,
      description: description ?? "",
      color: color ?? "blue",
      icon: icon ?? "BookOpen",
      isBuiltin: 0,
      sortIndex: (storage.getUserCollections().length),
      createdAt: Date.now(),
    } as any);
    return res.json(col);
  });

  app.patch("/api/admin/collections/:collectionId", requireAdminAuth, (req, res) => {
    const col = storage.getUserCollection(req.params.collectionId);
    if (!col) return res.status(404).json({ error: "Collection nicht gefunden" });
    const { title, description, color, icon } = req.body ?? {};
    const updated = storage.updateUserCollection(req.params.collectionId, {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(icon !== undefined ? { icon } : {}),
    });
    return res.json(updated);
  });

  app.delete("/api/admin/collections/:collectionId", requireAdminAuth, (req, res) => {
    const col = storage.getUserCollection(req.params.collectionId);
    if (!col) return res.status(404).json({ error: "Nicht gefunden" });
    // Delete all laws in this collection too (cascades cache purge)
    const laws = storage.getUserLawsForCollection(req.params.collectionId);
    for (const l of laws) storage.deleteUserLaw(l.lawId);
    storage.deleteUserCollection(req.params.collectionId);
    return res.json({ ok: true });
  });

  app.put("/api/admin/collections/:collectionId/order", requireAdminAuth, (req, res) => {
    const { collectionId } = req.params;
    const { lawIds } = req.body as { lawIds?: string[] };
    if (!Array.isArray(lawIds)) return res.status(400).json({ error: "lawIds muss ein Array sein" });
    if (!storage.getUserCollection(collectionId)) {
      return res.status(404).json({ error: "Collection nicht gefunden" });
    }
    storage.setLawOrder(collectionId, lawIds);
    return res.json({ ok: true });
  });

  // ─── Admin: Laws (editable — including previously-builtin) ──────────────

  app.get("/api/admin/laws", requireAdminAuth, (_req, res) => res.json(storage.getUserLaws()));

  app.post("/api/admin/laws", requireAdminAuth, async (req, res) => {
    const { gesetzesnummer, collectionId, abkuerzung, title, shortDescription, autoUpdate } = req.body;
    if (!gesetzesnummer || !collectionId || !abkuerzung || !title) {
      return res.status(400).json({ error: "gesetzesnummer, collectionId, abkuerzung und title sind Pflichtfelder" });
    }
    if (storage.getUserLawByGesetzesnummer(gesetzesnummer)) {
      return res.status(409).json({ error: `Gesetzesnummer ${gesetzesnummer} bereits vorhanden` });
    }

    try {
      const test = await searchBundesrecht({ gesetzesnummer, seitengroesse: 20 });
      if (test.totalHits === 0) {
        return res.status(422).json({ error: `Keine Dokumente für Gesetzesnummer ${gesetzesnummer} in RIS gefunden.` });
      }
    } catch {
      return res.status(502).json({ error: "RIS-API nicht erreichbar." });
    }

    if (!storage.getUserCollection(collectionId)) {
      return res.status(400).json({ error: `Collection '${collectionId}' nicht gefunden` });
    }

    const lawId = await uniqueLawSlug(slugify(abkuerzung));
    const law = storage.addUserLaw({
      lawId,
      collectionId,
      gesetzesnummer,
      abkuerzung,
      title,
      shortDescription: shortDescription ?? "",
      isBuiltin: 0,
      autoUpdate: autoUpdate === false ? 0 : 1,
      createdAt: Date.now(),
    } as any);

    // Immediately kick off full download (metadata + all paragraph bodies)
    downloadFullLawInBackground(gesetzesnummer, true);

    return res.json(law);
  });

  app.patch("/api/admin/laws/:lawId", requireAdminAuth, (req, res) => {
    const law = storage.getUserLaw(req.params.lawId);
    if (!law) return res.status(404).json({ error: "Nicht gefunden" });
    const { abkuerzung, title, shortDescription, collectionId, autoUpdate } = req.body ?? {};

    if (collectionId && collectionId !== law.collectionId) {
      if (!storage.getUserCollection(collectionId)) {
        return res.status(400).json({ error: `Collection '${collectionId}' nicht gefunden` });
      }
    }

    const updated = storage.updateUserLaw(req.params.lawId, {
      ...(abkuerzung !== undefined ? { abkuerzung } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(shortDescription !== undefined ? { shortDescription } : {}),
      ...(collectionId !== undefined ? { collectionId } : {}),
      ...(autoUpdate !== undefined ? { autoUpdate: autoUpdate ? 1 : 0 } : {}),
    } as any);
    return res.json(updated);
  });

  app.delete("/api/admin/laws/:lawId", requireAdminAuth, (req, res) => {
    const law = storage.getUserLaw(req.params.lawId);
    if (!law) return res.status(404).json({ error: "Nicht gefunden" });
    storage.deleteUserLaw(req.params.lawId);
    return res.json({ ok: true });
  });

  // Remove a law from a specific collection — in this unified model,
  // deletion is always global. We keep the route for backward compat.
  app.delete("/api/admin/collections/:collectionId/laws/:lawId", requireAdminAuth, (req, res) => {
    const { lawId } = req.params;
    const law = storage.getUserLaw(lawId);
    if (!law) return res.status(404).json({ error: "Nicht gefunden" });
    storage.deleteUserLaw(lawId);
    return res.json({ ok: true });
  });

  // ─── Admin: trigger full download / refresh ─────────────────────────────

  app.post("/api/admin/laws/:lawId/download", requireAdminAuth, async (req, res) => {
    const law = storage.getUserLaw(req.params.lawId);
    if (!law) return res.status(404).json({ error: "Nicht gefunden" });
    const forceFresh = !!req.body?.forceFresh;
    // If already running, return current progress
    const existing = downloadJobs.get(law.gesetzesnummer);
    if (existing && existing.status === "running") {
      return res.json({ started: false, ...existing });
    }
    downloadFullLawInBackground(law.gesetzesnummer, forceFresh);
    return res.json({ started: true, gesetzesnummer: law.gesetzesnummer });
  });

  app.get("/api/admin/laws/:lawId/download", requireAdminAuth, (req, res) => {
    const law = storage.getUserLaw(req.params.lawId);
    if (!law) return res.status(404).json({ error: "Nicht gefunden" });
    const job = downloadJobs.get(law.gesetzesnummer);
    const idx = storage.getLawIndex(law.gesetzesnummer);
    // Count how many have HTML content cached
    const docs = storage.getCachedDocumentsForLaw(law.gesetzesnummer);
    const withContent = docs.filter((d) => !!d.inhalt).length;
    return res.json({
      gesetzesnummer: law.gesetzesnummer,
      indexCached: !!idx,
      total: idx?.totalDocs ?? docs.length,
      withContent,
      job: job ?? null,
    });
  });

  // ─── Admin: RIS Lookup ──────────────────────────────────────────────────

  app.get("/api/admin/ris-lookup", requireAdminAuth, async (req, res) => {
    const gesetzesnummer = String(req.query.gesetzesnummer ?? "").trim();
    if (!gesetzesnummer) return res.status(400).json({ error: "gesetzesnummer fehlt" });
    try {
      const result = await searchBundesrecht({ gesetzesnummer, seitengroesse: 20 });
      if (result.totalHits === 0) return res.json({ found: false, totalHits: 0 });
      const first = result.documents[0];
      return res.json({
        found: true,
        totalHits: result.totalHits,
        kurztitel: first?.kurztitel ?? "",
        abkuerzung: first?.abkuerzung ?? "",
        gesetzesnummer: first?.gesetzesnummer ?? gesetzesnummer,
      });
    } catch {
      return res.status(502).json({ error: "RIS nicht erreichbar" });
    }
  });

  // ─── Admin: Global settings (e.g. auto-update default) ──────────────────

  app.get("/api/admin/settings", requireAdminAuth, (_req, res) => {
    res.json({
      autoUpdateTtlHours: parseInt(storage.getSetting("auto_update_ttl_hours") ?? "24", 10),
      defaultAutoUpdate: (storage.getSetting("default_auto_update") ?? "1") === "1",
    });
  });

  app.patch("/api/admin/settings", requireAdminAuth, (req, res) => {
    const { autoUpdateTtlHours, defaultAutoUpdate } = req.body ?? {};
    if (autoUpdateTtlHours !== undefined) {
      storage.setSetting("auto_update_ttl_hours", String(parseInt(autoUpdateTtlHours, 10) || 24));
    }
    if (defaultAutoUpdate !== undefined) {
      storage.setSetting("default_auto_update", defaultAutoUpdate ? "1" : "0");
    }
    res.json({
      autoUpdateTtlHours: parseInt(storage.getSetting("auto_update_ttl_hours") ?? "24", 10),
      defaultAutoUpdate: (storage.getSetting("default_auto_update") ?? "1") === "1",
    });
  });
}

// ─── Payload builder ───────────────────────────────────────────────────────

function buildCollectionsPayload() {
  const annotate = (l: any) => ({
    ...l,
    cached: !!storage.getLawIndex(l.gesetzesnummer),
    docCount: storage.getLawIndex(l.gesetzesnummer)?.totalDocs ?? 0,
  });

  const lawToDto = (l: any) => ({
    id: l.lawId,
    gesetzesnummer: l.gesetzesnummer,
    abkuerzung: l.abkuerzung,
    title: l.title,
    shortDescription: l.shortDescription ?? "",
    autoUpdate: l.autoUpdate === 1,
    isBuiltin: l.isBuiltin === 1,
    // Kept for UI backward compat — "user law" means editable. Now all are editable.
    isUserLaw: l.isBuiltin !== 1,
  });

  const applyOrder = (collectionId: string, laws: any[]) => {
    const orderMap = storage.getLawOrder(collectionId);
    if (orderMap.size === 0) return laws;
    const withOrder = laws.map((l, natIdx) => ({
      law: l,
      idx: orderMap.has(l.id) ? (orderMap.get(l.id) as number) : Number.POSITIVE_INFINITY,
      natIdx,
    }));
    withOrder.sort((a, b) => (a.idx - b.idx) || (a.natIdx - b.natIdx));
    return withOrder.map((x) => x.law);
  };

  const cols = storage.getUserCollections();
  // Sort collections: by sort_index, then alphabetically
  cols.sort((a: any, b: any) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0) || a.title.localeCompare(b.title));

  return cols.map((c) => {
    const laws = storage.getUserLawsForCollection(c.collectionId).map(lawToDto);
    return {
      id: c.collectionId,
      title: c.title,
      description: c.description,
      color: c.color,
      icon: c.icon,
      isBuiltin: c.isBuiltin === 1,
      laws: applyOrder(c.collectionId, laws).map(annotate),
    };
  });
}

function docToRef(doc: any, lawTitle?: string) {
  // Parse section info from stored JSON (or null if not yet extracted)
  let abschnitt: { g1?: string; g2?: string; g3?: string } | null = null;
  if (doc.abschnitt) {
    try { abschnitt = JSON.parse(doc.abschnitt); } catch { abschnitt = null; }
  }
  return {
    dokumentnummer: doc.dokumentnummer,
    artikelParagraphAnlage: doc.artikelParagraphAnlage,
    abkuerzung: doc.abkuerzung,
    kurztitel: doc.kurztitel,
    // paragraphTitle is derived from the cached HTML body on every request.
    paragraphTitle: deriveParagraphTitle(doc.inhalt, doc.artikelParagraphAnlage, lawTitle),
    inkrafttretedatum: doc.inkrafttretedatum,
    hasContent: !!doc.inhalt,
    abschnitt,
  };
}

function generateSnippet(text: string, query: string, maxLen = 200): string {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const idx = plain.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return plain.slice(0, maxLen);
  const start = Math.max(0, idx - 80);
  const end = Math.min(plain.length, idx + query.length + 120);
  return (start > 0 ? "…" : "") + plain.slice(start, end) + (end < plain.length ? "…" : "");
}
