# Domínio magobox.com.br (Registro.br → Railway)

Registrado em 03/10/2026 (titular: o próprio dono), vence em 03/10/2027. DNS no Registro.br, modo avançado, servidores `a.sec.dns.br` e `b.sec.dns.br` (DNSSEC ligado).

## Situação (03/10/2026)

| Endereço | Serviço | Estado |
|---|---|---|
| `app.magobox.com.br` | web (painel e login) | no ar, HTTPS válido |
| `www.magobox.com.br` | web (site público, endereço canônico) | no ar, HTTPS válido |
| `api.magobox.com.br` | api | no ar, HTTPS válido |
| `magobox.com.br` (sem prefixo) | — | **não resolve** (o Registro.br não aceita CNAME na raiz) |

Registros na zona (CNAME para o destino do Railway + TXT `_railway-verify.<nome>` de cada um): consulte `railway domain list --service web|api` e `railway domain status <id> --service ...` para ver os valores atuais.

## Variáveis do Railway

- api: `WEB_URL=https://app.magobox.com.br`, `WEB_ORIGINS=<endereço antigo do Railway>,https://www.magobox.com.br`, `PUBLIC_API_URL=https://api.magobox.com.br`, `GOOGLE_REDIRECT_URI=https://api.magobox.com.br/api/v1/integrations/google/callback`, `WEBPUSH_*`.
- web (build-args, exigem novo deploy): `NEXT_PUBLIC_API_URL=https://api.magobox.com.br`, `NEXT_PUBLIC_SITE_URL=https://www.magobox.com.br`.
- **Não mexer em `API_URL`** (endereço interno usado pela Evolution) nem em `INSTAGRAM_REDIRECT_URI` (a Meta ainda não tem a URL nova).

## Pendências

1. **Google Search Console**: verificar `magobox.com.br` como Domínio (TXT na zona), enviar `https://www.magobox.com.br/sitemap.xml` e pedir indexação da página inicial. O mesmo domínio verificado serve de "domínio autorizado" na tela de consentimento do Google Cloud (política de privacidade e termos em `https://www.magobox.com.br/privacidade` e `/termos`).
2. **Instagram (Meta)**: cadastrar `https://api.magobox.com.br/api/v1/channels/instagram/callback` e os domínios do app; depois trocar `INSTAGRAM_REDIRECT_URI`.
3. **Raiz sem prefixo**: só com DNS que aceite CNAME/ALIAS na raiz (Cloudflare gratuita, trocando os servidores de nome no Registro.br; antes é preciso desligar o DNSSEC lá). Decidido adiar; divulgar sempre `www.magobox.com.br`.
4. Os endereços `*.up.railway.app` seguem funcionando (CORS aceita) até a migração completa.
