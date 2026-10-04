"use client"

/**
 * Interesse escolhido na página (tipologia ou imóvel) compartilhado com o
 * formulário de lead injetado no slot `leadForm`.
 *
 * Uso no formulário do L3 (client component renderizado dentro de
 * <LandingTemplate>):
 *
 *   const { interest } = useLandingLeadInterest()
 *   // interest?.kind === "typology" → interest.name
 *   // interest?.kind === "property" → interest.id / interest.code / interest.title
 *   <input type="hidden" name="interest" value={describeLeadInterest(interest) ?? ""} />
 *
 * Os CTAs "Quero esta planta" / "Tenho interesse" usam <InterestLink>, que
 * grava o interesse e rola até o formulário. O painel do formulário mostra o
 * interesse escolhido com opção de remover (<LeadInterestNotice>).
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

export type LandingLeadInterest =
  | { kind: "typology"; name: string }
  | { kind: "property"; id: string; code: string | null; title: string }

export type LandingLeadInterestValue = {
  interest: LandingLeadInterest | null
  setInterest: (interest: LandingLeadInterest | null) => void
}

const LandingLeadInterestContext = createContext<LandingLeadInterestValue>({
  interest: null,
  setInterest: () => {},
})

export function LandingLeadInterestProvider({ children }: { children: ReactNode }) {
  const [interest, setInterest] = useState<LandingLeadInterest | null>(null)
  const value = useMemo(() => ({ interest, setInterest }), [interest])

  return <LandingLeadInterestContext value={value}>{children}</LandingLeadInterestContext>
}

/** Fora de <LandingTemplate> devolve `{ interest: null }` e um setter inerte. */
export function useLandingLeadInterest() {
  return useContext(LandingLeadInterestContext)
}

/** Texto curto para o lead/mensagem: "Tipologia: Garden 3 quartos" / "Imóvel AP-1024: …". */
export function describeLeadInterest(interest: LandingLeadInterest | null) {
  if (!interest) return null
  if (interest.kind === "typology") return `Tipologia: ${interest.name}`
  return interest.code ? `Imóvel ${interest.code}: ${interest.title}` : `Imóvel: ${interest.title}`
}

/** Link para o formulário que registra o interesse antes de rolar. */
export function InterestLink({
  href,
  interest,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  href: string
  interest: LandingLeadInterest
  className?: string
  children: ReactNode
  "aria-label"?: string
}) {
  const { setInterest } = useLandingLeadInterest()

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      className={className}
      onClick={() => setInterest(interest)}
    >
      {children}
    </a>
  )
}

/** Aviso dentro do painel do formulário com o interesse escolhido. */
export function LeadInterestNotice({ className }: { className?: string }) {
  const { interest, setInterest } = useLandingLeadInterest()

  return (
    <div role="status" className={cn(!interest && "sr-only", className)}>
      {interest ? (
        <div className="flex items-start justify-between gap-3 rounded-(--lp-radius) bg-(--lp-primary-soft) px-3.5 py-2.5 text-sm text-(--lp-on-primary-soft)">
          <p className="min-w-0 text-pretty">
            <span className="font-semibold">Seu interesse: </span>
            {interest.kind === "typology" ? interest.name : interest.title}
            {interest.kind === "property" && interest.code ? ` (cód. ${interest.code})` : null}
          </p>
          <button
            type="button"
            onClick={() => setInterest(null)}
            className="shrink-0 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus)"
          >
            Remover
          </button>
        </div>
      ) : null}
    </div>
  )
}
