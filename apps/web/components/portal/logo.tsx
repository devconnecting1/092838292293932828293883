/**
 * Logomarca do Vamos Arrematar: casa com efeito 3D (duas faces) e o martelo de
 * leilão vazado no meio. Simples, sólida e legível em tamanho pequeno.
 * Fundo claro: casa na cor da marca, texto preto. Fundo escuro (`claro`): tudo branco.
 * O martelo é recortado (máscara), então aparece a cor de fundo em qualquer tela.
 */
export function LogoSimbolo({
  className = "size-10",
  claro = false,
}: {
  className?: string
  claro?: boolean
}) {
  const id = claro ? "va-logo-claro" : "va-logo"
  const faceEsq = claro ? "#ffffff" : "var(--brand)"
  const faceDir = claro ? "rgba(255,255,255,0.78)" : "color-mix(in srgb, var(--brand) 72%, #ffffff)"
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect width="48" height="48" fill="#fff" />
          <g transform="rotate(-40 24 29)" fill="#000">
            <rect x="16.5" y="23" width="15" height="6.5" rx="2" />
            <rect x="22.5" y="29.5" width="3" height="10" rx="1.5" />
          </g>
        </mask>
      </defs>
      <g mask={`url(#${id})`}>
        <path d="M6 23 24 8v34H9a3 3 0 0 1-3-3z" fill={faceEsq} />
        <path d="M24 8l18 15v16a3 3 0 0 1-3 3H24z" fill={faceDir} />
      </g>
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
