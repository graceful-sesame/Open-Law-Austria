import { useQuery, useMutation } from "@tanstack/react-query";
import { adminApiRequest, getAdminToken, setAdminToken, queryClient } from "@/lib/queryClient";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Search, CheckCircle, XCircle, Loader2,
  BookOpen, Gavel, Shield, ShieldCheck, Scale, FolderOpen,
  AlertCircle, ChevronDown, ChevronRight, RefreshCw,
  ArrowUp, ArrowDown, Pencil, Download, Settings as SettingsIcon,
  Lock, LogIn, Eye, EyeOff,
} from "lucide-react";
import { useState, useEffect } from "react";

// ─── Icon map ────────────────────────────────────────────────────────────────
const ICON_OPTIONS = [
  { value: "BookOpen", label: "Buch", icon: BookOpen },
  { value: "Gavel", label: "Recht", icon: Gavel },
  { value: "Shield", label: "Schutz", icon: Shield },
  { value: "ShieldCheck", label: "Sicherheit", icon: ShieldCheck },
  { value: "Scale", label: "Waage", icon: Scale },
  { value: "FolderOpen", label: "Ordner", icon: FolderOpen },
];

const COLOR_OPTIONS = [
  { value: "red", label: "Rot", class: "bg-red-500" },
  { value: "blue", label: "Blau", class: "bg-blue-500" },
  { value: "amber", label: "Amber", class: "bg-amber-500" },
  { value: "green", label: "Grün", class: "bg-green-500" },
  { value: "purple", label: "Lila", class: "bg-purple-500" },
  { value: "indigo", label: "Indigo", class: "bg-indigo-500" },
  { value: "teal", label: "Teal", class: "bg-teal-500" },
];

// ─── Simple Modal ─────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-background border border-border rounded-lg shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-background z-10">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Add Law Form ─────────────────────────────────────────────────────────────
function AddLawForm({ collections, onDone }: { collections: any[]; onDone: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    gesetzesnummer: "",
    collectionId: collections[0]?.id ?? "",
    abkuerzung: "",
    title: "",
    shortDescription: "",
  });
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const addMutation = useMutation({
    mutationFn: (data: typeof form) =>
      adminApiRequest("POST", "/api/admin/laws", data).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/law-registry"] });
      toast({ title: `${form.abkuerzung} hinzugefügt`, description: "Paragraphen werden im Hintergrund heruntergeladen." });
      onDone();
    },
    onError: (err: any) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  async function doLookup() {
    if (!form.gesetzesnummer.trim()) return;
    setLookupLoading(true);
    try {
      const r = await adminApiRequest("GET", `/api/admin/ris-lookup?gesetzesnummer=${form.gesetzesnummer.trim()}`);
      const data = await r.json();
      setLookupResult(data);
      if (data.found) {
        setForm((f) => ({
          ...f,
          abkuerzung: data.abkuerzung || f.abkuerzung,
          title: data.kurztitel || f.title,
        }));
      }
    } finally {
      setLookupLoading(false);
    }
  }

  return (
    <div className="space-y-4 p-4 border border-border rounded-lg bg-muted/30">
      <h3 className="text-sm font-semibold">Neues Gesetz hinzufügen</h3>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground font-medium">
          1. Gesetzesnummer (RIS-Nummer aus data.bka.gv.at)
        </label>
        <div className="flex gap-2">
          <Input
            value={form.gesetzesnummer}
            onChange={(e) => { setForm((f) => ({ ...f, gesetzesnummer: e.target.value })); setLookupResult(null); }}
            placeholder="z.B. 10008147 für ASVG"
            className="font-mono text-sm flex-1"
            data-testid="input-law-gnr"
          />
          <Button variant="outline" size="sm" onClick={doLookup} disabled={!form.gesetzesnummer || lookupLoading} data-testid="button-lookup">
            {lookupLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-1" />}
            Prüfen
          </Button>
        </div>
        {lookupResult && (
          <div className={`flex items-center gap-2 text-xs p-2 rounded ${lookupResult.found ? "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400"}`}>
            {lookupResult.found
              ? <><CheckCircle className="w-3.5 h-3.5 shrink-0" /> {lookupResult.abkuerzung} — {lookupResult.totalHits} Dokumente in RIS</>
              : <><XCircle className="w-3.5 h-3.5 shrink-0" /> Keine Dokumente gefunden</>
            }
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">2. Abkürzung</label>
          <Input
            value={form.abkuerzung}
            onChange={(e) => setForm((f) => ({ ...f, abkuerzung: e.target.value }))}
            placeholder="z.B. ASVG"
            className="text-sm"
            data-testid="input-law-abk"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Collection</label>
          <select
            value={form.collectionId}
            onChange={(e) => setForm((f) => ({ ...f, collectionId: e.target.value }))}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            data-testid="select-collection"
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground font-medium">3. Vollständiger Titel</label>
        <Input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="z.B. Allgemeines Sozialversicherungsgesetz"
          className="text-sm"
          data-testid="input-law-title"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground font-medium">Kurzbeschreibung (optional)</label>
        <Input
          value={form.shortDescription}
          onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value }))}
          placeholder="z.B. Sozialversicherungsrecht für Arbeitnehmer"
          className="text-sm"
          data-testid="input-law-desc"
        />
      </div>

      <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded p-2">
        Nach dem Hinzufügen werden alle Paragraphen (Titel + Inhalt) vollständig heruntergeladen. Das kann einige Minuten dauern.
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" size="sm" onClick={onDone}>Abbrechen</Button>
        <Button
          size="sm"
          onClick={() => addMutation.mutate(form)}
          disabled={!form.gesetzesnummer || !form.abkuerzung || !form.title || !form.collectionId || addMutation.isPending}
          data-testid="button-add-law"
        >
          {addMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
          Gesetz hinzufügen
        </Button>
      </div>
    </div>
  );
}

