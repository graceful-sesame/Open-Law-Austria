import { useQuery, useMutation, useQueries } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Bookmark, BookmarkCheck, StickyNote,
  Loader2, AlertCircle, Plus, Trash2, X,
  BookOpen, Search, Menu, ChevronLeft,
  Highlighter
} from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { linkifyLegalRefs, findNorForPara, type LawRegistryEntry, type ParaDoc } from "@/lib/linkifyRefs";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SectionInfo {
  g1?: string; // e.g. "Allgemeiner Teil"
  g2?: string; // e.g. "Erster Abschnitt"
  g3?: string; // e.g. "Allgemeine Bestimmungen"
}

interface DocMeta {
  dokumentnummer: string;
  artikelParagraphAnlage: string;
  kurztitel?: string;
  // Paragraph-specific title derived on the server from the cached HTML body.
  // null when the body isn't cached yet or no title is extractable.
  paragraphTitle?: string | null;
  abkuerzung?: string;
  gesetzesnummer?: string;
  inkrafttretedatum?: string;
  hasContent?: boolean;
  abschnitt?: SectionInfo | null;
}

interface DocContent extends DocMeta {
  inhalt?: string;
  isBookmarked?: boolean;
  notes?: Note[];
  error?: string;
}

interface Note {
  id: number;
  content: string;
  updatedAt: number;
}

// ─── Paragraph Block ─────────────────────────────────────────────────────────

