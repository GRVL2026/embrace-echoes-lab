import { useState, useEffect, useRef, Component, type ReactNode } from "react";
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
  Search, ThumbsUp, ThumbsDown, RotateCcw,
} from "lucide-react";

import { RevueDashboard, revueToText, eur, type RevueData } from "./RevueDashboard";
import { CopilotChart, type ChartPayload } from "./CopilotChart";

type DevisRelance = { n_cde: string; code_client: string; client: string; date_devis: string; age_jours: number; montant_ht: number };
type ClientDormant = { code_client: string; client: string; ca_annee_courante: number; ca_n1: number; ca_n2: number; derniere_facture: string | null };
type StockDormant = { code_article: string; description: string; famille: string; quantite: number; valeur_achat: number };
type SavedRevue = { id: string; titre: string | null; created_at: string; statut?: string | null; erreur?: string | null };

type ChatPart =
  | { type: "text"; text: string }
  | { type: "chart"; chart: ChartPayload };

type ChatStep = { type: "sql"; summary: string; query: string };

type ChatMsg =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      parts: ChatPart[];
      steps: ChatStep[];
      streaming?: boolean;
      question?: string;
      sqlUsed?: string[];
      feedback?: 1 | -1 | null;
    };

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


type RevueStep = { summary: string; query: string };

