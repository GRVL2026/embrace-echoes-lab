import { supabase } from "@/integrations/supabase/client";

let cachedVapidKey: string | null = null;

async function getVapidPublicKey(): Promise<string> {
  if (cachedVapidKey) return cachedVapidKey;
  const { data, error } = await supabase.functions.invoke<{ publicKey: string }>(
    "send-push",
    { method: "GET" },
  );
  if (error || !data?.publicKey) {
    throw new Error("Clé VAPID publique indisponible.");
  }
  cachedVapidKey = data.publicKey;
  return cachedVapidKey;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ?? (await navigator.serviceWorker.ready.catch(() => null));
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { ok: false, error: "Notifications non supportées sur cet appareil." };
  }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, error: "Connecte-toi pour activer les notifications." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      error:
        permission === "denied"
          ? "Permission refusée. Autorise les notifications dans les réglages du navigateur."
          : "Permission non accordée.",
    };
  }

  const reg = await getRegistration();
  if (!reg) return { ok: false, error: "Service worker indisponible (publie l'app pour activer)." };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      const vapidKey = await getVapidPublicKey();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });
    } catch (e) {
      return { ok: false, error: (e as Error).message || "Souscription impossible." };
    }
  }

  const p256dh = bufToBase64(sub.getKey("p256dh"));
  const auth = bufToBase64(sub.getKey("auth"));

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userData.user.id,
      endpoint: sub.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function disablePush(): Promise<{ ok: boolean; error?: string }> {
  const sub = await getCurrentSubscription();
  if (sub) {
    try {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    } catch (_) {
      /* ignore */
    }
    try {
      await sub.unsubscribe();
    } catch (_) {
      /* ignore */
    }
  }
  return { ok: true };
}
