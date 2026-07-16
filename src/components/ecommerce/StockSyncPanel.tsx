import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, RefreshCw, PackageCheck, AlertTriangle, ArrowRight, CheckCircle2, XCircle, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

type Row = {
  productId: string;
  name: string;
  cegid: string | null;
  shopifyId: string;
  variantId?: string;
  inventoryItemId?: string;
  erp: number | null;
  shopify: number | null;
  delta: number | null;
  status: "ok" | "missing" | "error";
  message?: string;
};

type LogRow = {
  id: string;
  product_name: string | null;
  cegid_code: string | null;
  qty_before: number | null;
  qty_after: number | null;
  delta: number | null;
  status: string;
  message: string | null;
  created_at: string;
};

async function callFn(body: any) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const r = await fetch(`https://${projectId}.supabase.co/functions/v1/shopify-stock-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export default function StockSyncPanel() {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastCegid, setLastCegid] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [applyResult, setApplyResult] = useState<any[] | null>(null);
  const [applyEnabled, setApplyEnabled] = useState<boolean>(false);

  const loadLogs = async () => {
    const { data } = await supabase
      .from("stock_sync_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setLogs((data as LogRow[]) || []);
  };

  const loadApplyFlag = async () => {
    const { data } = await supabase
      .from("gaia_config")
      .select("value")
      .eq("key", "stock_sync_apply_enabled")
      .maybeSingle();
    setApplyEnabled(String((data as any)?.value ?? "false").toLowerCase() === "true");
  };

  useEffect(() => { loadLogs(); loadApplyFlag(); }, []);


  const analyze = async () => {
    setLoading(true);
    setRows(null);
    setApplyResult(null);
    try {
      const j = await callFn({ mode: "preview" });
      const rs: Row[] = j.rows || [];
      setRows(rs);
      setLastCegid(j.lastCegidSync || null);
      // Default-select only lines with non-zero delta
      const toSelect = new Set(
        rs.filter((r) => r.status === "ok" && r.erp !== null && r.delta !== null && r.delta !== 0)
          .map((r) => r.productId),
      );
      setSelected(toSelect);
    } catch (e: any) {
      toast.error("Erreur analyse stocks", { description: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  const applySelected = async () => {
    if (!rows) return;
    setApplying(true);
    try {
      const items = rows
        .filter((r) => selected.has(r.productId) && r.erp !== null)
        .map((r) => ({ productId: r.productId, targetQty: Math.floor(r.erp as number) }));
      const j = await callFn({ mode: "apply", items });
      setApplyResult(j.results || []);
      const okCount = (j.results || []).filter((r: any) => r.status === "ok").length;
      const koCount = (j.results || []).length - okCount;
      if (koCount === 0) toast.success(`Synchronisation appliquée (${okCount})`);
      else toast.warning(`${okCount} OK · ${koCount} en erreur`);
      await loadLogs();
      await analyze();
    } catch (e: any) {
      toast.error("Erreur synchronisation", { description: e?.message || String(e) });
    } finally {
      setApplying(false);
      setConfirmOpen(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (!rows) return;
    const eligible = rows.filter((r) => r.status === "ok" && r.erp !== null);
    if (selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible.map((r) => r.productId)));
  };

  const cegidStale =
    lastCegid && (Date.now() - new Date(lastCegid).getTime() > 24 * 3600 * 1000);
  const selectedCount = selected.size;
  const nonZeroCount = rows?.filter((r) => r.status === "ok" && r.delta !== null && r.delta !== 0).length ?? 0;

  return (
    <>
      <Card className="p-4 sm:p-6 bg-card/60 border-border">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="font-display text-lg font-semibold flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-primary" /> Synchronisation stocks ERP → Shopify
          </h2>
          <Button size="sm" variant="outline" onClick={analyze} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Analyser les écarts
          </Button>
        </div>

        {lastCegid && (
          <div className={`text-xs mb-3 ${cegidStale ? "text-yellow-500" : "text-muted-foreground"}`}>
            {cegidStale && <AlertTriangle className="h-3 w-3 inline mr-1" />}
            Dernière synchro Cegid : {new Date(lastCegid).toLocaleString("fr-FR")}
            {cegidStale && " — plus de 24 h, envisagez de resynchroniser Cegid d'abord."}
          </div>
        )}

        {!rows && !loading && (
          <p className="text-sm text-muted-foreground">
            Lance une analyse pour comparer le stock ERP (Gaia) avec le stock Shopify des produits appairés.
          </p>
        )}

        {rows && (
          <>
            <div className="text-xs text-muted-foreground mb-2">
              {rows.length} produits appairés · {nonZeroCount} écart(s) non nul(s) · {selectedCount} sélectionné(s)
            </div>
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-background/60">
                  <tr className="text-left text-[11px] uppercase text-muted-foreground">
                    <th className="p-2 w-8">
                      <Checkbox
                        checked={selectedCount > 0 && selectedCount === rows.filter((r) => r.status === "ok" && r.erp !== null).length}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                    <th className="p-2">Produit</th>
                    <th className="p-2">Code Cegid</th>
                    <th className="p-2 text-right">ERP</th>
                    <th className="p-2 text-right">Shopify</th>
                    <th className="p-2 text-right">Δ</th>
                    <th className="p-2">État</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const disabled = r.status !== "ok" || r.erp === null;
                    const zeroDelta = r.delta === 0;
                    return (
                      <tr key={r.productId} className={`border-t border-border/40 ${zeroDelta ? "opacity-60" : ""}`}>
                        <td className="p-2">
                          <Checkbox
                            checked={selected.has(r.productId)}
                            disabled={disabled}
                            onCheckedChange={() => toggle(r.productId)}
                          />
                        </td>
                        <td className="p-2 max-w-[240px] truncate">{r.name}</td>
                        <td className="p-2 text-xs text-muted-foreground">{r.cegid || "—"}</td>
                        <td className="p-2 text-right tabular-nums">{r.erp ?? "—"}</td>
                        <td className="p-2 text-right tabular-nums">{r.shopify ?? "—"}</td>
                        <td className={`p-2 text-right tabular-nums font-medium ${
                          r.delta === null ? "" : r.delta > 0 ? "text-secondary" : r.delta < 0 ? "text-destructive" : "text-muted-foreground"
                        }`}>
                          {r.delta === null ? "—" : (r.delta > 0 ? `+${r.delta}` : r.delta)}
                        </td>
                        <td className="p-2">
                          {r.status === "ok" ? (
                            zeroDelta ? (
                              <span className="text-[11px] text-muted-foreground">à jour</span>
                            ) : (
                              <Badge variant="outline" className="text-[10px] bg-primary/15 text-primary border-primary/40">
                                écart
                              </Badge>
                            )
                          ) : (
                            <span className="text-[11px] text-destructive truncate" title={r.message}>
                              {r.status === "missing" ? "introuvable" : r.message || "erreur"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="p-4 text-center text-sm text-muted-foreground">
                      Aucun produit appairé (cegid_code + shopify_id).
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {isAdmin && selectedCount > 0 && (
              <div className="mt-4 flex justify-end">
                <Button onClick={() => setConfirmOpen(true)} disabled={applying}>
                  {applying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                  Appliquer la synchronisation ({selectedCount} produit{selectedCount > 1 ? "s" : ""})
                </Button>
              </div>
            )}
            {!isAdmin && selectedCount > 0 && (
              <div className="mt-3 text-xs text-muted-foreground">
                Seul un administrateur peut appliquer la synchronisation.
              </div>
            )}

            {applyResult && (
              <div className="mt-4 rounded-md border border-border/60 bg-background/40 p-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Résultat</div>
                <div className="space-y-1 text-sm">
                  {applyResult.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {r.status === "ok"
                          ? <CheckCircle2 className="h-4 w-4 text-secondary flex-shrink-0" />
                          : <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />}
                        <span className="truncate">{r.name || r.productId}</span>
                      </div>
                      <div className="text-xs tabular-nums text-muted-foreground flex-shrink-0">
                        {r.status === "ok"
                          ? `${r.before} → ${r.after}`
                          : (r.message || r.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* History */}
      <Card className="p-4 sm:p-6 bg-card/60 border-border">
        <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
          <History className="h-4 w-4 text-primary" /> Historique des synchronisations
        </h2>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune synchronisation enregistrée.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-background/60">
                <tr className="text-left text-[11px] uppercase text-muted-foreground">
                  <th className="p-2">Date</th>
                  <th className="p-2">Produit</th>
                  <th className="p-2">Code</th>
                  <th className="p-2 text-right">Avant</th>
                  <th className="p-2 text-right">Après</th>
                  <th className="p-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-border/40">
                    <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString("fr-FR")}
                    </td>
                    <td className="p-2 max-w-[240px] truncate">{l.product_name || "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{l.cegid_code || "—"}</td>
                    <td className="p-2 text-right tabular-nums">{l.qty_before ?? "—"}</td>
                    <td className="p-2 text-right tabular-nums">{l.qty_after ?? "—"}</td>
                    <td className="p-2">
                      {l.status === "ok" ? (
                        <Badge variant="outline" className="text-[10px] bg-secondary/15 text-secondary border-secondary/40">OK</Badge>
                      ) : (
                        <span className="text-[11px] text-destructive" title={l.message || ""}>{l.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Appliquer la synchronisation ?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCount} produit{selectedCount > 1 ? "s" : ""} vont être mis à jour dans Shopify avec les quantités de l'ERP. Cette action modifie directement le stock de la boutique en ligne.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); applySelected(); }} disabled={applying}>
              {applying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
