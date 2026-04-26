import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ArrowRight } from "lucide-react";

export default function CollectionPage() {
  const { collectionId } = useParams<{ collectionId: string }>();

  const { data: collections, isLoading } = useQuery({
    queryKey: ["/api/collections"],
    queryFn: () => apiRequest("GET", "/api/collections").then((r) => r.json()),
  });

  const collection = collections?.find((c: any) => c.id === collectionId);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        breadcrumbs={[
          { label: "Bibliothek", href: "/" },
          { label: collection?.title ?? collectionId },
        ]}
        showSearch
      />

      <main className="max-w-4xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-64" />
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : !collection ? (
          <div className="text-center py-16 text-muted-foreground">
            Collection nicht gefunden.{" "}
            <Link href="/" className="underline hover:text-foreground">Zurück zur Bibliothek</Link>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'Verdana, Geneva, sans-serif' }}>
                {collection.title}
              </h1>
              <p className="text-muted-foreground">{collection.description}</p>
            </div>

            <div className="space-y-3">
              {collection.laws.map((law: any) => (
                <Link key={law.id} href={`/law/${law.id}`} data-testid={`card-law-${law.id}`}>
                  <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card hover:shadow-sm hover:border-primary/40 transition-all group cursor-pointer">
                    <div className="p-2 rounded bg-primary/10">
                      <BookOpen className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono font-bold text-primary text-sm">{law.abkuerzung}</span>
                        <h3 className="font-semibold text-sm text-foreground truncate">{law.title}</h3>
                      </div>
                      {law.shortDescription && (
                        <p className="text-xs text-muted-foreground line-clamp-1">{law.shortDescription}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {law.cached && (
                        <Badge variant="secondary" className="text-xs">
                          {law.docCount} §§ gecacht
                        </Badge>
                      )}
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
