import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "nav.spaceCollapsed.v1";

type CollapsedMap = Record<string, boolean>;

function read(): CollapsedMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as CollapsedMap) : {};
  } catch {
    return {};
  }
}

function write(map: CollapsedMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * État replié/déplié des sections d'espace de la nav (sidebar + mobile).
 * - Persisté dans localStorage.
 * - Par défaut : espace courant déplié, autres repliés (au premier rendu seulement).
 * - Naviguer vers un espace le déplie automatiquement, sans toucher aux autres.
 * - L'en-tête reste toujours cliquable pour replier / déplier, même l'espace courant.
 */
export function useSpaceCollapse(spaceKeys: string[], activeSpaceKey: string | null) {
  const [collapsed, setCollapsed] = useState<CollapsedMap>(() => {
    const stored = read();
    // Initialise les clés manquantes : espace actif ouvert, autres fermés.
    let mutated = false;
    const next = { ...stored };
    for (const key of spaceKeys) {
      if (next[key] === undefined) {
        // Par défaut : espace courant déplié, tous les autres repliés
        // (y compris quand aucun n'est actif — cas du Hub).
        next[key] = activeSpaceKey ? key !== activeSpaceKey : true;
        mutated = true;
      }
    }
    if (mutated) write(next);
    return next;
  });

  // Quand l'espace actif change (navigation), on force son ouverture sans
  // rien changer aux autres.
  useEffect(() => {
    if (!activeSpaceKey) return;
    setCollapsed((prev) => {
      if (prev[activeSpaceKey] === false) return prev;
      const next = { ...prev, [activeSpaceKey]: false };
      write(next);
      return next;
    });
  }, [activeSpaceKey]);

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      write(next);
      return next;
    });
  }, []);

  const isCollapsed = useCallback((key: string) => collapsed[key] === true, [collapsed]);

  return { isCollapsed, toggle };
}
