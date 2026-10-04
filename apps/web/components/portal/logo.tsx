/**
 * Logomarca do Vamos Arrematar: casa com o martelo de leilão dentro (leilão e
 * imóvel no mesmo símbolo) e o nome em minúsculas.
 * Fundo claro: casa na cor da marca (--brand), martelo vermelho, texto preto.
 * Fundo escuro (`claro`): tudo branco.
 */
export function LogoSimbolo({
  className = "size-10",
  claro = false,
}: {
  className?: string
  claro?: boolean
}) {
  const casa = claro ? "#ffffff" : "var(--brand)"
  const martelo = claro ? "#ffffff" : "#C2410C"
  const faixa = claro ? "#0B1220" : "#ffffff"
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        d="M5 22 24 7l19 15"
        fill="none"
        stroke={casa}
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 19V39.5a1.5 1.5 0 0 0 1.5 1.5h24a1.5 1.5 0 0 0 1.5-1.5V19"
        fill="none"
        stroke={casa}
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g transform="rotate(-35 22 23)">
        <rect x="14" y="16" width="16" height="8" rx="2.4" fill={martelo} />
        <rect x="17" y="16" width="1.4" height="8" fill={faixa} opacity="0.85" />
        <rect x="25.6" y="16" width="1.4" height="8" fill={faixa} opacity="0.85" />
        <rect x="20.2" y="24" width="3.6" height="13" rx="1.6" fill={martelo} />
      </g>
      <rect x="25" y="35" width="9" height="2.8" rx="1.2" fill={casa} />
    </svg>
  )
}

export function Logo({ nome, claro = false }: { nome: string; claro?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <LogoSimbolo claro={claro} className="size-9 shrink-0 sm:size-10" />
      <span
        className={`text-[19px] leading-none font-extrabold tracking-[-0.03em] whitespace-nowrap sm:text-[22px] ${claro ? "text-white" : "text-slate-950"}`}
      >
        {nome.trim().toLowerCase()}
      </span>
    </span>
  )
}
