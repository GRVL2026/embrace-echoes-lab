// Web Push handlers, imported into the Workbox-generated service worker.
/* global self, clients */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    try {
      payload = { title: "Notification", body: event.data ? event.data.text() : "" };
    } catch (_e) {
      payload = {};
    }
  }
  const title = payload.title || "Notification";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/pwa-192.png",
    badge: payload.badge || "/pwa-192.png",
    data: { url: payload.url || "/" },
    tag: payload.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        try {
          const u = new URL(c.url);
          if (u.origin === self.location.origin) {
            await c.focus();
            if ("navigate" in c) {
              try {
                await c.navigate(url);
              } catch (_) {
                /* ignore */
              }
            }
            return;
          }
        } catch (_) {
          /* ignore */
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
