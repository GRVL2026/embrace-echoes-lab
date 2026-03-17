import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles,
  Send,
  ImagePlus,
  Link2,
  X,
  Loader2,
  Wand2,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { sendCopilotMessage, createSession, type CopilotChatResponse, type PendingAssetData } from "@/lib/copilotApi";
import { QUICK_ACTIONS } from "@/types/copilot";
import type { CopilotAction, AddAssetAction } from "@/types/copilot";
import { toast } from "@/hooks/use-toast";
import { AssetPreviewPanel, type PendingAsset } from "./AssetPreviewPanel";

// ─── Types ──────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: string[];
  links?: string[];
  actions?: CopilotAction[];
  alternatives?: string[];
}

type Props = {
  onActionsReady: (actions: CopilotAction[]) => void;
  onClose: () => void;
};

// ─── Component ──────────────────────────────────────────────
export function CopilotPanel({ onActionsReady, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Create session on mount
  useEffect(() => {
    createSession().then(setSessionId).catch(console.error);
  }, []);

  const handleSend = useCallback(
    async (text?: string) => {
      const msg = text || input.trim();
      if (!msg && images.length === 0) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: msg,
        images: images.length > 0 ? [...images] : undefined,
        links: links.length > 0 ? [...links] : undefined,
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setImages([]);
      setLinks([]);
      setShowLinkInput(false);
      setIsLoading(true);

      try {
        // Build message history for the API
        const apiMessages = [...messages, userMessage].map((m) => ({
          role: m.role,
          text: m.text,
          images: m.images,
        }));

        const response: CopilotChatResponse = await sendCopilotMessage({
          messages: apiMessages,
          session_id: sessionId || undefined,
          links: userMessage.links,
        });

        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: response.text,
          actions: response.actions,
          alternatives: response.alternatives,
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Auto-apply actions
        if (response.actions && response.actions.length > 0) {
          onActionsReady(response.actions);
          toast({
            title: "Modifications appliquées",
            description: response.summary || `${response.actions.length} changement(s) appliqué(s)`,
          });
        }
      } catch (err: any) {
        toast({
          title: "Erreur",
          description: err.message || "Erreur de communication",
          variant: "destructive",
        });
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `❌ ${err.message || "Erreur de communication avec l'IA"}`,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [input, images, links, messages, sessionId, onActionsReady]
  );

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const addLink = () => {
    const url = linkInput.trim();
    if (!url) return;
    setLinks((prev) => [...prev, url]);
    setLinkInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const resetChat = () => {
    setMessages([]);
    createSession().then(setSessionId).catch(console.error);
  };

  return (
    <div className="flex flex-col h-full w-80 border-l border-border bg-card/50 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-display text-sm font-bold tracking-tight">
            <span className="text-primary">Copilot</span>{" "}
            <span className="text-secondary">IA</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetChat} title="Nouvelle conversation">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Wand2 className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Assistant d'ambiance IA</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-[220px]">
                Décrivez l'ambiance souhaitée, partagez une image ou un lien pour inspiration.
              </p>
            </div>
            {/* Quick actions */}
            <div className="flex flex-wrap gap-1.5 justify-center">
              {QUICK_ACTIONS.slice(0, 6).map((qa) => (
                <button
                  key={qa.label}
                  className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all"
                  onClick={() => handleSend(qa.prompt)}
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex flex-col gap-1",
              msg.role === "user" ? "items-end" : "items-start"
            )}
          >
            {/* User images */}
            {msg.images && msg.images.length > 0 && (
              <div className="flex gap-1 flex-wrap max-w-[260px]">
                {msg.images.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt="Upload"
                    className="h-16 w-16 rounded-md object-cover border border-border"
                  />
                ))}
              </div>
            )}

            {/* User links */}
            {msg.links && msg.links.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {msg.links.map((link, i) => (
                  <span key={i} className="text-[10px] text-primary truncate max-w-[240px]">
                    🔗 {link}
                  </span>
                ))}
              </div>
            )}

            {/* Message bubble */}
            {msg.text && (
              <div
                className={cn(
                  "rounded-xl px-3 py-2 text-xs max-w-[260px]",
                  msg.role === "user"
                    ? "bg-primary/20 text-foreground rounded-br-sm"
                    : "bg-muted/80 text-foreground rounded-bl-sm"
                )}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm prose-invert max-w-none [&_p]:text-xs [&_p]:leading-relaxed [&_p]:my-1 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:my-1 [&_ul]:text-xs [&_li]:my-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                  </div>
                ) : (
                  msg.text
                )}
              </div>
            )}

            {/* Applied actions indicator */}
            {msg.actions && msg.actions.length > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-secondary">
                <Wand2 className="h-3 w-3" />
                {msg.actions.length} modification(s) appliquée(s)
              </div>
            )}

            {/* Alternatives */}
            {msg.alternatives && msg.alternatives.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {msg.alternatives.map((alt, i) => (
                  <button
                    key={i}
                    className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all"
                    onClick={() => handleSend(alt)}
                  >
                    {alt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-start gap-2">
            <div className="rounded-xl bg-muted/80 px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attachments preview */}
      {(images.length > 0 || links.length > 0) && (
        <div className="px-3 py-1.5 border-t border-border/50 flex flex-wrap gap-1.5">
          {images.map((img, i) => (
            <div key={i} className="relative group">
              <img src={img} alt="" className="h-10 w-10 rounded object-cover border border-border" />
              <button
                className="absolute -top-1 -right-1 rounded-full bg-destructive text-destructive-foreground h-3.5 w-3.5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <X className="h-2 w-2" />
              </button>
            </div>
          ))}
          {links.map((link, i) => (
            <div key={i} className="flex items-center gap-1 bg-muted/50 rounded-full px-2 py-0.5">
              <Link2 className="h-2.5 w-2.5 text-primary" />
              <span className="text-[9px] text-muted-foreground truncate max-w-[120px]">{link}</span>
              <button onClick={() => setLinks((prev) => prev.filter((_, idx) => idx !== i))}>
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Link input */}
      {showLinkInput && (
        <div className="px-3 py-1.5 border-t border-border/50 flex gap-1.5">
          <input
            type="url"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="https://exemple.com"
            className="flex-1 bg-muted/50 rounded-md px-2 py-1 text-xs text-foreground border border-border focus:outline-none focus:ring-1 focus:ring-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
          />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={addLink}>
            Ajouter
          </Button>
        </div>
      )}

      {/* Input area */}
      <div className="px-3 py-2 border-t border-border bg-card/80">
        <div className="flex items-end gap-1.5">
          <div className="flex gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              title="Ajouter une image"
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                showLinkInput ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setShowLinkInput(!showLinkInput)}
              title="Ajouter un lien"
            >
              <Link2 className="h-4 w-4" />
            </Button>
          </div>

          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Décrivez l'ambiance..."
            className="flex-1 min-h-[36px] max-h-[100px] resize-none bg-muted/50 border-border text-xs py-2"
            rows={1}
          />

          <Button
            size="icon"
            className="h-8 w-8 bg-primary hover:bg-primary/80"
            onClick={() => handleSend()}
            disabled={isLoading || (!input.trim() && images.length === 0)}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleImageUpload}
        />
      </div>
    </div>
  );
}
