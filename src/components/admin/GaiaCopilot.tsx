import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  Loader2, Sparkles, Copy, Send, FileText, UserX, Package, History, ExternalLink,
} from "lucide-react";
import { RevueDashboard, revueToText, eur, type RevueData } from "./RevueDashboard";

type DevisRelance = { n_cde: string; code_client: string; client: string; date_devis: string; age_jours: number; montant_ht: number };
type ClientDormant = { code_client: string; client: string; ca_annee_courante: number; ca_n1: number; ca_n2: number; derniere_facture: string | null };
type StockDormant = { code_article: string; description: string; famille: string; quantite: number; valeur_achat: number };
type ChatMsg = { role: "user" | "assistant"; content: string };
type SavedRevue = { id: string; titre: string | null; created_at: string };

const SUGGESTIONS = [
  "Quels clients relancer en priorité ?",
  "Pourquoi le CA baisse-t-il vs l'exercice précédent ?",
  "Que faire du stock dormant ?",
];

async function formatFunctionError(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    let body = "";
    try { body = await response.clone().text(); } catch { body = error.message; }
    return `HTTP ${response.status} ${response.statusText}\n${body}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function streamRevue(onJsonBuffer: (buf: string) => void): Promise<string> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Session expirée. Veuillez vous reconnecter.");

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gaia-copilot`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "revue" }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${body}`);
  }
  if (!response.body) throw new Error("HTTP 200 sans flux de réponse");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let jsonBuffer = "";
  let debug: { input_chars?: number; stop_reason?: string | null } | null = null;

  const consumeEvent = (event: string) => {
    const dataText = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!dataText || dataText === "[DONE]") return;
    const eventName = event
      .split(/\r?\n/)
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();

    let data: any;
    try { data = JSON.parse(dataText); } catch { return; }

    if (eventName === "gaia_debug") { debug = data; return; }
    if (eventName === "gaia_error") throw new Error(data?.error ? String(data.error) : dataText);
    if (data?.type === "error") throw new Error(`Anthropic stream error: ${JSON.stringify(data)}`);

    if (data?.type === "content_block_delta" && data?.delta?.type === "input_json_delta" && typeof data.delta.partial_json === "string") {
      jsonBuffer += data.delta.partial_json;
      onJsonBuffer(jsonBuffer);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    events.forEach(consumeEvent);
    if (done) break;
  }
  if (buffer.trim()) consumeEvent(buffer);

  if (!jsonBuffer.trim()) {
    throw new Error(`HTTP 200 mais aucune donnée structurée reçue. debug=${JSON.stringify(debug ?? { stop_reason: "inconnu" })}`);
  }
  return jsonBuffer;
}

// ─────────── Main component ───────────

export function GaiaCopilot() {
  const [revueLoading, setRevueLoading] = useState(false);
  const [revueData, setRevueData] = useState<RevueData | null>(null);
  const [revueError, setRevueError] = useState<string | null>(null);
  const [revueProgress, setRevueProgress] = useState(0);

  const [devis, setDevis] = useState<DevisRelance[]>([]);
  const [dormants, setDormants] = useState<ClientDormant[]>([]);
  const [stock, setStock] = useState<StockDormant[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);

  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      setCardsLoading(true);
      const client: any = supabase;
      const [d, dc, sd] = await Promise.all([
        client.from("v_gaia_devis_a_relancer").select("*").order("montant_ht", { ascending: false }).limit(10),
        client.from("v_gaia_clients_dormants").select("*").order("ca_n1", { ascending: false }).limit(10),
        client.from("v_gaia_stock_dormant").select("*").order("valeur_achat", { ascending: false }).limit(10),
      ]);
      setDevis((d.data as DevisRelance[]) ?? []);
      setDormants((dc.data as ClientDormant[]) ?? []);
      setStock((sd.data as StockDormant[]) ?? []);
      setCardsLoading(false);
    })();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, chatLoading]);

  const generateRevue = async () => {
    setRevueLoading(true);
    setRevueData(null);
    setRevueError(null);
    setRevueProgress(0);
    try {
      const jsonBuffer = await streamRevue((buf) => setRevueProgress(buf.length));
      const parsed = JSON.parse(jsonBuffer) as RevueData;
      setRevueData(parsed);
    } catch (e: unknown) {
      const message = await formatFunctionError(e);
      setRevueError(message);
      toast({ title: "Erreur de génération", description: message.slice(0, 200), variant: "destructive" });
    } finally {
      setRevueLoading(false);
    }
  };

  const copyRevue = async () => {
    if (!revueData) return;
    try {
      await navigator.clipboard.writeText(revueToText(revueData));
      toast({ title: "Copié", description: "La revue a été copiée dans le presse-papier." });
    } catch {
      toast({ title: "Erreur", description: "Impossible de copier.", variant: "destructive" });
    }
  };

  const sendChat = async (question: string) => {
    const q = question.trim();
    if (!q || chatLoading) return;
    const nextChat: ChatMsg[] = [...chat, { role: "user", content: q }];
    setChat(nextChat);
    setChatInput("");
    setChatLoading(true);
    try {
      const history = nextChat.slice(-13, -1);
      const { data, error } = await supabase.functions.invoke("gaia-copilot", {
        body: { action: "chat", question: q, history },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; markdown?: string; error?: string };
      if (!d?.ok || !d.markdown) throw new Error(d?.error ?? "Réponse vide");
      setChat((c) => [...c, { role: "assistant", content: d.markdown! }]);
    } catch (e: unknown) {
      const msg = await formatFunctionError(e);
      toast({ title: "Erreur", description: msg.slice(0, 200), variant: "destructive" });
      setChat((c) => [...c, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const dateShort = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");

  return (
    <div className="space-y-6">
      {/* Revue du mois */}
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-semibold">Revue commerciale du mois</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={generateRevue} disabled={revueLoading}>
              {revueLoading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Génération… (30 à 60 s)</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> Générer la revue du mois</>
              )}
            </Button>
            {revueData && (
              <Button variant="outline" onClick={copyRevue}>
                <Copy className="mr-2 h-4 w-4" /> Copier
              </Button>
            )}
          </div>
        </div>
        {revueLoading && !revueData && (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyse en cours… le modèle réfléchit avant d'écrire.
            </div>
            {revueProgress > 0 && (
              <div className="text-xs text-muted-foreground/70">
                Assemblage des données ({revueProgress} caractères reçus)…
              </div>
            )}
          </div>
        )}
        {revueData && (
          <div className="rounded border border-border/60 bg-background/40 p-4">
            <RevueDashboard data={revueData} />
          </div>
        )}
        {revueError && (
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {revueError}
          </pre>
        )}
        {!revueData && !revueLoading && !revueError && (
          <p className="text-sm text-muted-foreground">
            Le copilote analyse les vues Gaia et produit une revue chiffrée avec risques et actions prioritaires.
          </p>
        )}
      </div>

      {/* Actions rapides */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <QuickCard title="Devis à relancer" icon={<FileText className="h-4 w-4 text-primary" />} loading={cardsLoading} empty={devis.length === 0}>
          <ul className="divide-y divide-border/50">
            {devis.map((d) => (
              <li key={d.n_cde} className="flex items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.client || d.code_client}</div>
                  <div className="text-xs text-muted-foreground">Devis {d.n_cde} · {d.age_jours} j</div>
                </div>
                <div className="text-right font-medium tabular-nums">{eur(Number(d.montant_ht))}</div>
              </li>
            ))}
          </ul>
        </QuickCard>

        <QuickCard title="Clients dormants" icon={<UserX className="h-4 w-4 text-primary" />} loading={cardsLoading} empty={dormants.length === 0}>
          <ul className="divide-y divide-border/50">
            {dormants.map((c) => (
              <li key={c.code_client} className="flex items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.client || c.code_client}</div>
                  <div className="text-xs text-muted-foreground">Dernière facture : {dateShort(c.derniere_facture)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">CA N-1</div>
                  <div className="font-medium tabular-nums">{eur(Number(c.ca_n1))}</div>
                </div>
              </li>
            ))}
          </ul>
        </QuickCard>

        <QuickCard title="Stock dormant" icon={<Package className="h-4 w-4 text-primary" />} loading={cardsLoading} empty={stock.length === 0}>
          <ul className="divide-y divide-border/50">
            {stock.map((s) => (
              <li key={s.code_article} className="flex items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.description || s.code_article}</div>
                  <div className="truncate text-xs text-muted-foreground">{s.famille || "—"}</div>
                </div>
                <div className="text-right font-medium tabular-nums">{eur(Number(s.valeur_achat))}</div>
              </li>
            ))}
          </ul>
        </QuickCard>
      </div>

      {/* Chat */}
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-secondary" />
          <h3 className="font-display text-lg font-semibold">Discuter avec le copilote</h3>
        </div>

        {chat.length === 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <Button key={s} type="button" variant="outline" size="sm" onClick={() => sendChat(s)} disabled={chatLoading}>
                {s}
              </Button>
            ))}
          </div>
        )}

        <div className="max-h-[520px] space-y-3 overflow-y-auto rounded border border-border/60 bg-background/40 p-3">
          {chat.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Posez une question sur le CA, les clients, les devis ou le stock.
            </div>
          )}
          {chat.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-lg bg-primary/15 border border-primary/30 px-3 py-2 text-sm"
                    : "max-w-[95%] rounded-lg bg-muted/40 border border-border/60 px-4 py-3 text-sm"
                }
              >
                {m.role === "user" ? (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                ) : (
                  <div className="chat-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-3 w-3 animate-spin" /> Réflexion…
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => { e.preventDefault(); sendChat(chatInput); }}
        >
          <Textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendChat(chatInput);
              }
            }}
            placeholder="Votre question…"
            className="min-h-[52px] flex-1 resize-none"
            disabled={chatLoading}
          />
          <Button type="submit" disabled={chatLoading || !chatInput.trim()} className="sm:self-stretch">
            <Send className="mr-2 h-4 w-4" /> Envoyer
          </Button>
        </form>
      </div>
    </div>
  );
}

function QuickCard({
  title, icon, loading, empty, children,
}: { title: string; icon: React.ReactNode; loading: boolean; empty: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h4 className="font-display text-base font-semibold">{title}</h4>
      </div>
      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : empty ? (
        <div className="flex h-32 items-center justify-center text-center text-sm text-muted-foreground">
          Aucune donnée.
        </div>
      ) : (
        children
      )}
    </div>
  );
}