// ─── Add Collection Form ──────────────────────────────────────────────────────
function AddCollectionForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: "", description: "", color: "blue", icon: "BookOpen" });

  const addMutation = useMutation({
    mutationFn: (data: typeof form) =>
      adminApiRequest("POST", "/api/admin/collections", data).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
      toast({ title: `Collection „${form.title}" erstellt` });
      onDone();
    },
    onError: (err: any) => {
      toast({ title: "Fehler", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4 p-4 border border-border rounded-lg bg-muted/30">
      <h3 className="text-sm font-semibold">Neue Collection erstellen</h3>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground font-medium">Name</label>
        <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="z.B. Sozialrecht" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground font-medium">Beschreibung</label>
        <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="z.B. Sozialversicherung, Arbeitsrecht" />
      </div>

      <div className="flex gap-4">
        <div className="space-y-1.5 flex-1">
          <label className="text-xs text-muted-foreground font-medium">Farbe</label>
          <div className="flex gap-1.5 flex-wrap">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.value}
                onClick={() => setForm((f) => ({ ...f, color: c.value }))}
                className={`w-6 h-6 rounded-full ${c.class} ring-2 ring-offset-2 transition-all ${form.color === c.value ? "ring-foreground" : "ring-transparent"}`}
                title={c.label}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5 flex-1">
          <label className="text-xs text-muted-foreground font-medium">Icon</label>
          <div className="flex gap-1.5 flex-wrap">
            {ICON_OPTIONS.map((ic) => {
              const IconComp = ic.icon;
              return (
                <button
                  key={ic.value}
                  onClick={() => setForm((f) => ({ ...f, icon: ic.value }))}
                  className={`w-8 h-8 rounded flex items-center justify-center border transition-all ${form.icon === ic.value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50"}`}
                  title={ic.label}
                >
                  <IconComp className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" size="sm" onClick={onDone}>Abbrechen</Button>
        <Button
          size="sm"
          onClick={() => addMutation.mutate(form)}
          disabled={!form.title || addMutation.isPending}
        >
          {addMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
          Collection erstellen
        </Button>
      </div>
    </div>
  );
}

// ─── Edit Collection Dialog ───────────────────────────────────────────────────
function EditCollectionDialog({ col, open, onClose }: { col: any; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: col?.title ?? "",
    description: col?.description ?? "",
    color: col?.color ?? "blue",
    icon: col?.icon ?? "BookOpen",
  });

  useEffect(() => {
    if (col) {
      setForm({
        title: col.title ?? "",
        description: col.description ?? "",
        color: col.color ?? "blue",
        icon: col.icon ?? "BookOpen",
      });
    }
  }, [col]);

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) =>
      adminApiRequest("PATCH", `/api/admin/collections/${col.id}`, data).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
      toast({ title: "Collection aktualisiert" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Fehler", description: err.message, variant: "destructive" }),
  });

  return (
    <Modal open={open} onClose={onClose} title={`Collection bearbeiten: ${col?.title ?? ""}`}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Name</label>
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Beschreibung</label>
          <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="flex gap-4">
          <div className="space-y-1.5 flex-1">
            <label className="text-xs text-muted-foreground font-medium">Farbe</label>
            <div className="flex gap-1.5 flex-wrap">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setForm((f) => ({ ...f, color: c.value }))}
                  className={`w-6 h-6 rounded-full ${c.class} ring-2 ring-offset-2 transition-all ${form.color === c.value ? "ring-foreground" : "ring-transparent"}`}
                  title={c.label}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5 flex-1">
            <label className="text-xs text-muted-foreground font-medium">Icon</label>
            <div className="flex gap-1.5 flex-wrap">
              {ICON_OPTIONS.map((ic) => {
                const IconComp = ic.icon;
                return (
                  <button
                    key={ic.value}
                    onClick={() => setForm((f) => ({ ...f, icon: ic.value }))}
                    className={`w-8 h-8 rounded flex items-center justify-center border transition-all ${form.icon === ic.value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50"}`}
                    title={ic.label}
                  >
                    <IconComp className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Abbrechen</Button>
          <Button size="sm" onClick={() => saveMutation.mutate(form)} disabled={!form.title || saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
            Speichern
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Edit Law Dialog ──────────────────────────────────────────────────────────
function EditLawDialog({ law, collections, open, onClose }: { law: any; collections: any[]; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    abkuerzung: law?.abkuerzung ?? "",
    title: law?.title ?? "",
    shortDescription: law?.shortDescription ?? "",
    collectionId: law?.collectionId ?? collections[0]?.id ?? "",
    autoUpdate: law?.autoUpdate ?? true,
  });

  useEffect(() => {
    if (law) {
      setForm({
        abkuerzung: law.abkuerzung ?? "",
        title: law.title ?? "",
        shortDescription: law.shortDescription ?? "",
        collectionId: law.collectionId ?? collections[0]?.id ?? "",
        autoUpdate: law.autoUpdate ?? true,
      });
    }
  }, [law, collections]);

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) =>
      adminApiRequest("PATCH", `/api/admin/laws/${law.id}`, data).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
      toast({ title: "Gesetz aktualisiert" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Fehler", description: err.message, variant: "destructive" }),
  });

  return (
    <Modal open={open} onClose={onClose} title={`Gesetz bearbeiten: ${law?.abkuerzung ?? ""}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Abkürzung</label>
            <Input value={form.abkuerzung} onChange={(e) => setForm((f) => ({ ...f, abkuerzung: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Collection</label>
            <select
              value={form.collectionId}
              onChange={(e) => setForm((f) => ({ ...f, collectionId: e.target.value }))}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Titel</label>
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Kurzbeschreibung</label>
          <Input value={form.shortDescription} onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value }))} />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.autoUpdate}
            onChange={(e) => setForm((f) => ({ ...f, autoUpdate: e.target.checked }))}
            className="w-4 h-4"
          />
          <span>Auto-Update aktiv (Paragraphen werden regelmäßig aus RIS aktualisiert)</span>
        </label>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Abbrechen</Button>
          <Button size="sm" onClick={() => saveMutation.mutate(form)} disabled={!form.title || !form.abkuerzung || saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
            Speichern
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Download Progress Badge ──────────────────────────────────────────────────
function DownloadProgress({ lawId, onComplete }: { lawId: string; onComplete: () => void }) {
  const [progress, setProgress] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await adminApiRequest("GET", `/api/admin/laws/${lawId}/download`);
        const data = await r.json();
        if (cancelled) return;
        setProgress(data);
        if (data.status === "done" || data.status === "error" || data.status === "idle") {
          onComplete();
          return;
        }
      } catch {}
      if (!cancelled) setTimeout(poll, 1500);
    }
    poll();
    return () => { cancelled = true; };
  }, [lawId]);

  if (!progress || progress.status === "idle") return null;
  if (progress.status === "error") {
    return <Badge variant="outline" className="text-xs text-red-600">Fehler</Badge>;
  }
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <Badge variant="secondary" className="text-xs">
      <Loader2 className="w-3 h-3 animate-spin mr-1" />
      {progress.current}/{progress.total || "?"} ({pct}%)
    </Badge>
  );
}

// ─── Collection Row ───────────────────────────────────────────────────────────
function CollectionRow({
  col,
  collections,
  onEditLaw,
  onEditCol,
  onDeleteLaw,
  onDeleteCol,
}: {
  col: any;
  collections: any[];
  onEditLaw: (law: any) => void;
  onEditCol: (col: any) => void;
  onDeleteLaw: (lawId: string, abk: string) => void;
  onDeleteCol: (col: any) => void;
}) {
  const [open, setOpen] = useState(true);
  const [savingOrder, setSavingOrder] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { toast } = useToast();

  async function moveLaw(idx: number, direction: -1 | 1) {
    const laws = col.laws ?? [];
    const target = idx + direction;
    if (target < 0 || target >= laws.length) return;
    const newLaws = [...laws];
    [newLaws[idx], newLaws[target]] = [newLaws[target], newLaws[idx]];
    const lawIds = newLaws.map((l: any) => l.id);
    setSavingOrder(true);
    try {
      await adminApiRequest("PUT", `/api/admin/collections/${col.id}/order`, { lawIds });
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
    } catch (e: any) {
      toast({ title: "Reihenfolge konnte nicht gespeichert werden", description: e.message, variant: "destructive" });
    } finally {
      setSavingOrder(false);
    }
  }

  async function redownload(lawId: string, abk: string) {
    try {
      await adminApiRequest("POST", `/api/admin/laws/${lawId}/download`, {});
      setDownloadingId(lawId);
      toast({ title: `${abk}: Download gestartet` });
    } catch (e: any) {
      toast({ title: "Fehler beim Start", description: e.message, variant: "destructive" });
    }
  }

  async function toggleAutoUpdate(law: any) {
    try {
      await adminApiRequest("PATCH", `/api/admin/laws/${law.id}`, { autoUpdate: !law.autoUpdate });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    }
  }

  const laws = col.laws ?? [];

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="w-full flex items-center gap-3 px-4 py-3 bg-card">
        <button
          className="flex items-center gap-2 flex-1 text-left hover:opacity-80"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div className={`w-2 h-2 rounded-full bg-${col.color}-500 shrink-0`} />
          <span className="font-semibold text-sm">{col.title}</span>
          <Badge variant="secondary" className="text-xs ml-2">{laws.length} Gesetze</Badge>
          {col.isBuiltin ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">Standard</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">Eigen</Badge>
          )}
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onEditCol(col)}
          title="Bearbeiten"
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={() => onDeleteCol(col)}
          title="Löschen"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {open && (
        <div className="border-t border-border divide-y divide-border">
          {laws.length === 0 && (
            <p className="px-4 py-3 text-xs text-muted-foreground">Noch keine Gesetze in dieser Collection.</p>
          )}
          {laws.map((law: any, idx: number) => (
            <div key={law.id} className="flex items-center gap-2 px-3 py-2.5 bg-background hover:bg-muted/30 transition-colors">
              <div className="flex flex-col shrink-0">
                <Button variant="ghost" size="sm" className="h-4 w-6 p-0 text-muted-foreground" onClick={() => moveLaw(idx, -1)} disabled={idx === 0 || savingOrder} aria-label="Nach oben">
                  <ArrowUp className="w-3 h-3" />
                </Button>
                <Button variant="ghost" size="sm" className="h-4 w-6 p-0 text-muted-foreground" onClick={() => moveLaw(idx, 1)} disabled={idx === laws.length - 1 || savingOrder} aria-label="Nach unten">
                  <ArrowDown className="w-3 h-3" />
                </Button>
              </div>

              <span className="font-mono font-bold text-primary text-sm w-14 shrink-0 truncate">{law.abkuerzung}</span>
              <span className="text-sm text-foreground flex-1 truncate" title={law.title}>{law.title}</span>

              <div className="flex items-center gap-1.5 shrink-0">
                {law.cached ? (
                  <Badge variant="secondary" className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30">
                    <CheckCircle className="w-3 h-3 mr-1" />{law.docCount}
                  </Badge>
                ) : downloadingId === law.id ? (
                  <DownloadProgress
                    lawId={law.id}
                    onComplete={() => {
                      setDownloadingId(null);
                      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
                    }}
                  />
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">Nicht geladen</Badge>
                )}

                <button
                  onClick={() => toggleAutoUpdate(law)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${law.autoUpdate ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800" : "bg-muted text-muted-foreground border-border"}`}
                  title={law.autoUpdate ? "Auto-Update aktiv" : "Auto-Update deaktiviert"}
                >
                  Auto
                </button>

                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => redownload(law.id, law.abkuerzung)} title="Neu herunterladen">
                  <Download className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onEditLaw(law)} title="Bearbeiten">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => onDeleteLaw(law.id, law.abkuerzung)} title="Löschen">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function SettingsPanel() {
  const { toast } = useToast();
  const { data: settings } = useQuery({
    queryKey: ["/api/admin/settings"],
    queryFn: () => adminApiRequest("GET", "/api/admin/settings").then((r) => r.json()),
  });

  const [ttl, setTtl] = useState<number>(24);
  const [autoDefault, setAutoDefault] = useState<boolean>(true);

  useEffect(() => {
    if (settings) {
      setTtl(settings.autoUpdateTtlHours ?? 24);
      setAutoDefault(settings.defaultAutoUpdate ?? true);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: { autoUpdateTtlHours: number; defaultAutoUpdate: boolean }) =>
      adminApiRequest("PATCH", "/api/admin/settings", data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Einstellungen gespeichert" });
    },
    onError: (e: any) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 p-4 border border-border rounded-lg bg-muted/30">
      <div className="flex items-center gap-2">
        <SettingsIcon className="w-4 h-4" />
        <h3 className="text-sm font-semibold">Auto-Update Einstellungen</h3>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground font-medium">Update-Intervall (Stunden)</label>
        <Input
          type="number"
          min={1}
          max={720}
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value))}
          className="text-sm max-w-[180px]"
        />
        <p className="text-[11px] text-muted-foreground">
          Gesetze mit aktiviertem Auto-Update werden neu geladen, wenn ihre Daten älter als dieser Wert sind. Prüfung stündlich.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={autoDefault}
          onChange={(e) => setAutoDefault(e.target.checked)}
          className="w-4 h-4"
        />
        <span>Auto-Update für neue Gesetze standardmäßig aktivieren</span>
      </label>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => saveMutation.mutate({ autoUpdateTtlHours: ttl, defaultAutoUpdate: autoDefault })} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          Speichern
        </Button>
      </div>
    </div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────

// ─── Admin Token Gate ────────────────────────────────────────────────────────

function useAdminAuth() {
  const [authState, setAuthState] = useState<"loading" | "ok" | "required">("loading");
  const [storedToken, setStoredToken] = useState(() => getAdminToken());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/collections", {
      headers: storedToken ? { Authorization: `Bearer ${storedToken}` } : {},
    })
      .then((r) => {
        if (cancelled) return;
        if (r.status === 401 || r.status === 403) setAuthState("required");
        else setAuthState("ok");
      })
      .catch(() => { if (!cancelled) setAuthState("ok"); });
    return () => { cancelled = true; };
  }, [storedToken]);

  const saveToken = (token: string) => {
    setAdminToken(token);
    setStoredToken(token);
    setAuthState("loading");
    queryClient.clear();
  };

  const clearToken = () => saveToken("");

  return { authState, saveToken, clearToken };
}

function AdminTokenPrompt({ onSave }: { onSave: (t: string) => void }) {
  const [input, setInput] = useState("");
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm px-4 py-2.5">
        <span className="font-semibold text-primary text-sm">Open-Law-Austria</span>
      </div>
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm border border-border rounded-lg p-6 bg-card shadow-md">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-base">Admin-Bereich gesichert</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Bitte den <code className="bg-muted px-1 rounded text-xs">ADMIN_TOKEN</code> eingeben,
            der beim Serverstart als Umgebungsvariable gesetzt wurde.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showPw ? "text" : "password"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && input && onSave(input)}
                placeholder="Token eingeben…"
                className="w-full h-9 rounded-md border border-input bg-background px-3 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              disabled={!input}
              onClick={() => onSave(input)}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
            >
              <LogIn className="w-4 h-4" />
              OK
            </button>
          </div>
          <p className="text-xs text-muted-foreground/60 mt-3">
            Ohne gesetzten <code className="bg-muted px-1 rounded">ADMIN_TOKEN</code> ist dieser Bereich ohne Eingabe zugänglich.
          </p>
        </div>
      </div>
    </div>
  );
}