async function streamRevue(handlers: {
  onStart?: () => void;
  onStep?: (step: RevueStep) => void;
}): Promise<RevueData> {
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
  let revueData: RevueData | null = null;
  let errorFromStream: string | null = null;

  const consumeEvent = (event: string) => {
    // Ignore heartbeats (lines starting with ':') and blank events
    const lines = event.split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith(":"));
    if (lines.length === 0) return;
    const dataText = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!dataText || dataText === "[DONE]") return;
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();

    let data: any;
    try {
      data = JSON.parse(dataText);
    } catch (err) {
      console.warn("[revue] JSON.parse failed for event", eventName, err);
      if (eventName === "gaia_revue") {
        errorFromStream = "Le JSON de la revue est incomplet ou invalide.";
      }
      return;
    }

    if (eventName === "gaia_start") { handlers.onStart?.(); return; }
    if (eventName === "gaia_sql") {
      handlers.onStep?.({ summary: String(data?.summary ?? "Requête"), query: String(data?.query ?? "") });
      return;
    }
    if (eventName === "gaia_revue") {
      revueData = data?.data as RevueData;
      return;
    }
    if (eventName === "gaia_error") {
      errorFromStream = data?.error ? String(data.error) : dataText;
      return;
    }
    // Unknown events: ignore silently.
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      events.forEach(consumeEvent);
      if (done) break;
    }
    if (buffer.trim()) consumeEvent(buffer);
  } catch (err) {
    throw new Error(
      `Flux interrompu : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (errorFromStream) throw new Error(errorFromStream);
  if (!revueData) throw new Error("Génération interrompue avant l'envoi de la revue.");
  return normalizeRevue(revueData);
}

function normalizeRevue(raw: any): RevueData {
  const r = raw && typeof raw === "object" ? raw : {};
  const sante = r.sante && typeof r.sante === "object" ? r.sante : {};
  const mouvements = r.mouvements && typeof r.mouvements === "object" ? r.mouvements : {};
  return {
    sante: {
      commentaire: typeof sante.commentaire === "string" ? sante.commentaire : "",
      annees: Array.isArray(sante.annees) ? sante.annees : [],
      tendance_mensuelle: Array.isArray(sante.tendance_mensuelle) ? sante.tendance_mensuelle : [],
    },
    mouvements: {
      familles: Array.isArray(mouvements.familles) ? mouvements.familles : [],
      clients_hausse: Array.isArray(mouvements.clients_hausse) ? mouvements.clients_hausse : [],
      clients_baisse: Array.isArray(mouvements.clients_baisse) ? mouvements.clients_baisse : [],
    },
    risques: Array.isArray(r.risques) ? r.risques : [],
    actions: Array.isArray(r.actions) ? r.actions : [],
  };
}

class RevueRenderBoundary extends Component<
  { onRetry: () => void; children: ReactNode },
  { hasError: boolean; message?: string }
> {
  state = { hasError: false, message: undefined as string | undefined };
  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }
  componentDidCatch(err: unknown) {
    console.error("[revue] render error", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-start gap-3 rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="font-semibold text-amber-300">Génération interrompue, réessayez.</div>
          <div className="text-xs text-muted-foreground">
            La revue est arrivée incomplète et n'a pas pu être affichée.
            {this.state.message ? ` (${this.state.message})` : ""}
          </div>
          <Button
            size="sm"
            onClick={() => {
              this.setState({ hasError: false, message: undefined });
              this.props.onRetry();
            }}
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" /> Réessayer
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─────────── Main component ───────────

export function GaiaCopilot() {
  const [revueLoading, setRevueLoading] = useState(false);
  const [revueData, setRevueData] = useState<RevueData | null>(null);
  const [revueError, setRevueError] = useState<string | null>(null);
  const [revueSteps, setRevueSteps] = useState<RevueStep[]>([]);

  const [devis, setDevis] = useState<DevisRelance[]>([]);
  const [dormants, setDormants] = useState<ClientDormant[]>([]);
  const [stock, setStock] = useState<StockDormant[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);

  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const assistantRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const stickToBottomRef = useRef(true);
  const [userId, setUserId] = useState<string | null>(null);
  const chatHydratedRef = useRef(false);

  const [history, setHistory] = useState<SavedRevue[]>([]);

  const storageKey = userId ? `gaia_copilot_chat:${userId}` : null;

  const loadHistory = async () => {
    const { data } = await (supabase as any)
      .from("gaia_revues")
      .select("id,titre,created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setHistory((data as SavedRevue[]) ?? []);
  };

  // Récupère l'utilisateur courant + restaure le chat depuis localStorage
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        try {
          const raw = localStorage.getItem(`gaia_copilot_chat:${uid}`);
          if (raw) {
            const parsed = JSON.parse(raw) as ChatMsg[];
            if (Array.isArray(parsed)) {
              // Nettoie les éventuels flags de streaming persistés
              const clean = parsed.map((m) =>
                m.role === "assistant" ? { ...m, streaming: false } : m,
              );
              setChat(clean);
            }
          }
        } catch { /* ignore */ }
      }
      chatHydratedRef.current = true;
    })();
  }, []);

  // Persiste le chat à chaque changement (après hydratation)
  useEffect(() => {
    if (!chatHydratedRef.current || !storageKey) return;
    try {
      // On ne persiste pas l'état "streaming"
      const toSave = chat.map((m) =>
        m.role === "assistant" ? { ...m, streaming: false } : m,
      );
      localStorage.setItem(storageKey, JSON.stringify(toSave));
    } catch { /* quota, ignore */ }
  }, [chat, storageKey]);

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
      loadHistory();
    })();
  }, []);

  // Détecte si l'utilisateur est en bas du chat pour décider du "stick to bottom"
  const handleChatScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 40;
  };

  // Pendant le streaming : ne colle au bas QUE si l'utilisateur y est déjà.
  useEffect(() => {
    if (!chatLoading) return;
    if (!stickToBottomRef.current) return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat, chatLoading]);

  // Quand une réponse se termine : scroll vers le DÉBUT de la dernière réponse assistant.
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !chatLoading) {
      // La réponse vient de se terminer
      const idxs = Object.keys(assistantRefs.current)
        .map((k) => Number(k))
        .filter((i) => chat[i]?.role === "assistant" && !(chat[i] as any).streaming);
      const lastIdx = idxs.length ? Math.max(...idxs) : -1;
      const node = lastIdx >= 0 ? assistantRefs.current[lastIdx] : null;
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
        stickToBottomRef.current = false;
      }
    }
    prevLoadingRef.current = chatLoading;
  }, [chatLoading, chat]);

  const resetConversation = () => {
    setChat([]);
    assistantRefs.current = {};
    stickToBottomRef.current = true;
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    }
  };

  const saveRevue = async (data: RevueData) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const titre = `Revue commerciale — ${new Date().toLocaleDateString("fr-FR")}`;
      const { error } = await (supabase as any).from("gaia_revues").insert({
        titre,
        data: data as any,
        created_by: userData?.user?.id ?? null,
      });
      if (error) throw error;
      await loadHistory();
    } catch (e) {
      console.error("save revue failed", e);
      toast({
        title: "Sauvegarde impossible",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const generateRevue = async () => {
    setRevueLoading(true);
    setRevueData(null);
    setRevueError(null);
    setRevueSteps([]);
    try {
      const parsed = await streamRevue({
        onStart: () => setRevueSteps([]),
        onStep: (step) => setRevueSteps((prev) => [...prev, step]),
      });
      setRevueData(parsed);
      await saveRevue(parsed);
      toast({ title: "Revue enregistrée", description: "Consultable dans l'historique." });
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

  const appendText = (msgIdx: number, text: string) => {
    setChat((c) => {
      const next = c.slice();
      const m = next[msgIdx];
      if (!m || m.role !== "assistant") return c;
      const parts = m.parts.slice();
      const last = parts[parts.length - 1];
      if (last && last.type === "text") {
        parts[parts.length - 1] = { type: "text", text: last.text + text };
      } else {
        parts.push({ type: "text", text });
      }
      next[msgIdx] = { ...m, parts };
      return next;
    });
  };

  const appendChart = (msgIdx: number, chart: ChartPayload) => {
    setChat((c) => {
      const next = c.slice();
      const m = next[msgIdx];
      if (!m || m.role !== "assistant") return c;
      next[msgIdx] = { ...m, parts: [...m.parts, { type: "chart", chart }] };
      return next;
    });
  };

  const appendStep = (msgIdx: number, step: ChatStep) => {
    setChat((c) => {
      const next = c.slice();
      const m = next[msgIdx];
      if (!m || m.role !== "assistant") return c;
      next[msgIdx] = { ...m, steps: [...m.steps, step] };
      return next;
    });
  };

  const finalizeAssistant = (
    msgIdx: number,
    markdown: string,
    sqlUsed: string[],
  ) => {
    setChat((c) => {
      const next = c.slice();
      const m = next[msgIdx];
      if (!m || m.role !== "assistant") return c;
      next[msgIdx] = {
        ...m,
        streaming: false,
        parts: [...m.parts, { type: "text", text: markdown }],
        sqlUsed,
      };
      return next;
    });
  };

  const sendChat = async (question: string) => {
    const q = question.trim();
    if (!q || chatLoading) return;

    // 1. Ajout du message utilisateur + placeholder assistant
    let assistantIdx = -1;
    setChat((c) => {
      const next: ChatMsg[] = [
        ...c,
        { role: "user", content: q },
        { role: "assistant", parts: [], steps: [], streaming: true, question: q },
      ];
      assistantIdx = next.length - 1;
      return next;
    });
    setChatInput("");
    setChatLoading(true);
    stickToBottomRef.current = true;

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Session expirée. Veuillez vous reconnecter.");

      // Historique = tout ce qui précède le placeholder assistant, sous forme string
      const historyMsgs = chat.slice(-12).flatMap((m): { role: "user" | "assistant"; content: string }[] => {
        if (m.role === "user") return [{ role: "user", content: m.content }];
        const text = m.parts.filter((p) => p.type === "text").map((p: any) => p.text).join("\n\n");
        return text ? [{ role: "assistant", content: text }] : [];
      });

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gaia-copilot`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "chat", question: q, history: historyMsgs }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`HTTP ${resp.status} ${resp.statusText}\n${body}`);
      }
      if (!resp.body) throw new Error("HTTP 200 sans flux de réponse");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalMarkdown = "";
      let sqlUsed: string[] = [];
      let errorFromStream: string | null = null;

      const consume = (event: string) => {
        const dataText = event
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        const evtName = event.split(/\r?\n/).find((l) => l.startsWith("event:"))?.slice(6).trim();
        if (!dataText) return;
        let data: any;
        try { data = JSON.parse(dataText); } catch { return; }
        if (evtName === "gaia_sql") {
          appendStep(assistantIdx, { type: "sql", summary: data.summary ?? "Requête", query: data.query ?? "" });
        } else if (evtName === "gaia_chart") {
          appendChart(assistantIdx, data as ChartPayload);
        } else if (evtName === "gaia_final") {
          finalMarkdown = data.markdown ?? "";
          sqlUsed = Array.isArray(data.sql_used) ? data.sql_used : [];
        } else if (evtName === "gaia_error") {
          errorFromStream = data.error ?? "Erreur inconnue";
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        events.forEach(consume);
        if (done) break;
      }
      if (buffer.trim()) consume(buffer);

      if (errorFromStream) throw new Error(errorFromStream);
      if (!finalMarkdown) throw new Error("Réponse vide");
      finalizeAssistant(assistantIdx, finalMarkdown, sqlUsed);
    } catch (e: unknown) {
      const msg = await formatFunctionError(e);
      toast({ title: "Erreur", description: msg.slice(0, 200), variant: "destructive" });
      setChat((c) => {
        const next = c.slice();
        const m = next[assistantIdx];
        if (m && m.role === "assistant") {
          next[assistantIdx] = {
            ...m,
            streaming: false,
            parts: [{ type: "text", text: `⚠️ ${msg}` }],
          };
        }
        return next;
      });
    } finally {
      setChatLoading(false);
    }
  };

  const submitFeedback = async (msgIdx: number, note: 1 | -1, commentaire?: string) => {
    const m = chat[msgIdx];
    if (!m || m.role !== "assistant") return;
    const answerText = m.parts.filter((p) => p.type === "text").map((p: any) => p.text).join("\n\n");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) throw new Error("Session invalide");
      const { error } = await (supabase as any).from("copilote_feedback").insert({
        user_id: userId,
        question: m.question ?? "",
        reponse: answerText,
        requetes_sql: m.sqlUsed ?? [],
        note,
        commentaire: commentaire ?? null,
      });
      if (error) throw error;
      setChat((c) => {
        const next = c.slice();
        const cur = next[msgIdx];
        if (cur && cur.role === "assistant") next[msgIdx] = { ...cur, feedback: note };
        return next;
      });
      toast({ title: "Merci !", description: "Feedback enregistré." });
    } catch (e) {
      toast({
        title: "Feedback impossible",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const dateShort = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");

  return (
    <div className="space-y-6">
      {/* 1. Chat — priorité visuelle */}
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-secondary" />
            <h3 className="font-display text-lg font-semibold">Discuter avec le copilote</h3>
          </div>
          {chat.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetConversation}
              disabled={chatLoading}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Nouvelle conversation
            </Button>
          )}
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

        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          className="max-h-[620px] space-y-3 overflow-y-auto rounded border border-border/60 bg-background/40 p-3"
        >
          {chat.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Posez une question sur le CA, les clients, les devis ou le stock.
            </div>
          )}
          {chat.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-primary/15 border border-primary/30 px-3 py-2 text-sm">
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              </div>
            ) : (
              <div
                key={i}
                ref={(el) => { assistantRefs.current[i] = el; }}
                className="flex justify-start scroll-mt-2"
              >
                <div className="w-full max-w-[95%] rounded-lg bg-muted/40 border border-border/60 px-4 py-3 text-sm">
                  {/* Étapes de progression (grisé, petit) */}
                  {m.steps.length > 0 && (
                    <ul className="mb-2 space-y-0.5 text-[11px] text-muted-foreground">
                      {m.steps.map((s, j) => (
                        <li key={j} title={s.query} className="flex items-center gap-1.5">
                          <Search className="h-3 w-3 shrink-0 opacity-70" />
                          <span className="truncate">Requête : {s.summary}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Blocs de réponse : texte / graphique dans l'ordre */}
                  {m.parts.map((part, j) =>
                    part.type === "text" ? (
                      <div key={j} className="chat-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                      </div>
                    ) : (
                      <CopilotChart key={j} payload={part.chart} />
                    )
                  )}

                  {m.streaming && m.parts.length === 0 && (
                    <div className="text-muted-foreground">
                      <Loader2 className="mr-2 inline h-3 w-3 animate-spin" /> Réflexion…
                    </div>
                  )}

                  {/* Feedback 👍 / 👎 */}
                  {!m.streaming && m.parts.some((p) => p.type === "text") && (
                    <FeedbackControls
                      current={m.feedback ?? null}
                      onSubmit={(note, commentaire) => submitFeedback(i, note, commentaire)}
                    />
                  )}
                </div>
              </div>
            )
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
          <div className="flex flex-col gap-2 rounded border border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyse en cours… le modèle interroge les données puis rédige la revue.
            </div>
            {revueSteps.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground/80">
                {revueSteps.map((s, j) => (
                  <li key={j} title={s.query} className="flex items-center gap-1.5">
                    <Search className="h-3 w-3 shrink-0 opacity-70" />
                    <span className="truncate">Requête : {s.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {revueData && (
          <div className="rounded border border-border/60 bg-background/40 p-4">
            <RevueRenderBoundary onRetry={generateRevue}>
              <RevueDashboard data={revueData} />
            </RevueRenderBoundary>
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

      {/* 3. Actions rapides */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <QuickCard title="Devis à relancer" icon={<FileText className="h-4 w-4 text-primary" />} loading={cardsLoading} empty={devis.length === 0}>
          <ul className="divide-y divide-border/50">
            {devis.map((d) => (
              <li key={d.n_cde} className="flex items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/admin/gaia/client/${encodeURIComponent(d.client || d.code_client)}`}
                    className="block truncate font-medium hover:text-primary hover:underline"
                  >
                    {d.client || d.code_client}
                  </Link>
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
                  <Link
                    to={`/admin/gaia/client/${encodeURIComponent(c.client || c.code_client)}`}
                    className="block truncate font-medium hover:text-primary hover:underline"
                  >
                    {c.client || c.code_client}
                  </Link>
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

      {/* 4. Historique des revues */}
      {history.length > 0 && (
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h3 className="font-display text-lg font-semibold">Historique des revues</h3>
            <span className="text-xs text-muted-foreground">({history.length})</span>
          </div>
          <ul className="divide-y divide-border/50">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{h.titre ?? "Revue"}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(h.created_at).toLocaleString("fr-FR")}
                  </div>
                </div>
                <Link
                  to={`/admin/gaia/revue/${h.id}`}
                  className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-xs hover:bg-muted/40"
                >
                  Ouvrir <ExternalLink className="h-3 w-3" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
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

function FeedbackControls({
  current,
  onSubmit,
}: {
  current: 1 | -1 | null;
  onSubmit: (note: 1 | -1, commentaire?: string) => void;
}) {
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");

  if (current === 1) {
    return (
      <div className="mt-3 flex items-center gap-1 border-t border-border/40 pt-2 text-xs text-muted-foreground">
        <ThumbsUp className="h-3 w-3 text-primary" /> Merci pour votre retour.
      </div>
    );
  }
  if (current === -1) {
    return (
      <div className="mt-3 flex items-center gap-1 border-t border-border/40 pt-2 text-xs text-muted-foreground">
        <ThumbsDown className="h-3 w-3 text-destructive" /> Retour enregistré.
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border/40 pt-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Cette réponse est-elle utile&nbsp;?</span>
        <button
          type="button"
          onClick={() => onSubmit(1)}
          className="rounded p-1 hover:bg-primary/10 hover:text-primary"
          aria-label="Utile"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setShowComment(true)}
          className="rounded p-1 hover:bg-destructive/10 hover:text-destructive"
          aria-label="Pas utile"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {showComment && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Qu'est-ce qui n'allait pas ?"
            className="min-h-[52px] flex-1 resize-none text-xs"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowComment(false)}
            >
              Annuler
            </Button>
            <Button size="sm" onClick={() => onSubmit(-1, comment.trim() || undefined)}>
              Envoyer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

