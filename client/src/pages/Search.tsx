import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, AlertCircle, ArrowRight, ChevronDown } from "lucide-react";
import { useState, useEffect } from "react";

function highlightText(text: string, query: string): string {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(
    new RegExp(`(${escaped})`, "gi"),
    '<mark class="search-highlight">$1</mark>'
  );
}

function readQueryParam(loc: string, key: string): string {
  const fromLoc = new URLSearchParams(loc.split("?")[1] ?? "").get(key);
  if (fromLoc) return fromLoc;
  if (typeof window !== "undefined") {
    const fromRealQuery = new URLSearchParams(window.location.search).get(key);
    if (fromRealQuery) return fromRealQuery;
    const raw = window.location.hash.replace(/^#/, "");
    return new URLSearchParams(raw.split("?")[1] ?? "").get(key) ?? "";
  }
  return "";
}

/** Renders a single search result card */
function ResultCard({ result, submittedQuery }: { result: any; submittedQuery: string }) {
  const internalHref = result.lawId
    ? `/law/${result.lawId}/doc/${result.dokumentnummer}`
    : null;
  const externalHref = `https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=${result.dokumentnummer}`;

  const card = (
    <div className="group p-4 rounded-lg border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-primary text-sm">
            {result.abkuerzung !== "?" ? result.abkuerzung : ""}
          </span>
          <span className="font-semibold text-sm text-foreground">
            {result.artikelParagraphAnlage}
          </span>
          {result.collection && (
            <Badge variant="secondary" className="text-xs">
              {result.collection}
            </Badge>
          )}
          {!result.lawId && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Externes Gesetz ↗
            </Badge>
          )}
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
      </div>
      {result.snippet && (
        <p
          className="text-xs text-muted-foreground leading-relaxed line-clamp-2"
          dangerouslySetInnerHTML={{
            __html: highlightText(result.snippet, submittedQuery),
          }}
        />
      )}
      {result.kurztitel && result.kurztitel !== result.snippet && (
        <p className="text-xs text-muted-foreground/60 mt-1 line-clamp-1">
          {result.kurztitel}
        </p>
      )}
    </div>
  );

  return internalHref ? (
    <Link
      key={result.dokumentnummer}
      href={internalHref}
      data-testid={`result-${result.dokumentnummer}`}
    >
      {card}
    </Link>
  ) : (
    <a
      key={result.dokumentnummer}
      href={externalHref}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`result-${result.dokumentnummer}`}
    >
      {card}
    </a>
  );
}

/** Collapsible group of results for one law */
function SearchGroup({
  law,
  results,
  submittedQuery,
}: {
  law: string;
  results: any[];
  submittedQuery: string;
}) {
  const [open, setOpen] = useState(false);
  const count = results.length;
  const label = count === 1 ? "1 Treffer" : `${count} Treffer`;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Group header — click to expand/collapse */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-primary text-sm min-w-[3rem]">
            {law}
          </span>
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Collapsed results */}
      {open && (
        <div className="border-t border-border divide-y divide-border/50">
          {results.map((result: any) => (
            <div key={result.dokumentnummer} className="p-2">
              <ResultCard result={result} submittedQuery={submittedQuery} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  const [location, navigate] = useLocation();
  const initialQuery = readQueryParam(location, "q");

  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/search", submittedQuery],
    queryFn: () =>
      submittedQuery
        ? apiRequest("GET", `/api/search?q=${encodeURIComponent(submittedQuery)}`).then(
            (r) => r.json()
          )
        : null,
    enabled: !!submittedQuery,
  });

  useEffect(() => {
    const q = readQueryParam(location, "q");
    if (q) {
      setQuery(q);
      setSubmittedQuery(q);
    }
  }, [location]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSubmittedQuery(q);
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  const rawResults = (data?.results ?? []) as any[];
  const totalHits = data?.totalHits ?? 0;

  // Re-rank: if the query matches a law abbreviation, put that law first
  const results = (() => {
    if (!submittedQuery) return rawResults;
    const q = submittedQuery.trim().toLowerCase();
    const lawMatch = (r: any) =>
      (r.abkuerzung ?? "").toLowerCase() === q ||
      (r.abkuerzung ?? "").toLowerCase().startsWith(q);
    const matched = rawResults.filter(lawMatch);
    const rest = rawResults.filter((r) => !lawMatch(r));
    if (matched.length === 0) return rawResults;
    matched.sort((a, b) => {
      const an = parseInt((a.artikelParagraphAnlage ?? "").replace(/[^0-9]/g, ""), 10);
      const bn = parseInt((b.artikelParagraphAnlage ?? "").replace(/[^0-9]/g, ""), 10);
      return (isNaN(an) ? 9999 : an) - (isNaN(bn) ? 9999 : bn);
    });
    return [...matched, ...rest];
  })();

  // Group results by law abbreviation, preserving chronological order of first appearance
  const groupedResults: [string, any[]][] = (() => {
    const map = new Map<string, any[]>();
    for (const r of results) {
      const key = r.abkuerzung && r.abkuerzung !== "?" ? r.abkuerzung : "Unbekannt";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries());
  })();

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        breadcrumbs={[
          { label: "Bibliothek", href: "/" },
          { label: "Suche" },
        ]}
        showSearch={false}
      />

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Search input */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suchbegriff eingeben…"
              className="pl-10"
              autoFocus
              data-testid="input-search"
            />
          </div>
          <Button type="submit" data-testid="button-search-submit">
            Suchen
          </Button>
        </form>

        {/* Results header */}
        {submittedQuery && !isLoading && (
          <p className="text-sm text-muted-foreground mb-4">
            {totalHits > 0 ? (
              <>
                <strong className="text-foreground">{totalHits}</strong> Treffer für{" "}
                <strong className="text-foreground">„{submittedQuery}"</strong>
              </>
            ) : (
              <>
                Keine Treffer für{" "}
                <strong className="text-foreground">„{submittedQuery}"</strong>
              </>
            )}
          </p>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded-lg border border-border">
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4 mt-1" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm p-4 rounded border border-destructive/30 bg-destructive/10">
            <AlertCircle className="w-4 h-4" />
            <span>Fehler bei der Suche. Bitte versuchen Sie es erneut.</span>
          </div>
        )}

        {/* Grouped results */}
        {!isLoading && groupedResults.length > 0 && (
          <div className="space-y-3">
            {groupedResults.map(([law, lawResults]) => (
              <SearchGroup
                key={law}
                law={law}
                results={lawResults}
                submittedQuery={submittedQuery}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && submittedQuery && results.length === 0 && !error && (
          <div className="text-center py-16">
            <Search className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground mb-1">Keine Treffer gefunden.</p>
            <p className="text-xs text-muted-foreground/70">
              Versuchen Sie einen anderen Suchbegriff oder laden Sie zuerst ein Gesetz.
            </p>
          </div>
        )}

        {/* Source note */}
        {!isLoading &&
          submittedQuery &&
          results.some((r: any) => !r.fromCache) && (
            <p className="mt-6 text-xs text-muted-foreground text-center">
              Suchergebnisse aus dem{" "}
              <a
                href="https://www.ris.bka.gv.at"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                RIS (Rechtsinformationssystem des Bundes)
              </a>
            </p>
          )}
      </main>
    </div>
  );
}
