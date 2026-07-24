import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

// ------------------------------------------------------------
// Parsing KPI.xlsx (feuilles mensuelles Mai, Juin, Juillet, …)
// ------------------------------------------------------------

type ParsedRow = {
  date: string;
  visiteurs: number;
  nb_parties: number;
  nb_cartes_vendues: number;
  ca_cartes_ht: number;
  ca_pax_ht: number;
  ca_merch_ht: number;
  ca_vending_pokemon_ht: number;
  ca_vending_blindbox_ht: number;
  ca_photomaton_ht: number;
  notes: string;
  _sheet: string;
  _section: string;
  _layout: string;
};

const MONTHS_FR: Record<string, number> = {
  janvier: 0, fevrier: 1, "février": 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, "août": 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11, "décembre": 11,
};
const DAYS_FR: Record<string, number> = {
  lundi: 0, mardi: 1, mercredi: 2, jeudi: 3, vendredi: 4, samedi: 5, dimanche: 6,
};

const norm = (s: any): string =>
  String(s ?? "")
    .replace(/\r?\n/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mondayOf = (d: Date) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x;
};
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function parseSectionDate(row: any[], sheetName: string): Date | null {
  const joined = row.map((c) => String(c ?? "")).join(" ");
  const m = norm(joined).match(/du\s+(\d{1,2})\s+([a-zéû]+)(?:\s+(\d{4}))?/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTHS_FR[m[2]];
  if (month === undefined) return null;
  const year = m[3] ? parseInt(m[3], 10) : inferYearFromSheet(sheetName, month);
  const d = new Date(year, month, day);
  if (isNaN(d.getTime())) return null;
  return d;
}

function inferYearFromSheet(sheetName: string, month: number): number {
  const yearMatch = sheetName.match(/(20\d{2})/);
  if (yearMatch) return parseInt(yearMatch[1], 10);
  const now = new Date();
  const y = now.getFullYear();
  if (month > now.getMonth() + 2) return y - 1;
  return y;
}

function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const raw = String(v).trim();
  if (!raw || raw === "." || raw === "-") return 0;
  const s = raw.replace(/\s|€|EUR/gi, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

type ColMap = {
  visiteurs: number;
  parties: number;
  cartes_vendues: number;
  ca_pax: number;
  ca_cartes: number;
  merch_ht: number;
  vending_pokemon: number;
  vending_blindbox: number;
  photo: number;
  notes: number;
};

function buildHeader(grid: any[][], headerRowIdx: number): string[] {
  const r1 = grid[headerRowIdx] ?? [];
  const r2 = grid[headerRowIdx + 1] ?? [];
  // Heuristique : ligne suivante utilisée comme complément d'en-tête uniquement si ce n'est pas un jour de la semaine
  const isDayNext = DAYS_FR[norm(r2[0])] !== undefined;
  const width = Math.max(r1.length, isDayNext ? 0 : r2.length);
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const a = r1[i];
    const b = isDayNext ? "" : r2[i];
    out.push(norm(`${a ?? ""} ${b ?? ""}`));
  }
  return out;
}

function detectColumns(headers: string[]): ColMap {
  const find = (pred: (h: string) => boolean): number => headers.findIndex(pred);
  const visiteurs = find((h) => h.includes("visiteur"));
  const parties = find((h) => h.includes("parties"));
  const ca_pax = find((h) => h.includes("ca ht") && h.includes("pax"));
  const merch_ht = find((h) => h.includes("merch") && h.includes("ht") && !h.includes("ttc") && !h.includes("objectif") && !h.includes("obj "));
  const vending_pokemon = find((h) => h.includes("vending") && h.includes("pokemon"));
  // "vending" seul, sans "pokemon"
  const vending_blindbox = headers.findIndex((h, i) => h.includes("vending") && !h.includes("pokemon") && i !== vending_pokemon);
  const photo = find((h) => h.includes("photo"));
  const notes = find((h) => h.includes("commentaire"));
  return {
    visiteurs,
    parties,
    cartes_vendues: parties >= 0 ? parties + 1 : -1,
    ca_pax,
    ca_cartes: ca_pax >= 0 ? ca_pax + 1 : -1,
    merch_ht,
    vending_pokemon,
    vending_blindbox,
    photo,
    notes,
  };
}

function cellNum(row: any[], idx: number): number {
  if (idx < 0) return 0;
  return toNum(row[idx]);
}
function cellInt(row: any[], idx: number): number {
  return Math.max(0, Math.trunc(cellNum(row, idx)));
}

const SKIP_SHEET_RE = /(totaux|detail\s*cartes|détail\s*cartes)/i;

function parseWorkbook(wb: XLSX.WorkBook): { rows: ParsedRow[]; warnings: string[] } {
  const rows: ParsedRow[] = [];
  const warnings: string[] = [];

  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEET_RE.test(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    if (!grid.length) continue;

    const hasSection = grid.some((r) => /^s\d{1,2}$/i.test(String(r?.[0] ?? "").trim()));
    if (!hasSection) continue;

    let currentMonday: Date | null = null;
    let currentSection = "";
    let cols: ColMap | null = null;
    let headerSig = "";

    for (let i = 0; i < grid.length; i++) {
      const row = grid[i] ?? [];
      const colA = String(row[0] ?? "").trim();

      if (/^s\d{1,2}$/i.test(colA)) {
        const dt = parseSectionDate(row, sheetName);
        if (!dt) {
          warnings.push(`${sheetName} · ${colA} : date de section illisible, section ignorée`);
          cols = null;
          continue;
        }
        currentMonday = mondayOf(dt);
        currentSection = `${sheetName} · ${colA}`;
        // La ligne d'en-tête est la suivante (parfois répartie sur 2 lignes)
        const headers = buildHeader(grid, i + 1);
        cols = detectColumns(headers);
        headerSig = `V${cols.visiteurs} P${cols.parties} X${cols.ca_pax} M${cols.merch_ht}`;
        if (cols.ca_pax < 0 || cols.parties < 0 || cols.visiteurs < 0) {
          warnings.push(`${sheetName} · ${colA} : en-têtes non reconnus (colonnes clés manquantes)`);
          cols = null;
        }
        continue;
      }

      if (!cols || !currentMonday) continue;
      const dayIdx = DAYS_FR[norm(colA)];
      if (dayIdx === undefined) continue;

      const dayDate = addDays(currentMonday, dayIdx);
      const values = {
        visiteurs: cellInt(row, cols.visiteurs),
        nb_parties: cellInt(row, cols.parties),
        nb_cartes_vendues: cellInt(row, cols.cartes_vendues),
        ca_pax_ht: cellNum(row, cols.ca_pax),
        ca_cartes_ht: cellNum(row, cols.ca_cartes),
        ca_merch_ht: cellNum(row, cols.merch_ht),
        ca_vending_pokemon_ht: cellNum(row, cols.vending_pokemon),
        ca_vending_blindbox_ht: cellNum(row, cols.vending_blindbox),
        ca_photomaton_ht: cellNum(row, cols.photo),
        notes: cols.notes >= 0 ? String(row[cols.notes] ?? "").trim() : "",
      };

      const totalCa =
        values.ca_cartes_ht + values.ca_pax_ht + values.ca_merch_ht +
        values.ca_vending_pokemon_ht + values.ca_vending_blindbox_ht + values.ca_photomaton_ht;
      if (totalCa === 0 && values.visiteurs === 0 && values.nb_parties === 0 && values.nb_cartes_vendues === 0 && !values.notes) {
        continue;
      }

      rows.push({
        date: toYmd(dayDate),
        ...values,
        _sheet: sheetName,
        _section: currentSection,
        _layout: headerSig,
      });
    }
  }

  const byDate = new Map<string, ParsedRow>();
  for (const r of rows) byDate.set(r.date, r);
  return { rows: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)), warnings };
}


