// Marca MagoBox: chapéu de mago com uma estrela sobre fundo roxo.
// O desenho é o mesmo de src/app/icon.svg e public/brand/magobox-*.svg (mantenha os três iguais).

export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="magobox-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2E1065" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="232" fill="url(#magobox-bg)" />
      <ellipse cx="512" cy="745" rx="305" ry="80" fill="#FFFFFF" />
      <path fill="#FFFFFF" d="M352 745 C384 600 452 440 522 340 C566 278 614 238 668 214 C640 262 650 330 656 410 C664 520 668 630 672 745 Z" />
      <path fill="#FBBF24" d="M386 652 Q522 706 664 652 L672 742 Q520 796 352 742 Z" />
      <path fill="#FBBF24" d="M530 430 Q551.0 479.0 600 500 Q551.0 521.0 530 570 Q509.0 521.0 460 500 Q509.0 479.0 530 430Z" />
      <path fill="#FDE68A" d="M404 310 Q412.4 331.6 434 340 Q412.4 348.4 404 370 Q395.6 348.4 374 340 Q395.6 331.6 404 310Z" />
      <path fill="#FDE68A" d="M720 306 Q726.72 323.28 744 330 Q726.72 336.72 720 354 Q713.28 336.72 696 330 Q713.28 323.28 720 306Z" />
    </svg>
  );
}

/** Ícone + nome. `textClassName` controla tamanho e fonte do nome; "Box" sempre em dourado. */
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
          Mago<span className="text-amber-400">Box</span>
        </span>
      )}
    </span>
  );
}
