# Domínio magobox.com.br (Registro.br → Railway)

Registrado em 03/10/2026, vence em 03/10/2027. DNS no padrão do Registro.br (`a.auto.dns.br`, `b.auto.dns.br`).

## 1. Registros DNS (painel do Registro.br → DNS → Editar zona)

| Tipo  | Nome                  | Valor                                                                              | Serviço |
|-------|-----------------------|------------------------------------------------------------------------------------|---------|
| CNAME | `@` (raiz)            | `oom5lfhk.up.railway.app`                                                          | web     |
| TXT   | `_railway-verify`     | `railway-verify=0c7a002fadb44d2b504cae7b5a5f66f41ed724d8adbd699a5dccc303e6a91e21`  | web     |
| CNAME | `www`                 | `fpxtgxx3.up.railway.app`                                                          | web     |
| TXT   | `_railway-verify.www` | `railway-verify=eef047397493f41133d5330c2ec36a36c1e39d8869f37ef03b15b514efd818c0`  | web     |
| CNAME | `api`                 | `rl8xbyhs.up.railway.app`                                                          | api     |
| TXT   | `_railway-verify.api` | `railway-verify=51dd0feb921c2fa6e70304578376fc82b1d3eb9a72e2aaf2645cd0927229f516`  | api     |

CNAME na raiz (`@`): o Registro.br pode recusar, pois a raiz já tem registros SOA/NS. Se recusar, use ALIAS/ANAME se o painel
oferecer; senão, publique o painel em `app.magobox.com.br` (CNAME `app` → mesmo valor da raiz) e redirecione a raiz para ele.

Conferir: `railway domain status <id>` ou `dig +short CNAME api.magobox.com.br`.

## 2. Depois que os três ficarem "Verified" e com certificado

Trocar no Railway (isso reinicia os serviços):

- api: `WEB_URL=https://magobox.com.br`, `GOOGLE_REDIRECT_URI=https://api.magobox.com.br/api/v1/integrations/google/callback`,
  `INSTAGRAM_REDIRECT_URI` (idem, com o caminho atual), `PUBLIC_API_URL=https://api.magobox.com.br` (o Telegram usa para o webhook; sem ela vale o domínio do Railway), `WEBPUSH_SUBJECT=mailto:contato@magobox.com.br`. Não mexer em `API_URL`: é o endereço interno usado pelo Evolution.
- web: `NEXT_PUBLIC_API_URL=https://api.magobox.com.br` e `NEXT_PUBLIC_SITE_URL=https://magobox.com.br` (precisam de novo build)

Antes de trocar, cadastrar as novas URLs (senão o login quebra):

- Google Cloud → Credenciais → cliente OAuth: URI de redirecionamento `https://api.magobox.com.br/api/v1/integrations/google/callback`
  e origem JavaScript `https://magobox.com.br`; em "Tela de consentimento", domínio autorizado `magobox.com.br`
- Meta (Instagram): URI de redirecionamento e domínios do app
- Telegram: o webhook se registra sozinho no boot (usa `PUBLIC_API_URL`; reinicie a API depois de trocar)

Manter os endereços `*.up.railway.app` até confirmar que tudo funciona no domínio novo.
