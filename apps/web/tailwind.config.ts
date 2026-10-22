import type { Config } from "tailwindcss";

// Cores do logo do MagoBox: roxo noite (#2E1065) e violeta (#6D28D9) são violet-950/700 do Tailwind; o dourado das
// faíscas (#FBBF24) é amber-400. Os cinzas do painel ganham o mesmo tom de roxo, para o fundo combinar com o logo.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Os valores ficam em globals.css (:root = noite, :root.light = dia); aqui só o nome, com suporte a /opacidade
        gray: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, `rgb(var(--gray-${n}) / <alpha-value>)`])),
      },
    },
  },
  plugins: [],
};

export default config;
