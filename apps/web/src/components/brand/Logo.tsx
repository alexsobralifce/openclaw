// Marca MagoBox: balão de conversa com um "A" cuja barra é uma faísca de IA.
// O desenho é o mesmo de src/app/icon.svg e public/brand/*.svg (mantenha os três iguais).

export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="assistia-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="232" fill="url(#assistia-bg)" />
      <path fill="#ffffff" d="M320 210H704A120 120 0 0 1 824 330V550A120 120 0 0 1 704 670H480L330 800V670H320A120 120 0 0 1 200 550V330A120 120 0 0 1 320 210Z" />
      <path d="M392 606 512 290 632 606" fill="none" stroke="#0f766e" strokeWidth="72" strokeLinecap="round" strokeLinejoin="round" />
      <path fill="#14b8a6" d="M512 432C512 484 528 504 580 504 528 504 512 524 512 576 512 524 496 504 444 504 496 504 512 484 512 432Z" />
    </svg>
  );
}

/** Ícone + nome. `textClassName` controla tamanho e fonte do nome; "Box" sempre em verde-água. */
export function Logo({
  size = 32,
  showText = true,
  className = "",
  textClassName = "text-lg font-bold tracking-tight",
}: {
  size?: number;
  showText?: boolean;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      {showText && (
        <span className={textClassName}>
          Mago<span className="text-teal-400">Box</span>
        </span>
      )}
    </span>
  );
}
