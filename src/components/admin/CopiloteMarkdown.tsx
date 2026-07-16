import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Info, CheckCircle2, AlertTriangle, Target, ChevronRight, Database,
} from "lucide-react";

/**
 * CopiloteMarkdown — rendu enrichi partagé pour toutes les réponses du copilote.
 *  - Titres en bandeaux colorés
 *  - Tables markdown → shadcn Table (zebra, chiffres à droite)
 *  - Montants / % mis en évidence (vert/rouge si signés)
 *  - Callouts (Constat / Conclusion / Attention / Action)
 *  - SQL + "Source: ..." regroupés dans un accordéon fermé "Voir les requêtes SQL"
 *  - Paragraphes > 4 lignes tronqués avec "voir plus"
 */

type Props = { markdown: string; className?: string };

const NUMERIC_RE =
  /(-?\d{1,3}(?:[ .]\d{3})+(?:[.,]\d+)?\s?(?:€|k€|M€|%)|-?\d+(?:[.,]\d+)?\s?(?:€|k€|M€|%))/g;

function emphasizeNumbers(text: string): ReactNode {
  if (!text) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  const re = new RegExp(NUMERIC_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    const signed = /^-/.test(token.trim());
    const explicitPositive = /^\+/.test(token.trim());
    const isPct = /%/.test(token);
    // Colorize only signed numeric tokens; keep neutral for plain amounts.
    const cls = signed
      ? "font-semibold text-rose-400"
      : explicitPositive
      ? "font-semibold text-emerald-400"
      : isPct
      ? "font-semibold text-foreground"
      : "font-semibold text-foreground";
    parts.push(
      <span key={`n${i++}`} className={cls}>
        {token}
      </span>
    );
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function inlineChildren(children: ReactNode): ReactNode {
  // Walk children and enhance plain strings with numeric emphasis.
  const walk = (node: ReactNode, key: string): ReactNode => {
    if (typeof node === "string") return <span key={key}>{emphasizeNumbers(node)}</span>;
    if (Array.isArray(node)) return node.map((c, i) => walk(c, `${key}-${i}`));
    return node;
  };
  return walk(children, "r");
}

const CALLOUT_TRIGGERS: Array<{ re: RegExp; tone: "info" | "success" | "warn" | "action"; label: string }> = [
  { re: /^\s*constat\s*[:\-–]/i, tone: "info", label: "Constat" },
  { re: /^\s*(conclusion|synthèse)\s*[:\-–]/i, tone: "success", label: "Conclusion" },
  { re: /^\s*attention\s*[:\-–]/i, tone: "warn", label: "Attention" },
  { re: /^\s*action\s*[:\-–]/i, tone: "action", label: "Action" },
];

function detectCallout(text: string) {
  for (const c of CALLOUT_TRIGGERS) {
    if (c.re.test(text)) return c;
  }
  return null;
}

const calloutStyle = {
  info: { wrap: "border-sky-500/40 bg-sky-500/10", icon: Info, iconClass: "text-sky-400", label: "text-sky-300" },
  success: { wrap: "border-emerald-500/40 bg-emerald-500/10", icon: CheckCircle2, iconClass: "text-emerald-400", label: "text-emerald-300" },
  warn: { wrap: "border-amber-500/40 bg-amber-500/10", icon: AlertTriangle, iconClass: "text-amber-400", label: "text-amber-300" },
  action: { wrap: "border-primary/40 bg-primary/10", icon: Target, iconClass: "text-primary", label: "text-primary" },
} as const;

function Callout({
  tone, label, children,
}: { tone: keyof typeof calloutStyle; label: string; children: ReactNode }) {
  const s = calloutStyle[tone];
  const Icon = s.icon;
  return (
    <div className={`my-3 flex gap-2 rounded-lg border p-3 text-sm ${s.wrap}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.iconClass}`} />
      <div className="min-w-0 flex-1">
        <div className={`text-[11px] font-semibold uppercase tracking-wide ${s.label}`}>{label}</div>
        <div className="mt-0.5 text-foreground/90">{children}</div>
      </div>
    </div>
  );
}

function ExpandableParagraph({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Rough heuristic: enable clamp when paragraph is very long.
  const text = extractText(children);
  const longish = text.length > 340; // ~4 dense lines
  if (!longish) return <p className="my-2 leading-relaxed text-foreground/90">{children}</p>;
  return (
    <div className="my-2">
      <p className={`leading-relaxed text-foreground/90 ${open ? "" : "line-clamp-4"}`}>
        {children}
      </p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 text-xs font-medium text-primary hover:underline"
      >
        {open ? "Voir moins" : "Voir plus"}
      </button>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in (node as any))
    return extractText((node as any).props?.children);
  return "";
}

/**
 * Split markdown: extract SQL fenced code blocks + "Source: ..." lines and
 * return them separately so they can be shown in a collapsed accordion.
 */
function splitSources(markdown: string): { body: string; sources: string[]; sqls: string[] } {
  const sqls: string[] = [];
  const sources: string[] = [];
  // SQL fences
  let body = markdown.replace(/```(?:sql)\n([\s\S]*?)```/gi, (_m, code) => {
    sqls.push(String(code).trim());
    return "";
  });
  // Lines starting with "Source:" or "> Source:"
  body = body
    .split("\n")
    .filter((line) => {
      const trimmed = line.replace(/^>\s*/, "").trim();
      if (/^source\s*[:\-–]/i.test(trimmed)) {
        sources.push(trimmed.replace(/^source\s*[:\-–]\s*/i, ""));
        return false;
      }
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, sources, sqls };
}

export function CopiloteMarkdown({ markdown, className }: Props) {
  const { body, sources, sqls } = useMemo(() => splitSources(markdown ?? ""), [markdown]);

  const components: Components = {
    h1: ({ children }) => (
      <h2 className="mt-4 mb-2 flex items-center gap-2 rounded-md bg-primary/15 px-3 py-1.5 font-display text-base font-bold text-primary">
        <ChevronRight className="h-4 w-4" />
        {children}
      </h2>
    ),
    h2: ({ children }) => (
      <h3 className="mt-4 mb-2 flex items-center gap-2 rounded-md bg-primary/15 px-3 py-1.5 font-display text-sm font-bold text-primary">
        <ChevronRight className="h-4 w-4" />
        {children}
      </h3>
    ),
    h3: ({ children }) => (
      <h4 className="mt-3 mb-1.5 flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1 font-display text-sm font-semibold text-primary">
        <ChevronRight className="h-3.5 w-3.5" />
        {children}
      </h4>
    ),
    h4: ({ children }) => (
      <h5 className="mt-3 mb-1 font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </h5>
    ),
    p: ({ children }) => {
      const text = extractText(children);
      const callout = detectCallout(text);
      if (callout) {
        const stripped = text.replace(callout.re, "").trim();
        return <Callout tone={callout.tone} label={callout.label}>{emphasizeNumbers(stripped)}</Callout>;
      }
      return <ExpandableParagraph>{inlineChildren(children)}</ExpandableParagraph>;
    },
    strong: ({ children }) => <strong className="font-semibold text-foreground">{inlineChildren(children)}</strong>,
    em: ({ children }) => <em className="text-foreground/80">{inlineChildren(children)}</em>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm">{children}</ol>,
    li: ({ children }) => <li className="text-foreground/90">{inlineChildren(children)}</li>,
    a: ({ href, children }) => (
      <a href={href} className="font-medium text-primary hover:underline" target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-primary/50 bg-muted/30 px-3 py-1.5 text-sm italic text-foreground/80">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-border/60" />,
    code: ({ inline, className: cls, children }: any) =>
      inline ? (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
      ) : (
        <pre className="my-2 overflow-auto rounded-md border border-border/60 bg-muted/40 p-3 text-xs">
          <code className={cls}>{children}</code>
        </pre>
      ),
    table: ({ children }) => (
      <div className="my-3 overflow-hidden rounded-lg border border-border/60">
        <Table>{children}</Table>
      </div>
    ),
    thead: ({ children }) => <TableHeader className="bg-primary/15">{children}</TableHeader>,
    tbody: ({ children }) => <TableBody>{children}</TableBody>,
    tr: ({ children }) => <TableRow className="odd:bg-background/40 even:bg-muted/20">{children}</TableRow>,
    th: ({ children, style }) => {
      const align = (style as any)?.textAlign;
      return (
        <TableHead
          className={`text-xs font-semibold uppercase tracking-wide text-primary ${
            align === "right" ? "text-right" : ""
          }`}
        >
          {children}
        </TableHead>
      );
    },
    td: ({ children, style }) => {
      const text = extractText(children);
      const isNumeric = /^[\-+]?[\d.,\s]+(?:\s?(?:€|k€|M€|%))?$/.test(text.trim());
      const align = (style as any)?.textAlign;
      return (
        <TableCell
          className={`py-2 text-sm ${
            isNumeric || align === "right" ? "text-right tabular-nums" : ""
          }`}
        >
          {inlineChildren(children)}
        </TableCell>
      );
    },
  };

  return (
    <div className={className}>
      {body && (
        <div className="copilote-markdown text-sm text-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {body}
          </ReactMarkdown>
        </div>
      )}
      {(sqls.length > 0 || sources.length > 0) && (
        <Accordion type="single" collapsible className="mt-3">
          <AccordionItem value="sources" className="rounded-lg border border-border/60 bg-background/40 px-3">
            <AccordionTrigger className="py-2 text-xs">
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Database className="h-3.5 w-3.5 text-primary" />
                Voir les requêtes SQL
                <span className="text-[10px] text-muted-foreground/70">
                  ({sqls.length} requête{sqls.length > 1 ? "s" : ""}
                  {sources.length ? `, ${sources.length} source${sources.length > 1 ? "s" : ""}` : ""})
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {sqls.length > 0 && (
                <div className="space-y-2 pb-2">
                  {sqls.map((sql, i) => (
                    <pre
                      key={i}
                      className="overflow-auto rounded-md border border-border/60 bg-muted/40 p-3 font-mono text-[11px] leading-snug text-foreground/90"
                    >
                      {sql}
                    </pre>
                  ))}
                </div>
              )}
              {sources.length > 0 && (
                <ul className="mt-1 space-y-1 pb-2 text-xs text-muted-foreground">
                  {sources.map((s, i) => (
                    <li key={i}>• {s}</li>
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}

export default CopiloteMarkdown;