function AdminContent() {

  const { toast } = useToast();
  const [showAddLaw, setShowAddLaw] = useState(false);
  const [showAddCol, setShowAddCol] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editCol, setEditCol] = useState<any>(null);
  const [editLaw, setEditLaw] = useState<any>(null);

  const { data: collections = [], isLoading } = useQuery({
    queryKey: ["/api/admin/collections"],
    queryFn: () => adminApiRequest("GET", "/api/admin/collections").then((r) => r.json()),
  });

  const deleteColMutation = useMutation({
    mutationFn: (id: string) =>
      adminApiRequest("DELETE", `/api/admin/collections/${id}`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
      toast({ title: "Collection gelöscht" });
    },
    onError: (e: any) => toast({ title: "Fehler beim Löschen", description: e.message, variant: "destructive" }),
  });

  const deleteLawMutation = useMutation({
    mutationFn: (lawId: string) =>
      adminApiRequest("DELETE", `/api/admin/laws/${lawId}`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/law-registry"] });
      toast({ title: "Gesetz entfernt" });
    },
    onError: (e: any) => toast({ title: "Fehler beim Löschen", description: e.message, variant: "destructive" }),
  });

  const breadcrumbs = [
    { label: "Bibliothek", href: "/" },
    { label: "Verwaltung" },
  ];

  function handleDeleteCol(col: any) {
    const lawCount = col.laws?.length ?? 0;
    const msg = lawCount > 0
      ? `Collection „${col.title}" und alle ${lawCount} enthaltenen Gesetze wirklich löschen?`
      : `Collection „${col.title}" wirklich löschen?`;
    if (confirm(msg)) deleteColMutation.mutate(col.id);
  }

  function handleDeleteLaw(lawId: string, abk: string) {
    if (confirm(`${abk} wirklich löschen? Alle gespeicherten Paragraphen werden entfernt.`)) {
      deleteLawMutation.mutate(lawId);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader breadcrumbs={breadcrumbs} />

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-foreground mb-1">Gesetzesverwaltung</h1>
          <p className="text-sm text-muted-foreground">
            Gesetze und Sammlungen verwalten. Neue Gesetze werden über die{" "}
            <a href="https://data.bka.gv.at/ris/api/v2.6/" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              RIS OGD API
            </a>{" "}
            geladen.
          </p>
        </div>

        <div className="mb-6 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 text-xs text-blue-800 dark:text-blue-200 flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong>Gesetzesnummer finden:</strong> Öffne{" "}
            <a href="https://www.ris.bka.gv.at" target="_blank" rel="noopener noreferrer" className="underline">ris.bka.gv.at</a>,
            suche das Gesetz, und entnehme die Nummer aus der URL oder den Metadaten (z.B. „10008147" für das ASVG).
          </div>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          <Button
            onClick={() => { setShowAddLaw((v) => !v); setShowAddCol(false); setShowSettings(false); }}
            variant={showAddLaw ? "default" : "outline"}
            size="sm"
          >
            <Plus className="w-4 h-4 mr-1.5" /> Gesetz hinzufügen
          </Button>
          <Button
            onClick={() => { setShowAddCol((v) => !v); setShowAddLaw(false); setShowSettings(false); }}
            variant={showAddCol ? "default" : "outline"}
            size="sm"
          >
            <FolderOpen className="w-4 h-4 mr-1.5" /> Neue Collection
          </Button>
          <Button
            onClick={() => { setShowSettings((v) => !v); setShowAddLaw(false); setShowAddCol(false); }}
            variant={showSettings ? "default" : "outline"}
            size="sm"
          >
            <SettingsIcon className="w-4 h-4 mr-1.5" /> Einstellungen
          </Button>
        </div>

        {showAddLaw && (
          <div className="mb-6">
            <AddLawForm collections={collections} onDone={() => setShowAddLaw(false)} />
          </div>
        )}
        {showAddCol && (
          <div className="mb-6">
            <AddCollectionForm onDone={() => setShowAddCol(false)} />
          </div>
        )}
        {showSettings && (
          <div className="mb-6">
            <SettingsPanel />
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : (
          <div className="space-y-3">
            {collections.map((col: any) => (
              <CollectionRow
                key={col.id}
                col={col}
                collections={collections}
                onEditLaw={setEditLaw}
                onEditCol={setEditCol}
                onDeleteLaw={handleDeleteLaw}
                onDeleteCol={handleDeleteCol}
              />
            ))}
          </div>
        )}

        <div className="mt-10 pt-4 border-t border-border text-xs text-muted-foreground text-center">
          Open-Law-Austria Verwaltung — Datenquelle:{" "}
          <a href="https://data.bka.gv.at/ris/api/v2.6/" target="_blank" rel="noopener noreferrer" className="underline">
            RIS OGD API v2.6
          </a>
        </div>
      </main>

      {editCol && (
        <EditCollectionDialog col={editCol} open={!!editCol} onClose={() => setEditCol(null)} />
      )}
      {editLaw && (
        <EditLawDialog law={editLaw} collections={collections} open={!!editLaw} onClose={() => setEditLaw(null)} />
      )}
    </div>
  );
}

export default function AdminPage() {
  const { authState, saveToken } = useAdminAuth();

  if (authState === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (authState === "required") {
    return <AdminTokenPrompt onSave={saveToken} />;
  }
  return <AdminContent />;
}
