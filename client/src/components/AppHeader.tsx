import { Link } from "wouter";
import { Sun, Moon, ChevronRight, Settings, Search, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface AppHeaderProps {
  breadcrumbs?: BreadcrumbItem[];
  /** Show the "Suche" button that links to the search page. */
  showSearch?: boolean;
  /** Show the "Meine Lesezeichen" button that links to the bookmarks page. */
  showBookmarks?: boolean;
}

export function AppHeader({
  breadcrumbs,
  showSearch = false,
  showBookmarks = true,
}: AppHeaderProps) {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Logo */}
        <Link href="/">
          <div className="flex items-center gap-2 shrink-0" data-testid="link-home">
            <OpenLawAustriaLogo />
            <span
              className="font-semibold text-primary hidden sm:block"
              style={{ fontFamily: 'Verdana, Geneva, sans-serif' }}
            >
              Open-Law-Austria
            </span>
          </div>
        </Link>

        {/* Breadcrumbs */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 text-sm text-muted-foreground overflow-hidden">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/60" />}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-foreground truncate transition-colors">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="truncate font-medium text-foreground">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}

        <div className="flex-1" />

        {/* Search button — opens the dedicated search page. Replaces the
            previous live-search input field, which behaved unreliably with
            hash-routing and never auto-searched as the user typed. */}
        {showSearch && (
          <Link href="/search">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs shrink-0"
              data-testid="button-open-search"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Suche</span>
            </Button>
          </Link>
        )}

        {/* My bookmarks button */}
        {showBookmarks && (
          <Link href="/bookmarks">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs shrink-0 text-amber-700 dark:text-amber-400 border-amber-300/60 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/60 dark:hover:bg-amber-900/30 hover:text-amber-800 dark:hover:text-amber-300"
              data-testid="link-my-bookmarks"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Meine Lesezeichen</span>
            </Button>
          </Link>
        )}

        {/* Admin / settings link */}
        <Link href="/admin">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Administration"
            data-testid="link-admin"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </Link>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setIsDark((d) => !d)}
          aria-label="Farbschema wechseln"
          data-testid="button-theme-toggle"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
      </div>
    </header>
  );
}

function OpenLawAustriaLogo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-label="Open-Law-Austria Logo">
      <rect width="32" height="32" rx="6" fill="hsl(220 50% 28%)" />
      <text x="4" y="20" fontSize="10" fontWeight="700" fill="hsl(40 70% 60%)" fontFamily="serif">OLA</text>
      <rect x="4" y="23" width="24" height="1.5" rx="0.75" fill="hsl(40 70% 60%)" opacity="0.6" />
      <rect x="4" y="26" width="16" height="1.5" rx="0.75" fill="hsl(40 70% 60%)" opacity="0.4" />
    </svg>
  );
}
