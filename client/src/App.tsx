import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import LibraryPage from "@/pages/Library";
import CollectionPage from "@/pages/Collection";
import LawPage from "@/pages/Law";
import SearchPage from "@/pages/Search";
import AdminPage from "@/pages/Admin";
import BookmarksPage from "@/pages/Bookmarks";
import NotFound from "@/pages/not-found";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

function ThemeToggle() {
  const [isDark, setIsDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setIsDark((d) => !d)}
      aria-label="Theme wechseln"
      data-testid="button-theme-toggle"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={LibraryPage} />
      <Route path="/collection/:collectionId" component={CollectionPage} />
      <Route path="/law/:lawId/doc/:dokumentnummer" component={LawPage} />
      <Route path="/law/:lawId" component={LawPage} />
      <Route path="/search" component={SearchPage} />
      <Route path="/bookmarks" component={BookmarksPage} />
      <Route path="/admin" component={AdminPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router hook={useHashLocation}>
          <div className="min-h-screen bg-background text-foreground">
            <AppRouter />
          </div>
        </Router>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
