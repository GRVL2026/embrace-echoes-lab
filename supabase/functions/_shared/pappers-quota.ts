// Compteur mensuel de crédits Pappers avec plafond de sécurité.
// Le plafond est à 400 (au lieu des 500 de l'abonnement) pour garder ~20 % de marge.
// Coût pondéré : /v2/recherche = 2, tout autre endpoint = 1.

export const PAPPERS_MONTHLY_CAP = 400;

function monthKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `pappers_credits_${y}-${m}`;
}

export async function getPappersUsage(admin: any): Promise<number> {
  const { data } = await admin
    .from("gaia_config")
    .select("value")
    .eq("key", monthKey())
    .maybeSingle();
  const v = (data as any)?.value;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type QuotaResult =
  | { ok: true; used: number; cap: number }
  | { ok: false; used: number; cap: number; error: string };

/**
 * Réserve le coût de l'appel Pappers en incrémentant le compteur mensuel.
 * Refuse et renvoie ok:false si l'appel ferait dépasser le plafond.
 * À appeler AVANT chaque requête vers api.pappers.fr.
 */
export async function reservePappersCredits(
  admin: any,
  endpoint: "recherche" | "entreprise" | "autre",
): Promise<QuotaResult> {
  const cost = endpoint === "recherche" ? 2 : 1;
  const used = await getPappersUsage(admin);
  const cap = PAPPERS_MONTHLY_CAP;
  if (used + cost > cap) {
    return { ok: false, used, cap, error: "plafond Pappers mensuel atteint" };
  }
  const next = used + cost;
  await admin
    .from("gaia_config")
    .upsert({ key: monthKey(), value: String(next) }, { onConflict: "key" });
  return { ok: true, used: next, cap };
}
