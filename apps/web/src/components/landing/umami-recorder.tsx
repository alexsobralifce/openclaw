/**
 * Gravação de sessão do Umami, só nas páginas públicas (landing, termos, privacidade, exclusão de dados).
 * O painel e o login ficam só com o script.js do layout: ali há conversas, e-mails e senhas na tela.
 */
export function UmamiRecorder() {
  return <script defer src="https://umami-production-8dd4.up.railway.app/recorder.js" data-website-id="a48228a8-709f-483a-bfbf-672c8e16b099" />;
}