function ParagraphBlock({
  doc,
  lawMeta,
  activeNoteDoc,
  setActiveNoteDoc,
  allDocs,
  lawRegistry,
  scrollToAnchor,
}: {
  doc: DocContent;
  lawMeta: any;
  activeNoteDoc: string | null;
  setActiveNoteDoc: (nr: string | null) => void;
  allDocs: ParaDoc[];
  lawRegistry: LawRegistryEntry[];
  scrollToAnchor: (nr: string) => void;
}) {
  const { toast } = useToast();
  const [newNote, setNewNote] = useState("");

  const addBookmarkMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/bookmarks", data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document", doc.dokumentnummer] });
      // Refresh the law-wide bookmark list (powers the sidebar markers and
      // the per-law bookmarks popover).
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
      toast({ title: "Lesezeichen gesetzt" });
    },
  });

  const removeBookmarkMutation = useMutation({
    mutationFn: (nr: string) => apiRequest("DELETE", `/api/bookmarks/${nr}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document", doc.dokumentnummer] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
      toast({ title: "Lesezeichen entfernt" });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/notes", data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document", doc.dokumentnummer] });
      setNewNote("");
      toast({ title: "Notiz gespeichert" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/notes/${id}`).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/document", doc.dokumentnummer] }),
  });

  function toggleBookmark() {
    if (doc.isBookmarked) {
      removeBookmarkMutation.mutate(doc.dokumentnummer);
    } else {
      addBookmarkMutation.mutate({
        dokumentnummer: doc.dokumentnummer,
        gesetzesnummer: doc.gesetzesnummer ?? lawMeta?.gesetzesnummer ?? "",
        abkuerzung: doc.abkuerzung ?? lawMeta?.abkuerzung ?? "",
        artikelParagraphAnlage: doc.artikelParagraphAnlage ?? "",
      });
    }
  }

  function submitNote() {
    if (!newNote.trim()) return;
    addNoteMutation.mutate({
      dokumentnummer: doc.dokumentnummer,
      gesetzesnummer: doc.gesetzesnummer ?? lawMeta?.gesetzesnummer ?? "",
      abkuerzung: doc.abkuerzung ?? lawMeta?.abkuerzung ?? "",
      artikelParagraphAnlage: doc.artikelParagraphAnlage ?? "",
      content: newNote.trim(),
    });
  }

  const cleanedInhalt = (() => {
    if (!doc.inhalt) return doc.inhalt;
    let h = doc.inhalt;
    // 0) Screenreader-only Spans aus dem RIS-HTML entfernen.
    //    Das RIS liefert seit ~2025 alle Nummern doppelt:
    //      <span aria-hidden="true">(1)</span>
    //      <span class="sr-only">Absatz eins,</span>
    //    Die sr-only-Spans sind per CSS unsichtbar, sofern die Klasse
    //    im Bundle enthalten ist. Zur Sicherheit werden sie hier auch
    //    direkt aus dem HTML-String entfernt.
    h = h.replace(/<span[^>]*\bclass="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "");
    // 1) UeberschrPara / UeberschrG2 etc. (paragraph titles in headings)
    h = h.replace(
      /<(h[1-6]|span|div)[^>]*class="[^"]*Ueberschr(?:Para|G[12])[^"]*"[^>]*>[\s\S]*?<\/\1>/gi,
      ""
    );
    // 2) GldSymbol (the "§ N." marker)
    h = h.replace(
      /<(h[1-6]|span|div)[^>]*class="[^"]*GldSymbol[^"]*"[^>]*>[\s\S]*?<\/\1>/gi,
      ""
    );
    // 3) Plain-text leading "§ N." or "Art. N." line at the very top
    h = h.replace(
      /(<(?:p|div)[^>]*>)\s*(§|Art\.?|Artikel|Anlage)\s*\d+[a-z]?\.?\s*(<\/(?:p|div)>)/i,
      ""
    );
    return h;
  })();

  const notesOpen = activeNoteDoc === doc.dokumentnummer;

  // ─── Highlight / Textmarker (server-seitig gespeichert) ────────────────────
  // Speichert das gerenderte HTML mit eingefuegten <mark class="ola-hl"
  // data-color="...">-Tags pro Paragraph in der Server-DB.
  // Markierungen sind damit geraeteuebergreifend sichtbar.
  const HL_COLORS = [
    { key: "yellow", label: "Gelb",  hex: "#fde68a" },
    { key: "red",    label: "Rot",   hex: "#fecaca" },
    { key: "green",  label: "Gruen", hex: "#bbf7d0" },
    { key: "purple", label: "Lila",  hex: "#e9d5ff" },
    { key: "blue",   label: "Blau",  hex: "#bfdbfe" },
  ] as const;
  type HlColorKey = typeof HL_COLORS[number]["key"];

  const [highlightOpen, setHighlightOpen] = useState(false);
  const [hlColor, setHlColor] = useState<HlColorKey>("yellow");
  const paragraphContentRef = useRef<HTMLDivElement | null>(null);

  const [renderedHtml, setRenderedHtml] = useState<string | undefined>(() => cleanedInhalt ?? undefined);
  // dirty-Flag: true sobald der User selbst Highlights gesetzt hat → verhindert
  // dass ein React-Query-Refetch die nicht-gespeicherten Aenderungen ueberschreibt.
  const isDirty = useRef(false);

  // ── §-Verlinkung: linkedHtml wird aus renderedHtml berechnet ─────────────
  // Highlights werden in renderedHtml gespeichert (mit <mark>-Tags).
  // linkifyLegalRefs läuft darüber und injiziert <a class="ola-para-link">
  // Tags für §-Referenzen — ohne die Highlights zu beschädigen.
  const linkedHtml = useMemo(() => {
    if (!renderedHtml) return renderedHtml;
    return linkifyLegalRefs(
      renderedHtml,
      allDocs,
      lawRegistry,
      lawMeta?.id ?? "",
      lawMeta?.gesetzesnummer ?? ""
    );
  }, [renderedHtml, allDocs, lawRegistry, lawMeta]);

  // ── Click-Handler für §-Links (Event Delegation) ──────────────────────
  const [, navigate] = useLocation();
  const handleParaLinkClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const link = (e.target as HTMLElement).closest(".ola-para-link") as HTMLElement | null;
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();

      const targetLawId = link.getAttribute("data-law-id") ?? "";
      const norId = link.getAttribute("data-nor");
      const paraNum = link.getAttribute("data-para");
      const targetGn = link.getAttribute("data-gn") ?? "";
      const currentLawId = lawMeta?.id ?? "";

      if (targetLawId === currentLawId || !targetLawId) {
        // Selbes Gesetz: sofort scrollen
        if (norId) {
          scrollToAnchor(norId);
        } else if (paraNum) {
          const nor = findNorForPara(allDocs, paraNum);
          if (nor) {
            scrollToAnchor(nor);
          } else {
            toast({ description: `§ ${paraNum} in diesem Gesetz nicht gefunden.` });
          }
        }
      } else {
        // Anderes Gesetz
        if (norId) {
          navigate(`/law/${targetLawId}/doc/${norId}`);
        } else if (paraNum) {
          // NOR über API nachschlagen, dann navigieren
          fetch(`/api/find-para?gesetzesnummer=${encodeURIComponent(targetGn)}&para=${encodeURIComponent(paraNum)}`)
            .then((r) => r.json())
            .then(({ dokumentnummer }: { dokumentnummer: string | null }) => {
              if (dokumentnummer) {
                navigate(`/law/${targetLawId}/doc/${dokumentnummer}`);
              } else {
                navigate(`/law/${targetLawId}`);
              }
            })
            .catch(() => navigate(`/law/${targetLawId}`));
        } else {
          navigate(`/law/${targetLawId}`);
        }
      }
    },
    [lawMeta, allDocs, scrollToAnchor, navigate, toast]
  );
  // Gespeicherte Highlights vom Server laden
  const { data: savedHighlightData } = useQuery<{ htmlContent: string | null }>({
    queryKey: ["/api/highlights", doc.dokumentnummer],
    queryFn: () => fetch(`/api/highlights/${doc.dokumentnummer}`).then((r) => r.json()),
    enabled: !!doc.dokumentnummer && !!cleanedInhalt,
  });

  useEffect(() => {
    if (!cleanedInhalt) return;
    // Wenn der User bereits Aenderungen gemacht hat (dirty), nicht ueberschreiben.
    if (isDirty.current) return;
    const saved = savedHighlightData?.htmlContent;
    if (saved && saved.includes("ola-hl")) {
      setRenderedHtml(saved);
    } else {
      setRenderedHtml(cleanedInhalt);
    }
  }, [cleanedInhalt, savedHighlightData]);

  const saveHighlightMutation = useMutation({
    mutationFn: (htmlContent: string) =>
      apiRequest("PUT", `/api/highlights/${doc.dokumentnummer}`, { htmlContent }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/highlights", doc.dokumentnummer] });
    },
  });

  const deleteHighlightMutation = useMutation({
    mutationFn: () =>
      apiRequest("DELETE", `/api/highlights/${doc.dokumentnummer}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/highlights", doc.dokumentnummer] });
    },
  });

  function persistHighlights() {
    if (!paragraphContentRef.current) return;
    isDirty.current = true;
    const html = paragraphContentRef.current.innerHTML;
    saveHighlightMutation.mutate(html);
  }

  // Wendet die aktuelle Auswahl als Highlight an.
  // Hilfsfunktion: Gibt alle Text-Knoten zurueck, die im Range liegen.
  // Funktioniert auch bei Auswahlen ueber mehrere Block-Elemente (Absaetze).
  function getTextNodesInRange(range: Range): Text[] {
    const textNodes: Text[] = [];
    const ancestor =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentNode!
        : range.commonAncestorContainer;
    const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (range.intersectsNode(node)) {
        textNodes.push(node);
      }
    }
    return textNodes;
  }

  function applyHighlightToSelection() {
    if (!highlightOpen) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const root = paragraphContentRef.current;
    if (!root) return;
    // Nur Auswahlen innerhalb dieses Paragraph-Inhalts erlauben
    if (!root.contains(range.commonAncestorContainer)) return;

    const color = HL_COLORS.find((c) => c.key === hlColor)!;

    // Neue Strategie: Jeden Text-Knoten im Range einzeln umhuellen.
    // Dadurch bleibt <mark> immer ein Inline-Element innerhalb seines
    // Block-Elternteils — auch bei Auswahlen ueber mehrere Absaetze hinweg.
    try {
      const textNodes = getTextNodesInRange(range);
      if (textNodes.length === 0) return;

      for (const textNode of textNodes) {
        // Wenn der Textknoten bereits in einem ola-hl-Mark liegt:
        // Farbe aendern statt neu verschachteln.
        const existingMark = textNode.parentElement?.closest("mark.ola-hl") as HTMLElement | null;
        if (existingMark) {
          existingMark.setAttribute("data-color", color.key);
          existingMark.style.backgroundColor = color.hex;
          continue;
        }
        // Start- und End-Offset fuer diesen spezifischen Text-Knoten bestimmen
        let startOffset = 0;
        let endOffset = textNode.textContent?.length ?? 0;
        if (textNode === range.startContainer) startOffset = range.startOffset;
        if (textNode === range.endContainer) endOffset = range.endOffset;
        if (startOffset >= endOffset) continue;

        // Text-Node aufsplitten: [davor] [markiert] [danach]
        const selectedText = textNode.splitText(startOffset);
        selectedText.splitText(endOffset - startOffset);

        const mark = document.createElement("mark");
        mark.className = "ola-hl";
        mark.setAttribute("data-color", color.key);
        mark.style.backgroundColor = color.hex;
        // Schrift auf den Markierungsfarben immer dunkel halten,
        // damit der Kontrast in Light- und Dark-Mode stimmt.
        mark.style.color = "#1a1a1a";
        mark.style.padding = "0 1px";
        mark.style.borderRadius = "2px";

        selectedText.parentNode!.insertBefore(mark, selectedText);
        mark.appendChild(selectedText);
      }

      sel.removeAllRanges();
      persistHighlights();
    } catch (err) {
      // Im Fehlerfall still abbrechen
      console.warn("Highlight fehlgeschlagen", err);
    }
  }

  function clearAllHighlights() {
    const root = paragraphContentRef.current;
    if (!root) return;
    const marks = root.querySelectorAll("mark.ola-hl");
    marks.forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
    root.normalize();
    // dirty zuruecksetzen: nach dem Loeschen kann der Server-Stand wieder laden.
    isDirty.current = false;
    deleteHighlightMutation.mutate();
    toast({ title: "Markierungen entfernt" });
  }

  // Resolve the title shown in the single header line. Prefer the
  // server-derived paragraphTitle (parsed from the body) and fall back to
  // a non-redundant kurztitel.
  const paraTitle = (doc as any).paragraphTitle as string | null | undefined;
  const headerTitle: string | null = paraTitle
    ? paraTitle
    : doc.kurztitel && doc.kurztitel !== (lawMeta?.title ?? "")
      ? doc.kurztitel
      : null;

  // Strip the redundant pieces from the rendered HTML body so the on-screen
  // content doesn't duplicate what the new compact header already shows:
  //   - the paragraph-title heading (UeberschrPara…/UeberschrG…)
  //   - the "§ N." / "Art. N." gliederungs-marker
  //   - any trailing "Quelle: RIS …" line that some bodies carry
  

  return (
    <article
      id={doc.dokumentnummer}
      className="scroll-mt-28 mb-12 border-b border-border/50 pb-10 last:border-0"
      data-testid={`article-${doc.dokumentnummer}`}
    >
      {/* Jump anchor — sits at the exact top of this paragraph block and is
          used by scrollToAnchor() to compute the precise target Y. Keeping
          it here (not on <article>) means it stays stable across loading,
          error and content states of the parent block. */}
      <span data-jump-anchor={doc.dokumentnummer} aria-hidden="true" className="block" />
      {/* Header: "§ N  Title  [Bookmark] [Notes]" — wraps over multiple
          lines if the title is long, so nothing is ever cut off. */}
      <div className="flex items-start gap-3 mb-4 pb-3 border-b border-border">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0 flex-1">
          <span className="font-mono font-bold text-primary shrink-0">
            {doc.artikelParagraphAnlage}
          </span>
          {headerTitle && (
            <span className="font-semibold text-foreground break-words">
              {headerTitle}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 px-2 gap-1 text-xs ${doc.isBookmarked ? "text-amber-600 dark:text-amber-400" : ""}`}
            onClick={toggleBookmark}
            data-testid={`button-bookmark-${doc.dokumentnummer}`}
          >
            {doc.isBookmarked ? (
              <BookmarkCheck className="w-3.5 h-3.5" />
            ) : (
              <Bookmark className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 px-2 gap-1 text-xs ${notesOpen ? "bg-accent/10 text-accent" : ""}`}
            onClick={() => setActiveNoteDoc(notesOpen ? null : doc.dokumentnummer)}
            data-testid={`button-notes-${doc.dokumentnummer}`}
          >
            <StickyNote className="w-3.5 h-3.5" />
            {doc.notes && doc.notes.length > 0 && (
              <Badge className="h-4 text-xs px-1">{doc.notes.length}</Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 px-2 gap-1 text-xs ${highlightOpen ? "bg-accent/10 text-accent" : ""}`}
            onClick={() => setHighlightOpen((v) => !v)}
            data-testid={`button-highlight-${doc.dokumentnummer}`}
            title={highlightOpen ? "Bearbeitungsmodus beenden" : "Textmarker"}
          >
            <Highlighter className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Highlight-Farbleiste (nur im Bearbeitungsmodus sichtbar) */}
      {highlightOpen && (
        <div
          className="flex items-center gap-2 mb-3 p-2 rounded-md border border-border bg-muted/40"
          data-testid={`highlight-toolbar-${doc.dokumentnummer}`}
        >
          <span className="text-xs text-muted-foreground mr-1">Farbe:</span>
          {HL_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setHlColor(c.key)}
              title={c.label}
              aria-label={c.label}
              className={`h-6 w-6 rounded-full border transition-all ${
                hlColor === c.key
                  ? "ring-2 ring-offset-1 ring-primary border-primary"
                  : "border-border hover:scale-110"
              }`}
              style={{ backgroundColor: c.hex }}
              data-testid={`hl-color-${c.key}`}
            />
          ))}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:bg-destructive/10"
            onClick={clearAllHighlights}
            title="Alle Markierungen entfernen"
            data-testid={`button-clear-highlights-${doc.dokumentnummer}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Content or loading/error */}
      {doc.error ? (
        <div>
          <div className="flex items-center gap-2 text-destructive text-sm p-3 rounded border border-destructive/30 bg-destructive/10 mb-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{doc.error}</span>
          </div>
          <a
            href={`https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=${doc.dokumentnummer}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary underline"
          >
            Auf RIS.bka.gv.at ansehen →
          </a>
        </div>
      ) : cleanedInhalt ? (
        <div
          ref={paragraphContentRef}
          onMouseUp={applyHighlightToSelection}
          onTouchEnd={applyHighlightToSelection}
          className={`law-text ris-content prose prose-sm dark:prose-invert max-w-none
            [&_table]:text-sm [&_td]:p-1.5 [&_th]:p-1.5
            [&_h1]:text-base [&_h1]:font-bold [&_h1]:text-primary
            [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-primary
            [&_h3]:text-sm [&_h3]:font-semibold
            [&_p]:mb-3 [&_p]:text-foreground
            [&_ul]:list-none [&_ul]:pl-0 [&_ol]:list-none [&_ol]:pl-0
            [&_li]:list-none [&_li]:pl-0 [&_li]:text-foreground
            [&_li]:before:content-none [&_li]:marker:content-none
            [&_a]:text-primary [&_a]:underline
            [&_strong]:font-semibold
            ${highlightOpen ? "cursor-text outline outline-2 outline-dashed outline-accent/40 outline-offset-4 rounded" : ""}`}
          data-testid={`content-${doc.dokumentnummer}`}
          dangerouslySetInnerHTML={{ __html: linkedHtml || cleanedInhalt || "" }}
          onClick={handleParaLinkClick}
        />
      ) : (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 bg-muted rounded w-full" />
          <div className="h-4 bg-muted rounded w-5/6" />
          <div className="h-4 bg-muted rounded w-full" />
          <div className="h-4 bg-muted rounded w-4/5" />
        </div>
      )}

      {/* Notes inline */}
      {notesOpen && (
        <div className="mt-6 p-4 rounded-lg border border-border bg-muted/30">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold">Notizen</h4>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setActiveNoteDoc(null)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          {doc.notes && doc.notes.length > 0 ? (
            <div className="space-y-2 mb-3">
              {doc.notes.map((note) => (
                <div key={note.id} className="group flex items-start gap-2 bg-card rounded border border-border p-2.5">
                  <p className="flex-1 text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                    {note.content}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 text-destructive"
                    onClick={() => deleteNoteMutation.mutate(note.id)}
                    data-testid={`button-delete-note-${note.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mb-3">Noch keine Notizen.</p>
          )}

          <div className="flex gap-2">
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Neue Notiz…"
              rows={2}
              className="flex-1 text-xs resize-none"
              data-testid={`input-note-${doc.dokumentnummer}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitNote();
              }}
            />
            <Button
              size="sm"
              className="self-end h-8 text-xs"
              onClick={submitNote}
              disabled={!newNote.trim() || addNoteMutation.isPending}
              data-testid={`button-add-note-${doc.dokumentnummer}`}
            >
              {addNoteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1">Ctrl+Enter zum Speichern</p>
        </div>
      )}

    </article>
  );
}

// ─── Section Header ──────────────────────────────────────────────────────────

function SectionHeader({ info }: { info: SectionInfo }) {
  return (
    <div
      className="section-header mb-6 mt-10 first:mt-0 pt-4 border-t-2 border-primary/20"
      data-section-g1={info.g1}
      data-section-g2={info.g2}
    >
      {info.g1 && (
        <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-0.5">
          {info.g1}
        </p>
      )}
      {info.g2 && (
        <h2 className="text-base font-bold text-foreground leading-snug">
          {info.g2}
        </h2>
      )}
      {info.g3 && (
        <p className="text-sm font-medium text-muted-foreground mt-0.5">
          {info.g3}
        </p>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? !window.matchMedia("(min-width: 768px)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = () => setIsMobile(!mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export default function LawPage() {
  const { lawId, dokumentnummer: pathDokumentnummer } = useParams<{
    lawId: string;
    dokumentnummer?: string;
  }>();
  const [location] = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // The dokumentnummer to scroll to can come from three places, in order of
  // preference:
  //   1. The path parameter `/law/:lawId/doc/:dokumentnummer` (used by
  //      bookmarks and search hits — most reliable).
  //   2. A `?doc=NORxx` query string — either inside the hash (legacy) or
  //      moved by wouter's hash-router to the real `window.location.search`.
  //   3. A legacy `#NORxx` anchor at the very end of the hash.
  const initialDocNr = (() => {
    if (pathDokumentnummer) return pathDokumentnummer;
    if (typeof window === "undefined") return "";
    // location is the path under the hash, e.g. "/law/abgb?doc=NORxx"
    const qIdx = location.indexOf("?");
    if (qIdx !== -1) {
      const fromHashQuery = new URLSearchParams(location.slice(qIdx + 1)).get("doc");
      if (fromHashQuery) return fromHashQuery;
    }
    // wouter@3.3.5's `useHashLocation.navigate` extracts any `?…` portion
    // from the target URL and writes it to the real `window.location.search`
    // (rather than keeping it inside the hash). Check there too.
    const fromRealQuery = new URLSearchParams(window.location.search).get("doc");
    if (fromRealQuery) return fromRealQuery;
    // Fallback: legacy `#NORxx` (only works without hash routing, but kept
    // for backwards compatibility with anything that bookmarked it).
    const raw = window.location.hash.replace(/^#/, "");
    const lastHash = raw.lastIndexOf("#");
    return lastHash !== -1 ? raw.slice(lastHash + 1) : "";
  })();

  // Desktop: sidebar always visible. Mobile: closed by default, opens as overlay.
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const sidebarOpen = isMobile ? mobileSidebarOpen : desktopSidebarOpen;

  const [lawSearch, setLawSearch] = useState("");
  const [activeDocNr, setActiveDocNr] = useState<string>(initialDocNr);
  const [activeNoteDoc, setActiveNoteDoc] = useState<string | null>(null);

  const suppressObserverRef = useRef(false);
  // Guard for the "auto-jump to §1" logic (only fires once when coming from
  // the main menu without a specific paragraph target).
  const didAutoJumpRef = useRef(false);

  // ── Instant jump-to-anchor with retry ──────────────────────────────────
  //
  // Paragraphs are lazy-loaded, so the document's total height — and
  // therefore the absolute Y-position of any given paragraph — keeps
  // changing for a few hundred ms after a jump is triggered. We always
  // jump instantly (behavior: "auto"): for far-away targets (hundreds of
  // paragraphs) smooth-scrolling is slow and breaks on mobile when lazy
  // loading shifts the layout mid-animation.
  //
  // Strategy: compute the target Y via getBoundingClientRect() + pageYOffset,
  // jump there instantly, then on each animation frame for up to ~1.8s
  // re-measure. If the target has drifted (neighbours above lazy-loaded
  // and expanded), snap-correct to the new position. Stop as soon as the
  // target stays put for 3 consecutive frames or the deadline passes.
  //
  // The `smooth` option is kept in the signature for compatibility but
  // intentionally ignored — everything is instant now.
  const STICKY_OFFSET = 112; // AppHeader (56) + paragraph toolbar (~49) + small gap
  const scrollToAnchor = useCallback((nr: string, _opts: { smooth?: boolean } = {}) => {
    suppressObserverRef.current = true;

    const findEl = () =>
      (document.querySelector(`[data-jump-anchor="${CSS.escape(nr)}"]`) as HTMLElement | null) ??
      document.getElementById(nr);

    const targetY = () => {
      const el = findEl();
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return Math.max(0, rect.top + window.pageYOffset - STICKY_OFFSET);
    };

    const initial = targetY();
    if (initial == null) {
      // Element not rendered yet — retry shortly. Limit retries so we never
      // loop forever if the id never appears.
      let tries = 0;
      const wait = () => {
        if (findEl()) scrollToAnchor(nr, _opts);
        else if (++tries < 40) setTimeout(wait, 50);
        else suppressObserverRef.current = false;
      };
      setTimeout(wait, 50);
      return;
    }

    // Instant jump — no easing. Fast for far-away targets and avoids the
    // mobile drift problem where smooth-scrolling through hundreds of
    // lazy-loading paragraphs never lands on the right Y.
    window.scrollTo({ top: initial, behavior: "auto" });

    // Watchdog: keep re-checking position; if layout shifts (lazy-loaded
    // paragraphs above the target expand), snap to the new target Y.
    const deadline = performance.now() + 1800;
    let stableFrames = 0;
    let lastY = initial;

    const tick = () => {
      const y = targetY();
      if (y == null) { suppressObserverRef.current = false; return; }
      const currentScroll = window.pageYOffset;
      const drift = Math.abs(y - currentScroll);

      if (drift > 2) {
        window.scrollTo({ top: y, behavior: "auto" });
        stableFrames = 0;
      } else if (Math.abs(y - lastY) < 1) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }
      lastY = y;

      if (stableFrames >= 3 || performance.now() > deadline) {
        suppressObserverRef.current = false;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  // Toggle handler — no scroll jump on mobile because sidebar is overlay.
  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileSidebarOpen((s) => !s);
      return;
    }
    // Desktop: preserve reading position
    const currentActive = activeDocNr;
    setDesktopSidebarOpen((s) => !s);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (currentActive) scrollToAnchor(currentActive);
      });
    });
  }, [activeDocNr, isMobile, scrollToAnchor]);

  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);

  const [loadedDocs, setLoadedDocs] = useState<Set<string>>(() => new Set());

  const contentRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreObserverRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const sidebarItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const didInitialScroll = useRef(false);
  const documentsRef = useRef<DocMeta[]>([]);

  const { data: indexData, isLoading: indexLoading } = useQuery({
    queryKey: ["/api/laws", lawId, "index"],
    queryFn: () => apiRequest("GET", `/api/laws/${lawId}/index`).then((r) => r.json()),
  });

  const { data: lawMeta } = useQuery({
    queryKey: ["/api/laws", lawId],
    queryFn: () => apiRequest("GET", `/api/laws/${lawId}`).then((r) => r.json()),
  });

  // Law-Registry: alle geladenen Gesetze mit Abkürzung — für §-Verlinkung
  const { data: lawRegistry = [] } = useQuery<LawRegistryEntry[]>({
    queryKey: ["/api/law-registry"],
    queryFn: () => apiRequest("GET", "/api/law-registry").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // Bookmarks across the whole library — we filter to this law on the fly.
  // Auto-refresh whenever individual paragraph blocks toggle their bookmark
  // (they invalidate the per-document query, so this one stays fresh).
  const { data: allBookmarks } = useQuery<
    {
      dokumentnummer: string;
      gesetzesnummer: string;
      abkuerzung: string;
      artikelParagraphAnlage: string;
      createdAt: number;
    }[]
  >({
    queryKey: ["/api/bookmarks"],
    queryFn: () => apiRequest("GET", "/api/bookmarks").then((r) => r.json()),
  });

  const lawBookmarks = (allBookmarks ?? []).filter(
    (b) => b.gesetzesnummer === lawMeta?.gesetzesnummer,
  );
  const bookmarkedDocSet = new Set(lawBookmarks.map((b) => b.dokumentnummer));
  const [lawBookmarksOpen, setLawBookmarksOpen] = useState(false);

  const documents: DocMeta[] = indexData?.documents ?? [];
  documentsRef.current = documents;
  const filteredDocs = documents.filter((d) => {
    if (!lawSearch) return true;
    const q = lawSearch.toLowerCase();
    return (
      d.artikelParagraphAnlage?.toLowerCase().includes(q) ||
      d.kurztitel?.toLowerCase().includes(q) ||
      d.paragraphTitle?.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    if (documents.length === 0) return;
    setLoadedDocs((prev) => {
      const next = new Set(prev);
      if (initialDocNr) {
        next.add(initialDocNr);
        const idx = documents.findIndex((d) => d.dokumentnummer === initialDocNr);
        const start = Math.max(0, idx - 2);
        const end = Math.min(documents.length - 1, idx + 5);
        for (let i = start; i <= end; i++) next.add(documents[i].dokumentnummer);
      }
      documents.slice(0, 8).forEach((d) => next.add(d.dokumentnummer));
      return next;
    });
  }, [documents.length]);

  const docQueries = useQueries({
    queries: Array.from(loadedDocs).map((nr) => ({
      queryKey: ["/api/document", nr],
      queryFn: () => apiRequest("GET", `/api/document/${nr}`).then((r) => r.json()),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const docContentMap = new Map<string, DocContent>();
  Array.from(loadedDocs).forEach((nr, i) => {
    const q = docQueries[i];
    if (q?.data) docContentMap.set(nr, q.data as DocContent);
  });

  // IntersectionObserver: update active sidebar item
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (suppressObserverRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          const nr = visible[0].target.id;
          setActiveDocNr(nr);
          const btn = sidebarItemRefs.current.get(nr);
          if (btn) btn.scrollIntoView({ block: "nearest" });
        }
      },
      // Top margin matches the combined sticky-header height (AppHeader + paragraph toolbar ≈ 112px)
      // so the "active" paragraph in the sidebar tracks what the user actually sees below the headers.
      { rootMargin: "-120px 0px -60% 0px", threshold: 0 }
    );

    const articles = contentRef.current?.querySelectorAll("article[id]");
    articles?.forEach((el) => observerRef.current?.observe(el));

    return () => observerRef.current?.disconnect();
  }, [docContentMap.size, documents.length]);

  // ── Auto-jump to §1 when navigating from the main menu ──────────────────────
  //
  // When the user clicks on a law in the library (plain /law/:lawId, no
  // specific paragraph in the URL), initialDocNr is empty.  In that case we
  // skip §0 (which is a changelog overview, not a real paragraph) and jump
  // directly to the first paragraph with a real number (≥ 1).
  //
  // This effect is separate from the initialDocNr effect so that direct
  // links (bookmarks, search results, §-references) are never affected.
  useEffect(() => {
    if (didAutoJumpRef.current) return;
    // Only fire when no specific doc was requested
    if (initialDocNr) return;
    if (documents.length === 0) return;

    // Find the first paragraph with a numeric value >= 1 (skip § 0)
    const firstReal = documents.find((d) => {
      const num = parseInt(
        (d.artikelParagraphAnlage ?? "").replace(/[^0-9]/g, ""),
        10,
      );
      return !isNaN(num) && num >= 1;
    });
    if (!firstReal) return;

    didAutoJumpRef.current = true;
    jumpToDoc(firstReal.dokumentnummer);
  }, [documents.length, initialDocNr]);

    // Reset the "did initial scroll" flag whenever the deep-link target
  // changes. Without this, navigating from one bookmark/search result to
  // another while the LawPage is already mounted would silently keep the
  // old scroll position because the flag was already true.
  useEffect(() => {
    didInitialScroll.current = false;
  }, [lawId, initialDocNr]);

  // Initial scroll to the deep-link target.
  //
  // Triggers as soon as either the document content for the target is in
  // the cache, OR — if the target is unknown to the server — the index has
  // finished loading and the anchor element is rendered. We re-run on every
  // render that changes loadedDocs/docContentMap so we don't get stuck if
  // the very first attempt fired before the anchor was mounted.
  useEffect(() => {
    if (didInitialScroll.current || !initialDocNr) return;
    // Wait for the index to be loaded so we know whether the target exists
    // in this law at all. If it doesn't, scroll to top so the user lands
    // somewhere predictable instead of an arbitrary mid-document position.
    if (documents.length === 0) return;
    const knownInIndex = documents.some((d) => d.dokumentnummer === initialDocNr);
    if (!knownInIndex) {
      // Target paragraph isn't part of this law — nothing to scroll to.
      didInitialScroll.current = true;
      return;
    }
    // Make sure the target is queued for loading (the loadedDocs effect
    // above schedules this, but on rapid navigations the effect may not
    // have run yet for the new initialDocNr).
    if (!loadedDocs.has(initialDocNr)) {
      setLoadedDocs((prev) => {
        if (prev.has(initialDocNr)) return prev;
        const next = new Set(prev);
        next.add(initialDocNr);
        const idx = documents.findIndex((d) => d.dokumentnummer === initialDocNr);
        if (idx !== -1) {
          const start = Math.max(0, idx - 2);
          const end = Math.min(documents.length - 1, idx + 5);
          for (let i = start; i <= end; i++) next.add(documents[i].dokumentnummer);
        }
        return next;
      });
      return;
    }
    // Wait until the actual content (not just the placeholder) is mounted
    // so getBoundingClientRect() returns a stable, real Y for the anchor.
    if (!docContentMap.has(initialDocNr)) return;
    // Sync the active highlight in the sidebar/sticky header to the target
    // immediately so it doesn't flicker through neighbouring paragraphs
    // while the scroll watchdog runs.
    setActiveDocNr(initialDocNr);
    suppressObserverRef.current = true;
    // Use the same stable anchor mechanism as sidebar clicks so deep-links
    // land precisely on the paragraph header, even while neighbours lazy-load.
    scrollToAnchor(initialDocNr);
    didInitialScroll.current = true;
  }, [docContentMap.size, loadedDocs.size, documents.length, initialDocNr, scrollToAnchor]);

  const loadAroundDoc = useCallback((nr: string, radius = 8) => {
    setLoadedDocs((prev) => {
      const docs = documentsRef.current;
      if (docs.length === 0) return prev;
      const idx = docs.findIndex((d) => d.dokumentnummer === nr);
      if (idx === -1) return prev;
      const next = new Set(prev);
      const start = Math.max(0, idx - 1);
      const end = Math.min(docs.length - 1, idx + radius);
      let changed = false;
      for (let i = start; i <= end; i++) {
        const k = docs[i].dokumentnummer;
        if (!next.has(k)) { next.add(k); changed = true; }
      }
      return changed ? next : prev;
    });
  }, []);

  const placeholderRefs = useRef<Map<string, HTMLElement>>(new Map());

  const registerPlaceholder = useCallback((nr: string, el: HTMLElement | null) => {
    const map = placeholderRefs.current;
    if (el) {
      map.set(nr, el);
      loadMoreObserverRef.current?.observe(el);
    } else {
      const existing = map.get(nr);
      if (existing) {
        loadMoreObserverRef.current?.unobserve(existing);
        map.delete(nr);
      }
    }
  }, []);

  useEffect(() => {
    if (loadMoreObserverRef.current) loadMoreObserverRef.current.disconnect();
    loadMoreObserverRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const nr = (entry.target as HTMLElement).dataset.nr;
            if (nr) loadAroundDoc(nr, 8);
          }
        }
      },
      { rootMargin: "600px 0px 600px 0px" }
    );
    placeholderRefs.current.forEach((el) => loadMoreObserverRef.current?.observe(el));
    return () => loadMoreObserverRef.current?.disconnect();
  }, [loadAroundDoc]);

  const loadNextBatch = useCallback(() => {
    setLoadedDocs((prev) => {
      const docs = documentsRef.current;
      if (docs.length === 0) return prev;
      const next = new Set(prev);
      let added = 0;
      for (const doc of docs) {
        if (!next.has(doc.dokumentnummer)) {
          next.add(doc.dokumentnummer);
          if (++added >= 15) break;
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadNextBatch(); },
      { rootMargin: "600px" }
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [loadNextBatch, loadedDocs.size]);

  function jumpToDoc(nr: string) {
    // Pre-load a wider window around the target so the neighbours that
    // influence the target's Y-position are already in the DOM by the time
    // scrollToAnchor() measures. The retry-loop inside scrollToAnchor() then
    // only needs to catch smaller layout shifts.
    setLoadedDocs((prev) => {
      const next = new Set(prev);
      next.add(nr);
      const idx = documents.findIndex((d) => d.dokumentnummer === nr);
      if (idx !== -1) {
        const start = Math.max(0, idx - 4);
        const end = Math.min(documents.length - 1, idx + 12);
        for (let i = start; i <= end; i++) next.add(documents[i].dokumentnummer);
      }
      return next;
    });

    // Set active state immediately so the sticky header reflects the target
    // during the jump instead of lagging to whatever the observer sees last.
    setActiveDocNr(nr);
    // Block the IntersectionObserver from overriding activeDocNr while the
    // jump and the subsequent retry-loop are running. scrollToAnchor() will
    // clear this flag once the target is stable (or after ~1.8s).
    suppressObserverRef.current = true;

    if (isMobile) setMobileSidebarOpen(false);

    // Give React one frame to flush the new loadedDocs state (which unmounts
    // the small placeholder and mounts the real ParagraphBlock), then jump.
    // The delay is deliberately small — we use an instant jump + retry-loop
    // instead of smooth-scrolling, so there's no animation to wait for.
    requestAnimationFrame(() => {
      setTimeout(() => {
        scrollToAnchor(nr);
      }, isMobile ? 60 : 30);
    });
  }

  const collection = lawMeta?.collection;

  const breadcrumbs = [
    { label: "Bibliothek", href: "/" },
    ...(collection ? [{ label: collection.title, href: `/collection/${collection.id}` }] : []),
    { label: lawMeta?.abkuerzung ?? lawId },
  ];

  // Lock body scroll while mobile sidebar is open to avoid iOS address-bar
  // / overflow weirdness.
  useEffect(() => {
    if (!isMobile) return;
    if (mobileSidebarOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [isMobile, mobileSidebarOpen]);

  // Sidebar content — shared between desktop aside and mobile drawer.
  const sidebarContent = (
    <>
      {/* Law title */}
      <div className="px-3 py-3 border-b border-sidebar-border flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-mono font-bold text-sidebar-primary">
              {lawMeta?.abkuerzung ?? "…"}
            </span>
          </div>
          <p className="text-xs text-sidebar-foreground/70 leading-tight line-clamp-2">
            {lawMeta?.title ?? "Wird geladen…"}
          </p>
        </div>
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-sidebar-foreground"
            onClick={closeMobileSidebar}
            aria-label="Seitenleiste schließen"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Search within law */}
      <div className="px-2 py-2 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sidebar-foreground/50 pointer-events-none" />
          <input
            value={lawSearch}
            onChange={(e) => setLawSearch(e.target.value)}
            placeholder="Paragraph filtern…"
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded bg-sidebar-accent text-sidebar-foreground placeholder:text-sidebar-foreground/40 border-0 outline-none focus:ring-1 focus:ring-sidebar-ring"
            data-testid="input-law-search"
          />
        </div>
      </div>

      {/* Paragraph list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {indexLoading ? (
          <div className="p-3 space-y-2">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-7 w-full opacity-20" />
            ))}
          </div>
        ) : (
          <div className="py-1">
            {filteredDocs.length === 0 && (
              <p className="px-3 py-4 text-xs text-sidebar-foreground/50 text-center">
                Keine Treffer
              </p>
            )}
            {(() => {
              // Track the last rendered section key so we can emit dividers
              // whenever the Teil/Abschnitt changes.
              let lastSectionKey = "";
              return filteredDocs.map((doc) => {
              const isActive = activeDocNr === doc.dokumentnummer;
              const isBookmarked = bookmarkedDocSet.has(doc.dokumentnummer);
              // Title source (in order):
              //   1. paragraphTitle — parsed from the cached HTML body by the
              //      server. Always paragraph-specific when available.
              //   2. kurztitel — only if it's genuinely paragraph-specific,
              //      i.e. not just the law-wide Kurztitel repeated.
              // If neither yields a real title, we show nothing — better than
              // a misleading "Strafprozeßordnung 1975" under every §.
              const paraTitle = (doc as any).paragraphTitle as string | null | undefined;
              let displayTitle: string | null = paraTitle ?? null;
              if (!displayTitle && doc.kurztitel && doc.kurztitel.trim() !== "") {
                const normalize = (s: string) => s
                  .toLowerCase()
                  .replace(/ß/g, "ss")
                  .replace(/[^\p{Letter}\p{Number}]+/gu, "");
                const normLawTitle = normalize(lawMeta?.title ?? "");
                if (normLawTitle && normalize(doc.kurztitel) !== normLawTitle) {
                  displayTitle = doc.kurztitel;
                }
              }

              // Section divider in sidebar
              const sec = doc.abschnitt as SectionInfo | null | undefined;
              const sectionKey = sec ? `${sec.g1 ?? ""}|${sec.g2 ?? ""}|${sec.g3 ?? ""}` : "";
              const showSectionDivider = !!sectionKey && sectionKey !== lastSectionKey;
              if (sectionKey) lastSectionKey = sectionKey;

              return (
                <div key={doc.dokumentnummer}>
                  {showSectionDivider && sec && (
                    <div className="px-3 pt-3 pb-1 border-t border-sidebar-border/50 mt-1">
                      {sec.g1 && (
                        <p className="text-[9px] font-bold uppercase tracking-widest text-sidebar-primary/60 leading-tight mb-0.5">
                          {sec.g1}
                        </p>
                      )}
                      {sec.g2 && (
                        <p className="text-[10px] font-semibold text-sidebar-foreground/80 leading-tight">
                          {sec.g2}
                        </p>
                      )}
                      {sec.g3 && (
                        <p className="text-[9px] text-sidebar-foreground/60 leading-tight mt-0.5 italic">
                          {sec.g3}
                        </p>
                      )}
                    </div>
                  )}
                <button
                  key={doc.dokumentnummer}
                  ref={(el) => {
                    if (el) sidebarItemRefs.current.set(doc.dokumentnummer, el);
                    else sidebarItemRefs.current.delete(doc.dokumentnummer);
                  }}
                  onClick={() => jumpToDoc(doc.dokumentnummer)}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors relative ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-primary font-semibold border-l-2 border-sidebar-primary"
                      : isBookmarked
                        ? "bg-amber-100/70 dark:bg-amber-900/25 text-sidebar-foreground hover:bg-amber-200/70 dark:hover:bg-amber-900/40"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                  }`}
                  data-testid={`button-doc-${doc.dokumentnummer}`}
                >
                  {/* Yellow right-edge marker for bookmarked paragraphs */}
                  {isBookmarked && (
                    <span
                      aria-hidden
                      className="absolute right-0 top-0 bottom-0 w-1 bg-amber-400 dark:bg-amber-500"
                    />
                  )}
                  <span className={`font-mono ${isActive ? "font-bold" : "font-semibold"}`}>
                    {doc.artikelParagraphAnlage ?? doc.dokumentnummer}
                  </span>
                  {displayTitle && (
                    <span className="block text-[10px] leading-tight mt-0.5 opacity-60 font-normal line-clamp-2">
                      {displayTitle}
                    </span>
                  )}
                </button>
                </div>
              );
              }); // end filteredDocs.map
            })()}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="px-3 py-2 border-t border-sidebar-border">
        <p className="text-xs text-sidebar-foreground/40">
          {documents.length} Einträge · {loadedDocs.size} geladen
        </p>
      </div>
    </>
  );

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <AppHeader breadcrumbs={breadcrumbs} showSearch />

      <div className="flex flex-1 relative">
        {/* ── Desktop Sidebar (inline) ── */}
        <aside
          className={`hidden md:flex ${desktopSidebarOpen ? "w-64" : "w-0"} shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex-col overflow-hidden transition-all duration-200 sticky top-14 self-start h-[calc(100vh-3.5rem)]`}
          data-testid="panel-sidebar-desktop"
        >
          {desktopSidebarOpen && sidebarContent}
        </aside>

        {/* ── Mobile Sidebar Overlay ── */}
        {isMobile && (
          <>
            {/* Backdrop */}
            <div
              className={`md:hidden fixed inset-0 bg-background/60 backdrop-blur-sm z-40 transition-opacity duration-200 ${
                mobileSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
              onClick={closeMobileSidebar}
              aria-hidden
            />
            {/* Drawer */}
            <aside
              className={`md:hidden fixed top-0 bottom-0 left-0 w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col z-50 shadow-2xl transition-transform duration-200 ${
                mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
              }`}
              style={{ backgroundColor: "hsl(var(--sidebar))" }}
              data-testid="panel-sidebar-mobile"
            >
              {sidebarContent}
            </aside>
          </>
        )}

        {/* ── Main content ── */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Sticky toolbar — always visible (this fixes the mobile "header disappears" bug) */}
          <div className="sticky top-14 z-30 flex items-center gap-2 px-3 md:px-4 py-2 border-b border-border bg-background/95 backdrop-blur-sm">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 shrink-0"
              onClick={toggleSidebar}
              aria-label="Seitenleiste"
              data-testid="button-toggle-sidebar"
            >
              <Menu className="w-4 h-4" />
            </Button>

            <span className="text-sm font-medium text-foreground truncate min-w-0">
              {lawMeta?.abkuerzung ?? lawId}
              {activeDocNr && documents.find((d) => d.dokumentnummer === activeDocNr) && (
                <span className="text-muted-foreground ml-2 font-normal">
                  · {documents.find((d) => d.dokumentnummer === activeDocNr)?.artikelParagraphAnlage}
                </span>
              )}
            </span>

            <div className="flex-1" />

            {indexLoading && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="hidden sm:inline">Lade…</span>
              </div>
            )}

            {/* Bookmarks for this law (popover) */}
            <Popover open={lawBookmarksOpen} onOpenChange={setLawBookmarksOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-8 px-2 gap-1.5 shrink-0 ${
                    lawBookmarks.length > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : ""
                  }`}
                  aria-label="Lesezeichen in diesem Gesetz"
                  data-testid="button-law-bookmarks"
                >
                  <Bookmark className="w-4 h-4" />
                  {lawBookmarks.length > 0 && (
                    <span className="text-xs font-medium">{lawBookmarks.length}</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-0">
                <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                  <Bookmark className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-sm font-medium">
                    Lesezeichen in {lawMeta?.abkuerzung ?? ""}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {lawBookmarks.length}
                  </span>
                </div>
                <div className="max-h-[60vh] overflow-y-auto py-1">
                  {lawBookmarks.length === 0 && (
                    <p className="px-3 py-6 text-xs text-muted-foreground text-center">
                      Noch keine Lesezeichen in diesem Gesetz.
                    </p>
                  )}
                  {[...lawBookmarks]
                    .sort((a, b) => {
                      const an = parseInt(
                        (a.artikelParagraphAnlage ?? "").replace(/[^0-9]/g, ""),
                        10,
                      );
                      const bn = parseInt(
                        (b.artikelParagraphAnlage ?? "").replace(/[^0-9]/g, ""),
                        10,
                      );
                      return (
                        (isNaN(an) ? 9999 : an) - (isNaN(bn) ? 9999 : bn)
                      );
                    })
                    .map((bm) => (
                      <button
                        key={bm.dokumentnummer}
                        onClick={() => {
                          setLawBookmarksOpen(false);
                          jumpToDoc(bm.dokumentnummer);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-accent/30 transition-colors flex items-center gap-2"
                        data-testid={`law-bookmark-${bm.dokumentnummer}`}
                      >
                        <span className="font-mono font-semibold text-foreground">
                          {bm.artikelParagraphAnlage}
                        </span>
                      </button>
                    ))}
                </div>
                <div className="px-3 py-2 border-t border-border">
                  <Link
                    href="/bookmarks"
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    onClick={() => setLawBookmarksOpen(false)}
                  >
                    Alle Lesezeichen →
                  </Link>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Scrollable content — all paragraphs */}
          {!indexLoading && documents.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground py-16">
              <div className="text-center">
                <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Keine Paragraphen gefunden.</p>
              </div>
            </div>
          ) : (
            <div
              ref={contentRef}
              className="flex-1 px-4 md:px-6 py-6"
              data-testid="content-scroll-area"
            >
              <div className="max-w-2xl mx-auto">
                {(() => {
                let lastMainSectionKey = "";
                return documents.map((doc) => {
                  const docContent = docContentMap.get(doc.dokumentnummer);
                  const isQueued = loadedDocs.has(doc.dokumentnummer);

                  // Section header logic
                  const docSec = doc.abschnitt as SectionInfo | null | undefined;
                  const mainSectionKey = docSec
                    ? `${docSec.g1 ?? ""}|${docSec.g2 ?? ""}|${docSec.g3 ?? ""}`
                    : "";
                  const showMainSection =
                    !!mainSectionKey && mainSectionKey !== lastMainSectionKey;
                  if (mainSectionKey) lastMainSectionKey = mainSectionKey;

                  // ── Not yet queued: placeholder skeleton ──
                  if (!isQueued) {
                    return (
                      <div key={doc.dokumentnummer}>
                        {showMainSection && docSec && <SectionHeader info={docSec} />}
                        <div
                          id={doc.dokumentnummer}
                          data-nr={doc.dokumentnummer}
                          ref={(el) => registerPlaceholder(doc.dokumentnummer, el)}
                          className="scroll-mt-28 mb-12 pb-10 border-b border-border/30 last:border-0 min-h-[140px]"
                        >
                          <span
                            data-jump-anchor={doc.dokumentnummer}
                            aria-hidden="true"
                            className="block"
                          />
                          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
                            <span className="font-mono font-bold text-primary text-sm opacity-40">
                              {doc.artikelParagraphAnlage}
                            </span>
                            {(() => {
                              const paraTitle = (doc as any).paragraphTitle as
                                | string
                                | null
                                | undefined;
                              if (paraTitle)
                                return (
                                  <span className="text-xs text-muted-foreground/70 truncate">
                                    {paraTitle}
                                  </span>
                                );
                              if (
                                doc.kurztitel &&
                                doc.kurztitel !== (lawMeta?.title ?? "")
                              )
                                return (
                                  <span className="text-xs text-muted-foreground/70 truncate">
                                    {doc.kurztitel}
                                  </span>
                                );
                              return null;
                            })()}
                          </div>
                          <div className="space-y-2">
                            <div className="h-3 bg-muted/40 rounded w-full" />
                            <div className="h-3 bg-muted/40 rounded w-4/5" />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── Queued but not yet loaded: loading spinner ──
                  if (!docContent) {
                    return (
                      <div key={doc.dokumentnummer}>
                        {showMainSection && docSec && <SectionHeader info={docSec} />}
                        <div
                          id={doc.dokumentnummer}
                          className="scroll-mt-28 mb-12 pb-10 border-b border-border/30 last:border-0"
                        >
                          <span
                            data-jump-anchor={doc.dokumentnummer}
                            aria-hidden="true"
                            className="block"
                          />
                          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
                            <span className="font-mono font-bold text-primary text-sm">
                              {doc.artikelParagraphAnlage}
                            </span>
                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />
                          </div>
                          <div className="space-y-2 animate-pulse">
                            <div className="h-4 bg-muted rounded w-full" />
                            <div className="h-4 bg-muted rounded w-5/6" />
                            <div className="h-4 bg-muted rounded w-full" />
                            <div className="h-4 bg-muted rounded w-4/5" />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── Fully loaded: render paragraph ──
                  return (
                    <div key={doc.dokumentnummer}>
                      {showMainSection && docSec && <SectionHeader info={docSec} />}
                      <ParagraphBlock
                        doc={{
                          ...docContent,
                          paragraphTitle:
                            doc.paragraphTitle ?? docContent.paragraphTitle,
                        }}
                        lawMeta={lawMeta}
                        activeNoteDoc={activeNoteDoc}
                        setActiveNoteDoc={setActiveNoteDoc}
                        allDocs={documents}
                        lawRegistry={lawRegistry}
                        scrollToAnchor={scrollToAnchor}
                      />
                    </div>
                  );
                }); // end documents.map
              })()}

                {loadedDocs.size < documents.length && (
                  <div
                    ref={sentinelRef}
                    className="h-16 flex items-center justify-center text-xs text-muted-foreground/50"
                    aria-hidden
                  >
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Lade weitere Paragraphen…
                  </div>
                )}

                {documents.length > 0 && !indexLoading && (
                  <div className="mt-8 pt-4 border-t border-border text-xs text-muted-foreground text-center">
                    Datenquelle:{" "}
                    <a
                      href="https://data.bka.gv.at/ris/api/v2.6/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      RIS OGD API v2.6
                    </a>{" "}
                    — Rechtsinformationssystem des Bundes (BKA)
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
