import type { ReactNode } from "react"

import { formatAreaRange, pluralize } from "@/lib/landing/format"
import type { LandingTypology } from "@/lib/landing/types"
import type { LandingViewModel } from "@/lib/landing/view-model"

import { Section, lpButtonClass, type LandingMode } from "../sections/primitives"

/** Props que <LandingTemplate> entrega a cada modelo. */
export type LandingTemplateRenderProps = {
  vm: LandingViewModel
  mode: LandingMode
  /** Formulário já resolvido (slot do L3 ou formulário inerte do L2). */
  leadForm: ReactNode
  /** Ids únicos por página (a galeria renderiza vários modelos juntos). */
  id: (name: string) => string
  /** Âncora do formulário (`#lead-form` na página pública). */
  formHref: string
}

export const DISCLAIMERS = {
  property: "Valores, condições e disponibilidade sujeitos a alteração sem aviso prévio.",
  offer:
    "Condição sujeita a análise de crédito e à disponibilidade de unidades. Valores e prazos podem mudar sem aviso prévio.",
  launch:
    "Imagens ilustrativas. Áreas, valores e condições de pagamento sujeitos a alteração e à disponibilidade de unidades.",
} as const

export function capitalizeFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** "38 a 118 m²" (ou faixa de quartos quando não há áreas). */
export function typologySummary(typologies: LandingTypology[]) {
  const areas = typologies
    .flatMap((typology) => [typology.area_min, typology.area_max])
    .filter((value): value is number => value != null && value > 0)
  if (areas.length > 0) return formatAreaRange(Math.min(...areas), Math.max(...areas))

  const bedrooms = typologies
    .map((typology) => typology.bedrooms)
    .filter((value): value is number => value != null && value > 0)
  if (bedrooms.length === 0) return null
  const min = Math.min(...bedrooms)
  const max = Math.max(...bedrooms)
  return min === max ? pluralize(min, "quarto", "quartos") : `${min} a ${max} quartos`
}

export type LaunchFact = { label: string; value: string }

/** Ficha do empreendimento (só o que foi preenchido). */
export function launchFacts(vm: LandingViewModel): LaunchFact[] {
  const facts: LaunchFact[] = []
  if (vm.launch.deliveryLabel) {
    facts.push({
      label: "Previsão de entrega",
      value: capitalizeFirst(vm.launch.deliveryLabel),
    })
  }
  if (vm.launch.developer) facts.push({ label: "Construtora", value: vm.launch.developer })
  if (vm.launch.place) {
    facts.push({
      label: "Localização",
      value: vm.launch.neighborhood ?? vm.launch.place,
    })
  }
  const plans = typologySummary(vm.launch.typologies)
  if (plans) facts.push({ label: "Plantas", value: plans })
  return facts
}

/** Orientação visível só na pré-visualização do editor. */
export function PreviewHint({ mode, children }: { mode: LandingMode; children: ReactNode }) {
  if (mode !== "preview") return null
  return (
    <p className="w-fit rounded-(--lp-radius) border border-dashed border-(--lp-input-border) bg-(--lp-surface) px-3 py-2 text-sm text-(--lp-ink-muted)">
      {children}
    </p>
  )
}

/** Faixa final na cor da marca que leva de volta ao formulário. */
export function ClosingCta({
  headingId,
  title,
  formHref,
  ctaLabel,
}: {
  headingId: string
  title: string
  formHref: string
  ctaLabel: string
}) {
  return (
    <Section tone="brand" labelledBy={headingId} className="py-12 @3xl:py-16">
      <div className="flex flex-col items-start gap-6 @3xl:flex-row @3xl:items-center @3xl:justify-between">
        <h2
          id={headingId}
          className="max-w-2xl text-[1.625rem] leading-tight font-semibold text-balance @3xl:text-[2rem]"
        >
          {title}
        </h2>
        <a href={formHref} className={lpButtonClass({ tone: "light", size: "lg" })}>
          {ctaLabel}
        </a>
      </div>
    </Section>
  )
}
