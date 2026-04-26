import { Link } from "wouter";
import { BookOpen } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
        <h1 className="text-xl font-semibold mb-2">Seite nicht gefunden</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Diese Seite existiert nicht.
        </p>
        <Link href="/" className="text-primary underline hover:opacity-80 text-sm">
          Zurück zur Bibliothek
        </Link>
      </div>
    </div>
  );
}
