import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Gavel, BookOpen, Shield, ShieldCheck, Search } from "lucide-react";

const ICONS: Record<string, any> = { Gavel, BookOpen, Shield, ShieldCheck };
const COLOR_MAP: Record<string, string> = {
  red: "border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20",
  blue: "border-blue-300 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20",
  amber: "border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20",
  green: "border-green-300 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20",
};
const BADGE_MAP: Record<string, string> = {
  red: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  green: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

export default function LibraryPage() {
  const [, navigate] = useLocation();

  const { data: collections, isLoading } = useQuery({
    queryKey: ["/api/collections"],
    queryFn: () => apiRequest("GET", "/api/collections").then((r) => r.json()),
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      {/* Hero */}
      <div className="bg-primary text-primary-foreground px-6 py-16">
        <div className="max-w-3xl mx-auto text-center">
          <h1
            className="text-2xl sm:text-3xl font-bold mb-3 font-ui"
          >
            Österreichisches Rechtsinformationssystem
          </h1>
          <p className="text-primary-foreground/75 mb-8 text-sm sm:text-base">
            Strafrecht · Zivilrecht · Verfassungsrecht — direkt aus der RIS-OGD-Schnittstelle
          </p>
          {/* Single big button that opens the dedicated search page. The
              previous inline live-search field never auto-searched and
              caused confusion — a deliberate two-step flow is clearer. */}
          <Link href="/search">
            <button
              type="button"
              className="inline-flex items-center gap-3 px-8 py-4 rounded-lg bg-accent text-accent-foreground font-semibold text-base shadow-md hover:opacity-90 transition-opacity"
              data-testid="button-open-search"
            >
              <Search className="w-5 h-5" />
              Paragraphen und Gesetze suchen
            </button>
          </Link>
        </div>
      </div>

      {/* Collections grid */}
      <main className="max-w-6xl mx-auto px-4 py-10">
        {/* Section heading — the "Meine Lesezeichen" shortcut moved to the
            top app header so it's reachable from every page. */}
        <h2 className="text-lg font-semibold text-muted-foreground uppercase tracking-wide text-xs mb-6">
          Gesetzesbibliothek
        </h2>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-48 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(collections ?? []).map((col: any) => {
              const Icon = ICONS[col.icon] ?? BookOpen;
              return (
                <div
                  key={col.id}
                  className={`group rounded-lg border-2 p-5 flex flex-col gap-3 hover:shadow-md transition-shadow cursor-pointer ${COLOR_MAP[col.color] ?? "border-border bg-card"}`}
                  data-testid={`card-collection-${col.id}`}
                  onClick={() => navigate(`/collection/${col.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`p-2 rounded-md ${BADGE_MAP[col.color] ?? ""}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${BADGE_MAP[col.color] ?? "bg-muted text-muted-foreground"}`}>
                      {col.laws.length} {col.laws.length === 1 ? "Gesetz" : "Gesetze"}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground font-ui">
                      {col.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{col.description}</p>
                  </div>
                  <div className="mt-auto space-y-1">
                    {col.laws.slice(0, 3).map((law: any) => (
                      <Link
                        key={law.id}
                        href={`/law/${law.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group/item"
                        data-testid={`link-law-${law.id}`}
                      >
                        <span className="font-mono font-semibold text-primary text-xs">{law.abkuerzung}</span>
                        <span className="truncate">{law.title}</span>
                      </Link>
                    ))}
                    {col.laws.length > 3 && (
                      <div className="text-xs text-muted-foreground/60">
                        +{col.laws.length - 3} weitere…
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        <p className="mt-12 text-xs text-muted-foreground text-center">
          Datenquelle: <a href="https://data.bka.gv.at/ris/api/v2.6" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">RIS OGD API v2.6</a> — Rechtsinformationssystem des Bundes (BKA). Die Inhalte dienen der Information; rechtlich verbindlich ist ausschließlich das Bundesgesetzblatt.
        </p>
      </main>

      {/* Version badge */}
      <div className="fixed bottom-4 right-4 z-10 pointer-events-none">
        <span className="text-xs text-muted-foreground/50 select-none font-mono">
          v1.0.0
        </span>
      </div>
    </div>
  );
}
