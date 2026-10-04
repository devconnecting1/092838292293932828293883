import Link from "next/link"

import { credenciais, PORTAL } from "@/lib/portal/config"

export const CURRICULO = [
  "No mercado imobiliário desde 2014",
  "Corretor de imóveis, CRECI-RJ 073649",
  "Avaliador imobiliário, CNAI 58123",
  "Especialista em leilão de imóveis",
  "Pós-graduado na área imobiliária",
  "Bacharel em Direito",
  "Piloto de drone para vistoria e avaliação",
  "Conselheiro do CRECI em Nova Iguaçu desde 2024",
  "Palestrante",
]

/** Bloco do responsável técnico, com foto pequena. `compacto` para a home. */
export function Responsavel({ compacto = false }: { compacto?: boolean }) {
  return (
    <div className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center sm:p-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/portal/fabricio-damiao.webp"
        alt={`${PORTAL.responsavel}, CEO e responsável técnico`}
        width={compacto ? 120 : 168}
        height={compacto ? 160 : 224}
        className={`shrink-0 self-center rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 object-cover object-top ${compacto ? "h-40 w-30" : "h-56 w-42"}`}
      />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
          CEO e responsável técnico
        </span>
        <h2 className="text-2xl font-extrabold tracking-tight">{PORTAL.responsavel}</h2>
        <p className="leading-relaxed text-slate-700">
          Responsável técnico pelo portal, pelo projeto e pela assessoria em leilão de imóveis.
          Lidera uma equipe com corretores, avaliadores, apoio jurídico especializado, sistema e
          tecnologia para entender cada cliente e cada imóvel antes do lance.
        </p>
        {compacto ? (
          <Link href="/quem-somos" className="font-bold text-[var(--brand)]">
            Conheça a equipe e o currículo
          </Link>
        ) : (
          <ul className="mt-1 grid gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
            {CURRICULO.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="font-extrabold text-[var(--brand)]">✓</span>
                {c}
              </li>
            ))}
          </ul>
        )}
        <span className="text-xs text-slate-500">{credenciais()}</span>
      </div>
    </div>
  )
}
