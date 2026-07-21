/**
 * Helpers de sécurité contre la troncature PostgREST (limite par défaut ~1000 lignes).
 * À utiliser dès qu'un total ou une agrégation client-side est calculé sur un select.
 */

const PAGE = 1000;

/**
 * Charge toutes les lignes d'une requête supabase-js en paginant via .range().
 * Passe une factory qui reconstruit la requête à chaque page (pour pouvoir la re-.range()).
 */
export async function fetchAllRows<T = any>(
  builder: () => any,
  label = "query",
  pageSize: number = PAGE,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // garde-fou : au-delà de 50k lignes on stoppe pour éviter un runaway
  const HARD_MAX = 50_000;
  while (from < HARD_MAX) {
    const { data, error } = await builder().range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < pageSize) return out;
    from += pageSize;
  }
  console.warn(`[supaFetch] ${label}: HARD_MAX (${HARD_MAX}) atteint, résultats potentiellement tronqués.`);
  return out;
}

/**
 * Garde-fou : signale une éventuelle troncature si un select renvoie exactement
 * la limite par défaut (1000) et qu'un total est calculé dessus.
 * À poser derrière un select qu'on ne peut pas paginer facilement.
 */
export function warnIfTruncated(rows: unknown[] | null | undefined, label: string): boolean {
  const n = rows?.length ?? 0;
  if (n === PAGE) {
    // eslint-disable-next-line no-console
    console.warn(
      `[supaFetch] ${label}: exactement ${PAGE} lignes reçues, probable troncature PostgREST. ` +
      `Utilisez fetchAllRows() ou une RPC d'agrégation SQL.`,
    );
    return true;
  }
  return false;
}
