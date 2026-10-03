// Service worker do MagoBox: só recebe notificações push do assistente.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "MagoBox", { body: data.body || "", icon: "/icons/icon-192.png", data: { url: data.url || "/dashboard/chat" } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard/chat";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
      return clients.openWindow(url);
    }),
  );
});
