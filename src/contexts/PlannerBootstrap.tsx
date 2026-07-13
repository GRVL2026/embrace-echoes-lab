import { createContext, useContext, type ReactNode } from "react";

/**
 * Fournit les quantités initiales à pré-remplir dans la sélection du catalogue
 * du planner lorsqu'il est ouvert depuis un dossier. Clé = shopify_id
 * (= GameEquipment.id côté planner).
 */
export type PlannerBootstrap = {
  initialQuantities: Map<string, number> | null;
};

const Ctx = createContext<PlannerBootstrap>({ initialQuantities: null });

export function PlannerBootstrapProvider({
  value,
  children,
}: {
  value: PlannerBootstrap;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlannerBootstrap(): PlannerBootstrap {
  return useContext(Ctx);
}
