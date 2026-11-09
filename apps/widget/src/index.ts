// MagoBox Widget — embeddável via <script>
// Uso: <script src="widget.js" data-workspace-id="xxx" data-api-url="https://api.seudominio.com"></script>

(function () {
  const script = document.currentScript as HTMLScriptElement;
  const workspaceId = script?.dataset.workspaceId;
  const apiUrl = script?.dataset.apiUrl || "";

  if (!workspaceId) {
    console.warn("[MagoBox] data-workspace-id ausente");
    return;
  }

  // Injeta estilos
  const style = document.createElement("style");
  style.textContent = `
    #oc-widget-btn {
      position: fixed; bottom: 24px; right: 24px;
      width: 56px; height: 56px; border-radius: 50%;
      background: #00D4C8; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,.25);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; transition: transform .2s;
    }
    #oc-widget-btn:hover { transform: scale(1.08); }
    #oc-widget-panel {
      position: fixed; bottom: 92px; right: 24px;
      width: 360px; max-height: 520px;
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,.18);
      display: flex; flex-direction: column;
      overflow: hidden; z-index: 9998;
      font-family: system-ui, sans-serif;
      transition: opacity .2s, transform .2s;
    }
    #oc-widget-panel.oc-hidden { opacity: 0; pointer-events: none; transform: translateY(8px); }
    .oc-header { background: #00D4C8; padding: 16px; color: #fff; font-weight: 600; font-size: 15px; }
    .oc-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .oc-msg { max-width: 80%; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.45; }
    .oc-msg.in { background: #f0f0f0; align-self: flex-start; border-bottom-left-radius: 4px; }
    .oc-msg.out { background: #00D4C8; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
    .oc-input-row { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #eee; }
    .oc-input-row input { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 13px; outline: none; }
    .oc-input-row button { background: #00D4C8; border: none; border-radius: 8px; padding: 0 14px; color: #fff; cursor: pointer; font-size: 18px; }
  `;
  document.head.appendChild(style);

  // Botão flutuante
  const btn = document.createElement("button");
  btn.id = "oc-widget-btn";
  btn.innerHTML = `<svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  document.body.appendChild(btn);

  // Painel
  const panel = document.createElement("div");
  panel.id = "oc-widget-panel";
  panel.classList.add("oc-hidden");
  panel.innerHTML = `
    <div class="oc-header">Precisa de ajuda?</div>
    <div class="oc-messages" id="oc-msgs">
      <div class="oc-msg in">Olá! Como posso ajudar?</div>
    </div>
    <div class="oc-input-row">
      <input id="oc-input" placeholder="Escreva uma mensagem..." />
      <button id="oc-send">➤</button>
    </div>
  `;
  document.body.appendChild(panel);

  btn.addEventListener("click", () => panel.classList.toggle("oc-hidden"));

  const msgs = document.getElementById("oc-msgs")!;
  const input = document.getElementById("oc-input") as HTMLInputElement;
  const sendBtn = document.getElementById("oc-send")!;

  function addMessage(text: string, direction: "in" | "out") {
    const div = document.createElement("div");
    div.className = `oc-msg ${direction}`;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    addMessage(text, "out");
    input.value = "";

    try {
      await fetch(`${apiUrl}/api/v1/widget/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, message: text }),
      });
    } catch (_) {}
  }

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });
})();
