import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

/**
 * Contexte d'entité "métier" que la page courante décrit au copilote
 * (ex: { kind: 'client', label: 'DUPONT MACHINE', id: '...', extra: {...} }).
 * Les composants pages appellent useRegisterCopilotEntity(...) pour signaler
 * ce que l'utilisateur regarde ; le copilote peut alors comprendre les
 * questions elliptiques ("pourquoi il baisse ?").
 */
export type CopilotEntity = {
  kind: string;           // 'client' | 'ticket_sav' | 'document_carnet' | 'categorie_carnet' | 'dossier' | ...
  label: string;          // libellé lisible (nom du client, référence document, etc.)
  id?: string | null;     // identifiant technique éventuel
  extra?: Record<string, unknown>;
};

export type CopilotPageContext = {
  route: string;              // pathname courant
  title?: string | null;      // libellé humain de la page (ex: "Fiche client", "Dashboard AA")
  entity?: CopilotEntity | null;
};

type OpenOptions = {
  prefill?: string;
  entity?: CopilotEntity | null;
  title?: string | null;
};

type Ctx = {
  open: (opts?: OpenOptions) => void;
  close: () => void;
  isOpen: boolean;
  prefill: string | null;
  consumePrefill: () => string | null;
  pageContext: CopilotPageContext;
  /** Enregistre le contexte "entité" courant. Retourne une fonction de nettoyage. */
  registerEntity: (entity: CopilotEntity | null, title?: string | null) => () => void;
};

const CopilotContext = createContext<Ctx | null>(null);

const HUMAN_TITLES: Record<string, string> = {
  "/": "Hub",
  "/dossiers": "Dossiers commerciaux",
  "/catalogue": "Catalogue",
  "/planner": "Space Planner",
  "/logistique": "Logistique",
  "/ecommerce": "E-commerce",
  "/sav": "SAV",
  "/admin": "Administration dossiers",
  "/admin/gaia": "Dashboard",
  "/admin/veille": "Veille marché",
  "/admin/catalog-erp": "Catalogue ERP",
};

function humanTitleFor(pathname: string): string {
  if (HUMAN_TITLES[pathname]) return HUMAN_TITLES[pathname];
  if (pathname.startsWith("/admin/gaia/carnet/")) return "Carnet commercial";
  if (pathname.startsWith("/admin/gaia/client/")) return "Fiche client";
  if (pathname.startsWith("/admin/gaia/revue/")) return "Revue commerciale";
  if (pathname.startsWith("/dossiers/")) return "Dossier commercial";
  if (pathname.startsWith("/sav/ticket/")) return "Ticket SAV";
  if (pathname.startsWith("/planner")) return "Space Planner";
  return "Application";
}

export function CopilotProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [isOpen, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [entityState, setEntityState] = useState<CopilotEntity | null>(null);
  const [pageTitleOverride, setPageTitleOverride] = useState<string | null>(null);
  const entityCounterRef = useRef(0);

  // Reset entity when the route changes — chaque page réenregistre la sienne.
  useEffect(() => {
    setEntityState(null);
    setPageTitleOverride(null);
  }, [location.pathname]);

  const open = useCallback((opts?: OpenOptions) => {
    if (opts?.prefill) setPrefill(opts.prefill);
    if (opts?.entity !== undefined) setEntityState(opts.entity);
    if (opts?.title !== undefined) setPageTitleOverride(opts.title ?? null);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const consumePrefill = useCallback(() => {
    const p = prefill;
    setPrefill(null);
    return p;
  }, [prefill]);

  const registerEntity = useCallback((entity: CopilotEntity | null, title?: string | null) => {
    entityCounterRef.current += 1;
    const myTicket = entityCounterRef.current;
    setEntityState(entity);
    if (title !== undefined) setPageTitleOverride(title ?? null);
    return () => {
      // Only clear if we're still the last registrant.
      if (entityCounterRef.current === myTicket) {
        setEntityState(null);
        if (title !== undefined) setPageTitleOverride(null);
      }
    };
  }, []);

  const pageContext = useMemo<CopilotPageContext>(() => ({
    route: location.pathname,
    title: pageTitleOverride ?? humanTitleFor(location.pathname),
    entity: entityState,
  }), [location.pathname, pageTitleOverride, entityState]);

  const value = useMemo<Ctx>(() => ({
    open, close, isOpen, prefill, consumePrefill, pageContext, registerEntity,
  }), [open, close, isOpen, prefill, consumePrefill, pageContext, registerEntity]);

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}

export function useCopilot() {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error("useCopilot must be used within CopilotProvider");
  return ctx;
}

/**
 * Hook à appeler dans une page/composant pour déclarer l'entité que
 * l'utilisateur regarde. Le copilote l'injecte dans son prompt.
 */
export function useRegisterCopilotEntity(entity: CopilotEntity | null, title?: string | null) {
  const { registerEntity } = useCopilot();
  const key = entity ? `${entity.kind}::${entity.id ?? ""}::${entity.label}` : null;
  useEffect(() => {
    return registerEntity(entity, title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, title]);
}
