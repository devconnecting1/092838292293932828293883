/**
 * Logomarca do Vamos Arrematar: símbolo (casa com a seta de "fechar negócio")
 * e nome em minúsculas. Usa a cor da marca (--brand), então acompanha a cor
 * escolhida na marca branca. `claro` serve para fundos escuros.
 */
export function LogoSimbolo({
  className = "size-9",
  claro = false,
}: {
  className?: string
  claro?: boolean
}) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect width="48" height="48" rx="13" fill={claro ? "#ffffff" : "var(--brand)"} />
      <path
        d="M12 24.5 24 14l12 10.5V35a1.5 1.5 0 0 1-1.5 1.5H13.5A1.5 1.5 0 0 1 12 35z"
        fill="none"
        stroke={claro ? "var(--brand)" : "#ffffff"}
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path
        d="m18.5 28 4 4 8-8.5"
        fill="none"
        stroke={claro ? "var(--brand)" : "#FF7A45"}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Logo({ nome, claro = false }: { nome: string; claro?: boolean }) {
  const partes = nome.trim().toLowerCase().split(/\s+/)
  const primeira = partes.slice(0, -1).join(" ")
  const ultima = partes.at(-1) ?? ""
  return (
    <span className="flex items-center gap-2.5">
      <LogoSimbolo claro={claro} />
      <span
        className={`text-[22px] leading-none font-extrabold tracking-[-0.03em] ${claro ? "text-white" : "text-[var(--brand)]"}`}
      >
        {primeira ? `${primeira} ` : ""}
        <span className={claro ? "text-white" : "text-[#C2410C]"}>{ultima}</span>
      </span>
    </span>
  )
}
