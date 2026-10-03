import type { Config } from "tailwindcss";

// Cores do logo do MagoBox: roxo noite (#2E1065) e violeta (#6D28D9) são violet-950/700 do Tailwind; o dourado das
// faíscas (#FBBF24) é amber-400. Os cinzas do painel ganham o mesmo tom de roxo, para o fundo combinar com o logo.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        gray: {
          50: "#F7F5FC",
          100: "#EEEBF7",
          200: "#DDD9EC",
          300: "#C4BFDC",
          400: "#9C96BC",
          500: "#6E6794",
          600: "#4D4380",
          700: "#352C63",
          800: "#231B49",
          900: "#151033",
          950: "#0B0720",
        },
      },
    },
  },
  plugins: [],
};

export default config;
