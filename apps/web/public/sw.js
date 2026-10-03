// Service worker do MagoBox: notificações push do assistente e página offline simples (necessário para instalar o app).
const OFFLINE_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MagoBox</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030712;color:#e5e7eb;font-family:system-ui,sans-serif;text-align:center;padding:24px}button{margin-top:16px;background:#8b5cf6;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px}</style></head><body><div><h1 style="font-size:20px">Sem conexão</h1><p style="color:#9ca3af">O MagoBox precisa de internet. Confira sua conexão e tente de novo.</p><button onclick="location.reload()">Tentar de novo</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Só as páginas têm plano B offline; API e arquivos vão direto à rede (nada de dado do usuário fica em cache)
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "MagoBox", { body: data.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: data.url || "/dashboard/chat" } }));
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
