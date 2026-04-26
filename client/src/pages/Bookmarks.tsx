import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Bookmark as BookmarkIcon, ArrowRight, BookOpen } from "lucide-react";

interface Bookmark {
  dokumentnummer: string;
  gesetzesnummer: string;
  abkuerzung: string;
  artikelParagraphAnlage: string;
  createdAt: number;
}

interface Law {
  id: string;
  gesetzesnummer: string;
  abkuerzung: string;
  title: string;
}

interface Collection {
  id: string;
  title: string;
  laws: Law[];
}

// Sort paragraph labels naturally — "§ 2" before "§ 10", "§ 1a" between "§ 1" and "§ 2".
function paraSortKey(label: string): [number, string] {
  const m = (label ?? "").match(/(\d+)\s*([a-zA-Z]?)/);
  if (!m) return [Number.POSITIVE_INFINITY, label ?? ""];
  return [parseInt(m[1], 10), (m[2] || "").toLowerCase()];
}

function compareLabels(a: string, b: string): number {
  const [an, as] = paraSortKey(a);
  const [bn, bs] = paraSortKey(b);
  if (an !== bn) return an - bn;
  return as.localeCompare(bs);
}

export default function BookmarksPage() {
  const { data: bookmarks, isLoading: bmLoading } = useQuery<Bookmark[]>({
    queryKey: ["/api/bookmarks"],
    queryFn: () => apiRequest("GET", "/api/bookmarks").then((r) => r.json()),
  });

  const { data: collections, isLoading: colLoading } = useQuery<Collection[]>({
    queryKey: ["/api/collections"],
    queryFn: () => apiRequest("GET", "/api/collections").then((r) => r.json()),
  });

  // Build a gesetzesnummer → law lookup for href + nice title.
  const lawByGesetzesnummer = new Map<string, Law & { collectionTitle: string }>();
  for (const col of collections ?? []) {
    for (const law of col.laws) {
      lawByGesetzesnummer.set(law.gesetzesnummer, { ...law, collectionTitle: col.title });
    }
  }

  // Group bookmarks by gesetzesnummer
  const grouped = new Map<string, Bookmark[]>();
  for (const bm of bookmarks ?? []) {
    const arr = grouped.get(bm.gesetzesnummer) ?? [];
    arr.push(bm);
    grouped.set(bm.gesetzesnummer, arr);
  }
  // Sort paragraphs inside each law
  for (const arr of grouped.values()) {
    arr.sort((a, b) => compareLabels(a.artikelParagraphAnlage, b.artikelParagraphAnlage));
  }

  // Sort groups by law abbreviation
  const groupEntries = Array.from(grouped.entries()).sort((a, b) => {
    const aAbk = a[1][0]?.abkuerzung ?? "";
    const bAbk = b[1][0]?.abkuerzung ?? "";
    return aAbk.localeCompare(bAbk, "de");
  });

  const isLoading = bmLoading || colLoading;
  const total = bookmarks?.length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        breadcrumbs={[
          { label: "Bibliothek", href: "/" },
          { label: "Lesezeichen" },
        ]}
        showSearch
        showBookmarks={false}
      />

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <BookmarkIcon className="w-5 h-5 text-amber-500" />
          <h1 className="text-xl font-semibold" style={{ fontFamily: 'Verdana, Geneva, sans-serif' }}>
            Meine Lesezeichen
          </h1>
          {!isLoading && (
            <span className="text-sm text-muted-foreground ml-auto">
              {total} Eintrag{total === 1 ? "" : "e"}
            </span>
          )}
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && total === 0 && (
          <div className="text-center py-16">
            <BookmarkIcon className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground mb-1">
              Noch keine Lesezeichen gesetzt.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Markieren Sie einen Paragraphen, um ihn hier zu sehen.
            </p>
          </div>
        )}

        {!isLoading && groupEntries.length > 0 && (
          <div className="space-y-6">
            {groupEntries.map(([gesetzesnummer, items]) => {
              const law = lawByGesetzesnummer.get(gesetzesnummer);
              const abkuerzung = items[0]?.abkuerzung ?? law?.abkuerzung ?? "?";
              const title = law?.title ?? "";
              return (
                <section
                  key={gesetzesnummer}
                  className="rounded-lg border border-border bg-card overflow-hidden"
                >
                  <header className="flex items-baseline gap-2 px-4 py-3 border-b border-border bg-muted/30">
                    <span className="font-mono font-bold text-primary">{abkuerzung}</span>
                    {title && (
                      <span className="text-sm text-muted-foreground truncate">{title}</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground/70">
                      {items.length}
                    </span>
                  </header>
                  <ul className="divide-y divide-border">
                    {items.map((bm) => {
                      // If we know the law, link to the in-app page; otherwise
                      // open RIS as fallback.
                      // Use the path-parameter route (/law/:lawId/doc/:dokumentnummer)
                      // rather than `?doc=…`. With wouter's hash-router the
                      // query portion of a hash URL gets moved to the real
                      // URL search-string, which made the Law page miss the
                      // dokumentnummer and never scroll to the paragraph.
                      const internalHref = law
                        ? `/law/${law.id}/doc/${bm.dokumentnummer}`
                        : null;
                      const externalHref = `https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=${bm.dokumentnummer}`;
                      const row = (
                        <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent/5 cursor-pointer transition-colors">
                          <span className="font-mono font-semibold text-sm text-foreground min-w-[4rem]">
                            {bm.artikelParagraphAnlage}
                          </span>
                          <span className="flex-1 text-xs text-muted-foreground truncate">
                            {law?.title ?? bm.abkuerzung}
                          </span>
                          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      );
                      return (
                        <li key={bm.dokumentnummer}>
                          {internalHref ? (
                            <Link href={internalHref}>{row}</Link>
                          ) : (
                            <a href={externalHref} target="_blank" rel="noopener noreferrer">
                              {row}
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {!isLoading && groupEntries.length === 0 && total > 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            <BookOpen className="w-4 h-4 inline-block mr-1" />
            Keine Gesetze gefunden — bitte zuerst zur Bibliothek zurück.
          </p>
        )}
      </main>
    </div>
  );
}
