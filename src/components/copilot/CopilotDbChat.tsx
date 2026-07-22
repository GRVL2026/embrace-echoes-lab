import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  MessageSquarePlus,
  Search,
  Send,
  ChevronLeft,
  ChevronRight,
  Trash2,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCopilot } from "@/contexts/CopilotContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CopiloteMarkdown } from "@/components/admin/CopiloteMarkdown";

type Conversation = {
  id: string;
  titre: string | null;
  updated_at: string;
  created_at: string;
};

type Step = { summary: string; query: string };
type Msg =
  | { role: "user"; content: string; id?: string }
  | {
      role: "assistant";
      content: string;
      id?: string;
      steps: Step[];
      status?: "generating" | "done" | "error";
      overloaded?: boolean;
      question?: string;
    };

/**
 * Chat DB-backed : liste des conversations à gauche/en tête, chat à droite.
 * La génération est côté serveur (edge function gaia-copilot) et persiste le
 * message assistant en base via EdgeRuntime.waitUntil. Le client s'abonne en
 * temps réel à copilot_messages pour afficher la réponse même si l'utilisateur
 * a quitté la conversation pendant la réflexion.
 */
export function CopilotDbChat() {
  const { pageContext } = useCopilot();

  const [userId, setUserId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "chat">("list");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data?.user?.id ?? null);
    })();
  }, []);

  const loadConversations = useCallback(async () => {
    setConvLoading(true);
    const { data } = await (supabase as any)
      .from("copilot_conversations")
      .select("id,titre,updated_at,created_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    setConversations((data as Conversation[]) ?? []);
    setConvLoading(false);
  }, []);

  useEffect(() => {
    if (userId) loadConversations();
  }, [userId, loadConversations]);

  const rowToMsg = useCallback((r: any): Msg => {
    if (r.role === "user") {
      return { role: "user", content: r.contenu, id: r.id };
    }
    return {
      role: "assistant",
      content: r.contenu,
      steps: Array.isArray(r.steps) ? r.steps : [],
      id: r.id,
      status: (r.status as any) ?? "done",
    };
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setView("chat");
    setMsgsLoading(true);
    const { data } = await (supabase as any)
      .from("copilot_messages")
      .select("id,role,contenu,steps,status,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as any[];
    setMessages(rows.map(rowToMsg));
    setMsgsLoading(false);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "auto", block: "end" }), 50);
  }, [rowToMsg]);

  const newConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setInput("");
    setView("chat");
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      const { error } = await (supabase as any)
        .from("copilot_conversations")
        .delete()
        .eq("id", id);
      if (error) {
        toast({ title: "Suppression impossible", description: error.message, variant: "destructive" });
        return;
      }
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
        setView("list");
      }
      await loadConversations();
    },
    [activeId, loadConversations],
  );

  useEffect(() => {
    if (!sending) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  // ————————————— Realtime : abonnement aux messages de la conversation active
  // Ainsi, si l'utilisateur quitte pendant la réflexion, la réponse persistée
  // côté serveur remonte automatiquement à son retour (et en direct s'il regarde).
  useEffect(() => {
    if (!activeId) return;
    const channel = supabase
      .channel(`copilot_messages:${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "copilot_messages",
          filter: `conversation_id=eq.${activeId}`,
        },
        (payload: any) => {
          const row = (payload.new ?? payload.old) as any;
          if (!row) return;
          setMessages((cur) => {
            const idx = cur.findIndex((m) => m.id === row.id);
            if (payload.eventType === "DELETE") {
              if (idx === -1) return cur;
              const next = cur.slice();
              next.splice(idx, 1);
              return next;
            }
            const msg = rowToMsg(row);
            if (idx === -1) {
              // Nouveau message venant du serveur (user posté à la volée, ou
              // assistant placeholder). Ajoute-le si pas déjà présent.
              return [...cur, msg];
            }
            const next = cur.slice();
            next[idx] = msg;
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeId, rowToMsg]);

  const sendMessage = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || sending || !userId) return;

      let convId = activeId;
      // Crée la conversation à la volée
      if (!convId) {
        const titre = q.slice(0, 60);
        const { data, error } = await (supabase as any)
          .from("copilot_conversations")
          .insert({ user_id: userId, titre })
          .select("id")
          .single();
        if (error || !data) {
          toast({ title: "Erreur", description: error?.message ?? "Création conversation impossible", variant: "destructive" });
          return;
        }
        convId = data.id as string;
        setActiveId(convId);
      }

      // Optimiste : ajoute la bulle user + un placeholder assistant "réflexion".
      // Les IDs réels seront réconciliés par le realtime dès que le serveur
      // aura inséré ses lignes en base.
      const prevMessages = messages;
      let placeholderIdx = -1;
      setMessages((c) => {
        const next: Msg[] = [
          ...c,
          { role: "user", content: q },
          { role: "assistant", content: "", steps: [], status: "generating", question: q },
        ];
        placeholderIdx = next.length - 1;
        return next;
      });
      setInput("");
      setSending(true);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Session expirée. Reconnectez-vous.");

        const history = prevMessages.slice(-12).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gaia-copilot`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "chat",
            question: q,
            conversation_id: convId,
            history,
            context: {
              route: pageContext.route,
              page_title: pageContext.title,
              entity: pageContext.entity,
            },
          }),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}\n${await resp.text()}`);
        if (!resp.body) throw new Error("Flux vide");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let errStream: string | null = null;
        let errCode: string | null = null;

        const consume = (evt: string) => {
          const dataText = evt
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          const name = evt.split(/\r?\n/).find((l) => l.startsWith("event:"))?.slice(6).trim();
          if (!dataText) return;
          let data: any;
          try { data = JSON.parse(dataText); } catch { return; }
          if (name === "gaia_sql") {
            const step: Step = { summary: String(data.summary ?? "Requête"), query: String(data.query ?? "") };
            // Applique visuellement l'étape SQL sur le placeholder si encore présent
            setMessages((c) => {
              const next = c.slice();
              // On repère le dernier assistant en cours de génération
              for (let i = next.length - 1; i >= 0; i--) {
                const m = next[i];
                if (m.role === "assistant" && (m.status === "generating" || m.status === undefined) && !m.content) {
                  next[i] = { ...m, steps: [...m.steps, step] };
                  break;
                }
              }
              return next;
            });
          } else if (name === "gaia_error") {
            errStream = data.error ?? "Erreur";
            errCode = typeof data.code === "string" ? data.code : null;
          }
          // gaia_final : la persistance serveur + le realtime feront l'update.
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

        if (errStream) {
          const isOverload = errCode === "overload" || /overloaded|529|saturés/i.test(errStream);
          if (!isOverload) toast({ title: "Erreur", description: errStream.slice(0, 200), variant: "destructive" });
        }
        loadConversations();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Erreur RÉSEAU côté client. Le serveur peut avoir persisté quand même
        // (waitUntil) : le realtime remontera la vraie réponse. En attendant,
        // ne casse pas la bulle placeholder si un contenu réel est déjà arrivé.
        toast({ title: "Connexion interrompue", description: msg.slice(0, 200), variant: "destructive" });
      } finally {
        setSending(false);
        // Rafraîchit l'état depuis la base : réconcilie les IDs et statuts,
        // au cas où le realtime aurait manqué un événement.
        if (convId) {
          try {
            const { data } = await (supabase as any)
              .from("copilot_messages")
              .select("id,role,contenu,steps,status,created_at")
              .eq("conversation_id", convId)
              .order("created_at", { ascending: true });
            const rows = (data ?? []) as any[];
            setMessages(rows.map(rowToMsg));
          } catch { /* silencieux */ }
        }
      }
    },
    [sending, userId, activeId, messages, pageContext, loadConversations, rowToMsg],
  );

  // ————————————————————————————— vue liste
  const grouped = useMemo(() => groupByRecency(conversations, search), [conversations, search]);

  if (view === "list") {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="p-3 border-b border-border flex gap-2 items-center shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Button size="sm" onClick={newConversation}>
            <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" /> Nouvelle
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {convLoading && (
            <div className="flex justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {!convLoading && conversations.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground px-4">
              Aucune conversation encore. Cliquez sur « Nouvelle » pour commencer.
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {group.label}
              </div>
              {group.items.map((c) => (
                <div key={c.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openConversation(c.id)}
                    className="flex-1 text-left px-2 py-2 rounded hover:bg-muted/50 transition-colors min-w-0"
                  >
                    <div className="text-sm truncate">{c.titre || "Sans titre"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(c.updated_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm("Supprimer cette conversation ?")) deleteConversation(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-destructive/20 hover:text-destructive transition-opacity"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ————————————————————————————— vue chat
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2 border-b border-border flex gap-2 items-center shrink-0">
        <Button size="sm" variant="ghost" onClick={() => setView("list")} className="text-xs">
          <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Conversations
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={newConversation} className="text-xs">
          <MessageSquarePlus className="mr-1 h-3.5 w-3.5" /> Nouvelle
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {msgsLoading && (
          <div className="flex justify-center py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {!msgsLoading && messages.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Posez votre question au copilote.
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={m.id ?? `u-${i}`} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-primary/15 border border-primary/30 px-3 py-2 text-sm whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            );
          }
          const isGenerating = m.status === "generating";
          const isError = m.status === "error";
          const isOverloaded = m.overloaded || (isError && /saturés|overloaded/i.test(m.content));
          return (
            <div key={m.id ?? `a-${i}`} className="flex justify-start">
              <div
                className={cn(
                  "w-full max-w-[95%] rounded-lg border px-4 py-3 text-sm",
                  isOverloaded
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                    : isError
                      ? "border-destructive/40 bg-destructive/10"
                      : "border-border/60 bg-muted/40",
                )}
              >
                {isOverloaded && (
                  <div className="flex items-start gap-2 mb-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div className="font-medium">Serveurs d'IA saturés</div>
                  </div>
                )}
                {m.steps.length > 0 && <StepsCollapse steps={m.steps} streaming={isGenerating} />}
                {m.content && <CopiloteMarkdown markdown={m.content} />}
                {isGenerating && !m.content && (
                  <div className="text-muted-foreground text-xs">
                    <Loader2 className="mr-2 inline h-3 w-3 animate-spin" /> Réflexion en cours…
                  </div>
                )}
                {isOverloaded && m.question && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                      onClick={() => sendMessage(m.question!)}
                    >
                      <RotateCcw className="mr-2 h-3 w-3" /> Réessayer
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form
        className="p-3 border-t border-border flex gap-2 items-end shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage(input);
            }
          }}
          placeholder="Votre question…"
          className="min-h-[52px] flex-1 resize-none text-sm"
          disabled={sending}
        />
        <Button type="submit" disabled={sending || !input.trim()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}

function StepsCollapse({ steps, streaming }: { steps: Step[]; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const open = streaming || expanded;
  if (streaming) {
    return (
      <ul className="mb-2 space-y-0.5 text-[11px] text-muted-foreground">
        {steps.map((s, j) => (
          <li key={j} title={s.query} className="flex items-center gap-1.5">
            <Search className="h-3 w-3 shrink-0 opacity-70" />
            <span className="truncate">Requête : {s.summary}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        <Search className="h-3 w-3 opacity-70" />
        <span>
          {steps.length} requête{steps.length > 1 ? "s" : ""} exécutée{steps.length > 1 ? "s" : ""}
        </span>
      </button>
      {open && (
        <ul className="mt-1 ml-4 space-y-0.5 text-[11px] text-muted-foreground">
          {steps.map((s, j) => (
            <li key={j} title={s.query} className="truncate">· {s.summary}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function groupByRecency(list: Conversation[], search: string) {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? list.filter((c) => (c.titre ?? "").toLowerCase().includes(q))
    : list;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const week = startToday - 6 * 86400 * 1000;
  const groups: Record<string, Conversation[]> = {
    "Aujourd'hui": [],
    "Cette semaine": [],
    "Plus ancien": [],
  };
  for (const c of filtered) {
    const t = new Date(c.updated_at).getTime();
    if (t >= startToday) groups["Aujourd'hui"].push(c);
    else if (t >= week) groups["Cette semaine"].push(c);
    else groups["Plus ancien"].push(c);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}
