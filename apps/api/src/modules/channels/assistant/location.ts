// Localização do dono (lógica pura + persistência no StateService): base do clima no menu.

export interface UserLocation {
  lat: number;
  lng: number;
  /** "Recife, Pernambuco" */
  name: string;
  /** pin: compartilhou a localização no WhatsApp; city: disse a cidade; default: ainda não informou */
  source: "pin" | "city" | "default";
}

// Mesma região do fuso padrão do assistente (America/Fortaleza), até o dono informar a dele
export const DEFAULT_LOCATION: UserLocation = { lat: -3.7319, lng: -38.5267, name: "Fortaleza, Ceará", source: "default" };

export const locationKey = (ws: string) => `loc:${ws}`;

interface Store {
  get<T = any>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
}

export async function loadLocation(state: Store, ws: string): Promise<UserLocation> {
  const v = await state.get<UserLocation>(locationKey(ws));
  return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && v.name ? v : DEFAULT_LOCATION;
}

export const saveLocation = (state: Store, ws: string, loc: UserLocation) => state.set(locationKey(ws), loc);

export const validCoords = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** "Recife", "Recife, PE"...: o que sobra depois do comando; vazio se não for um pedido de trocar de cidade. */
export function parseCityCommand(text: string): string | null {
  const t = text.trim().replace(/[.!?]+$/, "");
  const m =
    /^(?:mudar|atualizar|definir|trocar|alterar|configurar)\s+(?:a\s+|minha\s+)?(?:localiza[cç][aã]o|cidade)(?:\s+(?:para|pra|em|:))?\s*:?\s+(.{2,60})$/i.exec(t) ??
    /^(?:minha\s+)?(?:localiza[cç][aã]o|cidade)(?:\s+atual)?\s*(?:[ée]|eh|:)\s*(.{2,60})$/i.exec(t) ??
    /^(?:eu\s+)?(?:moro|estou\s+morando|passei\s+a\s+morar)\s+(?:em|na|no)\s+(.{2,60})$/i.exec(t) ??
    /^(?:eu\s+)?(?:mudei|me\s+mudei)\s+(?:para|pra)\s+(.{2,60})$/i.exec(t);
  const city = m?.[1]?.trim();
  return city && !/^(aqui|casa|l[aá])$/i.test(city) ? city : null;
}

/** Perguntas/atalhos que só mostram a localização atual ("minha localização", "onde estou"). */
export const isLocationQuery = (flat: string) => /^(ver |mostrar )?(minha )?(localizacao|cidade)( atual)?$|^onde (eu )?estou$/.test(flat);

/** "Como está o tempo?", "clima", "vai chover?" */
export const isWeatherQuery = (flat: string) =>
  /^(ver |mostrar )?(o )?(clima|tempo|previsao( do tempo)?)( agora| hoje| de hoje)?$|^como (esta|ta) (o )?(tempo|clima)( hoje| agora)?$|^(vai|va) chover( hoje| amanha)?$|^(esta|ta) chovendo$/.test(flat);