// ------------------------------------------------------------
// UI
// ------------------------------------------------------------

const eur2 = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

const totalCaOf = (r: ParsedRow) =>
  r.ca_cartes_ht + r.ca_pax_ht + r.ca_merch_ht +
  r.ca_vending_pokemon_ht + r.ca_vending_blindbox_ht + r.ca_photomaton_ht;

type Diff = { nouveaux: number; modifies: number; identiques: number; newDates: string[]; changedDates: string[] };

export function KpiImportCard({ userId }: { userId: string | null }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [diff, setDiff] = useState<Diff | null>(null);
  const [computingDiff, setComputingDiff] = useState(false);
  const [importing, setImporting] = useState(false);

  const summary = useMemo(() => {
    if (!parsed || parsed.length === 0) return null;
    const totalCa = parsed.reduce((s, r) => s + totalCaOf(r), 0);
    return {
      jours: parsed.length,
      first: parsed[0].date,
      last: parsed[parsed.length - 1].date,
      totalCa,
    };
  }, [parsed]);

  const reset = () => {
    setParsed(null); setWarnings([]); setError(null);
    setFileName(""); setDiff(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    reset();
    setFileName(file.name);
    setParsing(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      const { rows, warnings } = parseWorkbook(wb);
      if (rows.length === 0) {
        setError("Aucune journée détectée dans ce fichier. Vérifie qu'il s'agit bien du KPI.xlsx.");
        setParsing(false);
        return;
      }
      setParsed(rows);
      setWarnings(warnings);
      // Diff vs base
      setComputingDiff(true);
      const dates = rows.map((r) => r.date);
      const { data, error: dbErr } = await (supabase as any)
        .from("salle_journees").select("*").in("date", dates);
      if (dbErr) throw dbErr;
      const existingByDate = new Map<string, any>((data ?? []).map((r: any) => [r.date, r]));
      const newDates: string[] = []; const changedDates: string[] = []; let identiques = 0;
      for (const r of rows) {
        const ex = existingByDate.get(r.date);
        if (!ex) { newDates.push(r.date); continue; }
        const keys = [
          "visiteurs", "nb_parties", "nb_cartes_vendues",
          "ca_cartes_ht", "ca_pax_ht", "ca_merch_ht",
          "ca_vending_pokemon_ht", "ca_vending_blindbox_ht", "ca_photomaton_ht",
        ] as const;
        const changed = keys.some((k) => Math.abs(Number(ex[k] ?? 0) - Number((r as any)[k] ?? 0)) > 0.005)
          || String(ex.notes ?? "") !== String(r.notes ?? "");
        if (changed) changedDates.push(r.date); else identiques++;
      }
      setDiff({ nouveaux: newDates.length, modifies: changedDates.length, identiques, newDates, changedDates });
    } catch (e: any) {
      setError(e?.message ?? "Fichier illisible");
    } finally {
      setParsing(false);
      setComputingDiff(false);
    }
  };

  const confirmImport = async () => {
    if (!parsed || parsed.length === 0) return;
    setImporting(true);
    try {
      const payloads = parsed.map((r) => ({
        date: r.date,
        visiteurs: r.visiteurs,
        nb_parties: r.nb_parties,
        nb_cartes_vendues: r.nb_cartes_vendues,
        ca_cartes_ht: r.ca_cartes_ht,
        ca_pax_ht: r.ca_pax_ht,
        ca_merch_ht: r.ca_merch_ht,
        ca_vending_pokemon_ht: r.ca_vending_pokemon_ht,
        ca_vending_blindbox_ht: r.ca_vending_blindbox_ht,
        ca_photomaton_ht: r.ca_photomaton_ht,
        notes: r.notes || null,
        saisi_par: userId,
      }));
      // upsert par lots de 200
      const chunk = 200;
      for (let i = 0; i < payloads.length; i += chunk) {
        const slice = payloads.slice(i, i + chunk);
        const { error } = await (supabase as any)
          .from("salle_journees").upsert(slice, { onConflict: "date" });
        if (error) throw error;
      }
      toast({ title: "Import terminé", description: `${parsed.length} journées importées` });
      qc.invalidateQueries({ queryKey: ["salle_dashboard"] });
      qc.invalidateQueries({ queryKey: ["salle_semaine"] });
      qc.invalidateQueries({ queryKey: ["salle_journee"] });
      reset();
    } catch (e: any) {
      toast({ title: "Erreur d'import", description: e?.message ?? "Échec", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card className="md:col-span-3 p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-3">
        <FileSpreadsheet className="h-5 w-5" style={{ color: "hsl(var(--space-salle))" }} />
        <h2 className="text-base font-semibold">Importer depuis KPI.xlsx</h2>
        <span className="text-xs text-muted-foreground ml-2">Pont de transition avec l'Excel</span>
      </div>

      {!parsed && !parsing && (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 cursor-pointer transition ${
            dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/30"
          }`}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <div className="text-sm">
            <span className="font-medium">Glisser-déposer</span> le fichier KPI.xlsx ici, ou{" "}
            <span className="underline">cliquer pour sélectionner</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Feuilles mensuelles (Mai, Juin, Juillet, …) — sections hebdomadaires S1..S99
          </div>
          <input
            ref={inputRef} type="file" accept=".xlsx,.xls" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </label>
      )}

      {parsing && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Analyse de {fileName}…
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 text-destructive flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium text-destructive">Impossible de parser le fichier</div>
            <div className="text-muted-foreground">{error}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={reset}>Réessayer</Button>
        </div>
      )}

      {parsed && summary && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className="gap-1">
              <FileSpreadsheet className="h-3 w-3" /> {fileName}
            </Badge>
            <Badge variant="secondary">{summary.jours} journées détectées</Badge>
            <Badge variant="outline">
              {new Date(summary.first).toLocaleDateString("fr-FR")} → {new Date(summary.last).toLocaleDateString("fr-FR")}
            </Badge>
            <Badge variant="outline">Total CA : {eur2(summary.totalCa)}</Badge>
          </div>

          {computingDiff && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Comparaison avec la base…
            </div>
          )}

          {diff && (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/15">
                {diff.nouveaux} nouveaux
              </Badge>
              <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/30 hover:bg-amber-500/15">
                {diff.modifies} modifiés
              </Badge>
              <Badge variant="outline">{diff.identiques} identiques</Badge>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-500 space-y-1">
              {warnings.slice(0, 5).map((w, i) => (
                <div key={i} className="flex items-start gap-1">
                  <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" /> {w}
                </div>
              ))}
              {warnings.length > 5 && <div>… et {warnings.length - 5} autres</div>}
            </div>
          )}

          <div className="max-h-64 overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Section</th>
                  <th className="text-right p-2">Visiteurs</th>
                  <th className="text-right p-2">Parties</th>
                  <th className="text-right p-2">CA HT</th>
                  <th className="text-center p-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((r) => {
                  const status = diff
                    ? diff.newDates.includes(r.date)
                      ? { label: "nouveau", cls: "text-emerald-500" }
                      : diff.changedDates.includes(r.date)
                        ? { label: "modifié", cls: "text-amber-500" }
                        : { label: "identique", cls: "text-muted-foreground" }
                    : null;
                  return (
                    <tr key={r.date} className="border-t border-border">
                      <td className="p-2 tabular-nums">{r.date}</td>
                      <td className="p-2 text-muted-foreground">{r._section} <span className="text-[10px] opacity-60">[{r._layout}]</span></td>
                      <td className="p-2 text-right tabular-nums">{r.visiteurs}</td>
                      <td className="p-2 text-right tabular-nums">{r.nb_parties}</td>
                      <td className="p-2 text-right tabular-nums">{eur2(totalCaOf(r))}</td>
                      <td className={`p-2 text-center ${status?.cls ?? ""}`}>{status?.label ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={reset} disabled={importing}>Annuler</Button>
            <Button onClick={confirmImport} disabled={importing || computingDiff}>
              {importing
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Import en cours…</>
                : <><CheckCircle2 className="mr-2 h-4 w-4" /> Confirmer l'import ({summary.jours})</>}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
