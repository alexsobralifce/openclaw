/**
 * Sites autorizados a chamar a API pelo navegador (CORS e websocket): o endereço principal do painel (`WEB_URL`, também usado
 * nos redirecionamentos) e, opcionalmente, outros em `WEB_ORIGINS`, separados por vírgula (ex.: o endereço antigo do Railway e o www).
 */
export function webOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const clean = (u: string) => u.trim().replace(/\/+$/, "");
  const list = [env.WEB_URL || "http://localhost:3000", ...(env.WEB_ORIGINS ?? "").split(",")].map(clean).filter(Boolean);
  return [...new Set(list)];
}
