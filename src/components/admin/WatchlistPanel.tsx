import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Eye } from "lucide-react";

type Entry = {
  id: string;
  nom: string;
  plateforme: string | null;
  categorie: string;
  priorite: number;
  note: string | null;
  actif: boolean;
};

const CATEGORIES = [
  { value: "fabricants", label: "Fabricants" },
  { value: "concurrents", label: "Concurrents / Distributeurs" },
  { value: "reseau_revendeurs", label: "Réseau revendeurs (partenaires AA)" },
  { value: "flipper", label: "Scène flipper" },
  { value: "communaute_flipper", label: "Communauté flipper" },
  { value: "exploitants", label: "Exploitants / FEC" },
  { value: "tcg", label: "TCG / blindbox" },
  { value: "presse", label: "Presse" },
  { value: "contentieux", label: "Contentieux (surveillance sensible)" },
];

const PRIO_META: Record<number, { label: string; cls: string }> = {
  1: { label: "P1", cls: "bg-rose-500/15 text-rose-400 border-rose-500/40" },
  2: { label: "P2", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
  3: { label: "P3", cls: "bg-muted text-muted-foreground border-border" },
};

export function WatchlistPanel() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNom, setNewNom] = useState("");
  const [newCat, setNewCat] = useState("concurrents");
  const [newPrio, setNewPrio] = useState(2);
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("veille_watchlist")
      .select("*")
      .order("categorie", { ascending: true })
      .order("priorite", { ascending: true })
      .order("nom", { ascending: true });
    if (error) toast({ title: "Erreur", description: error.message, variant: "destructive" });
    setRows((data ?? []) as Entry[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const g: Record<string, Entry[]> = {};
    for (const r of rows) (g[r.categorie] ||= []).push(r);
    return g;
  }, [rows]);

  const update = async (id: string, patch: Partial<Entry>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await (supabase as any).from("veille_watchlist").update(patch).eq("id", id);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      load();
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cette entrée ?")) return;
    const { error } = await (supabase as any).from("veille_watchlist").delete().eq("id", id);
    if (error) { toast({ title: "Erreur", description: error.message, variant: "destructive" }); return; }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const add = async () => {
    if (!newNom.trim()) return;
    setSaving(true);
    const { data, error } = await (supabase as any)
      .from("veille_watchlist")
      .insert({
        nom: newNom.trim(),
        categorie: newCat,
        priorite: newPrio,
        note: newNote.trim() || null,
        actif: true,
      })
      .select()
      .single();
    setSaving(false);
    if (error) { toast({ title: "Erreur", description: error.message, variant: "destructive" }); return; }
    setRows((prev) => [...prev, data as Entry]);
    setNewNom(""); setNewNote("");
    toast({ title: "Ajouté", description: newNom });
  };

  const activeCount = rows.filter((r) => r.actif).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Eye className="h-4 w-4 text-primary" />
        <span>
          {activeCount} compte(s) actif(s) sur {rows.length} — priorité 1 couverte à chaque veille, priorité 2 opportunément.
        </span>
      </div>

      {/* Ajout */}
      <div className="rounded-lg border border-border bg-card/40 p-3 grid grid-cols-1 md:grid-cols-[1fr_180px_100px_1fr_auto] gap-2 items-end">
        <div>
          <label className="text-xs text-muted-foreground">Nom</label>
          <Input value={newNom} onChange={(e) => setNewNom(e.target.value)} placeholder="Ex. Stern Pinball" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Catégorie</label>
          <Select value={newCat} onValueChange={setNewCat}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Priorité</label>
          <Select value={String(newPrio)} onValueChange={(v) => setNewPrio(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">P1</SelectItem>
              <SelectItem value="2">P2</SelectItem>
              <SelectItem value="3">P3</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Note (facultative)</label>
          <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Ex. cashless" />
        </div>
        <Button onClick={add} disabled={saving || !newNom.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Ajouter</>}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : (
        <div className="space-y-4">
          {CATEGORIES.map((cat) => {
            const items = grouped[cat.value] ?? [];
            if (!items.length) return null;
            return (
              <div key={cat.value} className="rounded-lg border border-border bg-card/40">
                <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                  <div className="font-display text-sm font-semibold">{cat.label}</div>
                  <div className="text-xs text-muted-foreground">{items.length} entrée(s)</div>
                </div>
                <div className="divide-y divide-border">
                  {items.map((r) => {
                    const p = PRIO_META[r.priorite] ?? PRIO_META[3];
                    return (
                      <div key={r.id} className="px-3 py-2 flex items-center gap-3 flex-wrap">
                        <Select value={String(r.priorite)} onValueChange={(v) => update(r.id, { priorite: Number(v) })}>
                          <SelectTrigger className={`h-7 w-[70px] text-xs border ${p.cls}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">P1</SelectItem>
                            <SelectItem value="2">P2</SelectItem>
                            <SelectItem value="3">P3</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className={`flex-1 min-w-[180px] text-sm ${r.actif ? "" : "opacity-50 line-through"}`}>
                          <span className="font-medium">{r.nom}</span>
                          {r.note && <span className="text-xs text-muted-foreground ml-2">({r.note})</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Actif</span>
                          <Switch checked={r.actif} onCheckedChange={(v) => update(r.id, { actif: v })} />
                        </div>
                        <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
