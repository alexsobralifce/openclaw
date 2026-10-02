// Itens do menu principal do WhatsApp que o dono pode esconder pelo painel (lógica pura).
// Esconder só tira da lista: o comando escrito ou falado ("agenda", "drive") continua funcionando.

export interface MenuItemDef {
  id: string;
  icon: string;
  label: string;
}

/** Catálogo, na ordem em que aparecem no menu. */
export const MENU_ITEMS: MenuItemDef[] = [
  { id: "email", icon: "📧", label: "E-mails" },
  { id: "agenda", icon: "📅", label: "Google Agenda" },
  { id: "clients", icon: "💬", label: "Conversas de clientes" },
  { id: "free", icon: "🤖", label: "Perguntar à IA" },
  { id: "memory", icon: "🧠", label: "Minha memória" },
  { id: "car", icon: "🚗", label: "Modo carro" },
  { id: "drive", icon: "📁", label: "Google Drive" },
  { id: "contacts", icon: "📇", label: "Contatos" },
  { id: "routine", icon: "🗓️", label: "Minha rotina" },
  { id: "vault", icon: "🔐", label: "Cofre de senhas" },
  { id: "config", icon: "⚙️", label: "Configurações" },
];

/** Sempre aparece: sem ele o menu poderia ficar vazio e o dono perderia a porta de entrada para as configurações. */
export const ALWAYS_VISIBLE = new Set(["config"]);

export const menuHiddenKey = (ws: string) => `menuhide:${ws}`;

const KNOWN = new Set(MENU_ITEMS.map((i) => i.id));

/** Lê o valor guardado ou enviado pelo painel: só ids conhecidos e escondíveis, sem repetir. */
export function sanitizeHidden(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && KNOWN.has(x) && !ALWAYS_VISIBLE.has(x)))];
}
