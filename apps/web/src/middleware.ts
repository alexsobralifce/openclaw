import { NextRequest, NextResponse } from "next/server";

// Só o login e o cadastro são abertos. (Antes a lista tinha "/", e como toda rota começa com "/", nada era protegido.)
const isPublic = (pathname: string) => pathname === "/auth/login" || pathname === "/auth/register" || pathname.startsWith("/auth/");

// `oc_auth` é só um sinal de que há sessão (sem segredo); a sessão de verdade é um cookie HttpOnly validado pela API.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("oc_auth")?.value;

  if (!isPublic(pathname) && !token) {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }
  const res = NextResponse.next();
  // Sessão deslizante: cada visita ao painel renova o sinal (a API renova o cookie de verdade)
  if (token) res.cookies.set("oc_auth", "1", { path: "/", maxAge: 180 * 24 * 3600, sameSite: "lax" });
  return res;
}

// Só o painel passa por aqui; a landing, o login e os arquivos públicos ficam de fora.
export const config = {
  matcher: ["/dashboard/:path*"],
};
