import { BedDoubleIcon, LayoutPanelLeftIcon, RulerIcon } from "lucide-react"
import type { ReactNode } from "react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { cn } from "@workspace/ui/lib/utils"

import { InterestLink } from "@/components/landing/lead-interest"
import { formatCurrency } from "@/lib/format"
import { formatAreaRange, typologyBedrooms } from "@/lib/landing/format"
import type { LandingTypology } from "@/lib/landing/types"

import { lpButtonClass, lpDisplayFont, lpFocus, lpSerifFont, type LandingMode } from "./primitives"

function priceFrom(typology: LandingTypology) {
  return typology.price_from != null && typology.price_from > 0
    ? formatCurrency(typology.price_from)
    : null
}

function TypologiesEmpty({
  mode,
  formHref,
  ctaLabel,
}: {
  mode: LandingMode
  formHref: string
  ctaLabel: string
}) {
  const preview = mode === "preview"
  return (
    <div className="rounded-(--lp-radius) border border-dashed border-(--lp-input-border) bg-(--lp-surface)">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutPanelLeftIcon />
          </EmptyMedia>
          <EmptyTitle>
            {preview ? "Nenhuma tipologia cadastrada" : "Plantas sob consulta"}
          </EmptyTitle>
          <EmptyDescription>
            {preview
              ? "Adicione as plantas no editor com área, quartos e preço inicial."
              : "Peça a tabela e receba as plantas disponíveis com valores atualizados."}
          </EmptyDescription>
        </EmptyHeader>
        {preview ? null : (
          <EmptyContent>
            <a href={formHref} className={lpButtonClass()}>
              {ctaLabel}
            </a>
          </EmptyContent>
        )}
      </Empty>
    </div>
  )
}

function PriceValue({ typology, size }: { typology: LandingTypology; size: "md" | "lg" }) {
  const price = priceFrom(typology)
  if (!price) {
    return <span className="text-base font-medium text-(--lp-ink-muted)">Sob consulta</span>
  }
  return (
    <span
      className={cn(
        lpDisplayFont,
        "leading-tight font-bold tracking-tight tabular-nums",
        size === "lg" ? "text-[1.75rem]" : "text-[1.5rem]"
      )}
    >
      {price}
    </span>
  )
}

function NotInformed() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">Não informado</span>
    </>
  )
}

/** Cards de tipologia (lançamento completo). CTA registra a tipologia no formulário. */
export function TypologyCards({
  typologies,
  formHref,
  ctaLabel,
  mode,
  className,
}: {
  typologies: LandingTypology[]
  formHref: string
  ctaLabel: string
  mode: LandingMode
  className?: string
}) {
  if (typologies.length === 0) {
    return <TypologiesEmpty mode={mode} formHref={formHref} ctaLabel={ctaLabel} />
  }

  return (
    <ul className={cn("grid gap-4 @xl:grid-cols-2 @5xl:grid-cols-3", className)}>
      {typologies.map((typology, index) => {
        const area = formatAreaRange(typology.area_min, typology.area_max)
        const bedrooms = typologyBedrooms(typology)
        return (
          <li
            key={`${index}-${typology.name}`}
            className="flex flex-col gap-5 rounded-(--lp-radius) border border-(--lp-line) bg-(--lp-surface) p-5 text-(--lp-ink)"
          >
            <h3
              className={cn(lpSerifFont, "text-[1.625rem] leading-tight font-medium text-balance")}
            >
              {typology.name}
            </h3>
            {area || bedrooms ? (
              <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                {area ? (
                  <li className="flex items-center gap-1.5">
                    <RulerIcon aria-hidden="true" className="size-4 text-(--lp-primary-text)" />
                    {area}
                  </li>
                ) : null}
                {bedrooms ? (
                  <li className="flex items-center gap-1.5">
                    <BedDoubleIcon aria-hidden="true" className="size-4 text-(--lp-primary-text)" />
                    {bedrooms}
                  </li>
                ) : null}
              </ul>
            ) : null}
            <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-(--lp-line) pt-4">
              <p className="flex flex-col">
                {priceFrom(typology) ? (
                  <span className="text-xs text-(--lp-ink-muted)">a partir de</span>
                ) : null}
                <PriceValue typology={typology} size="lg" />
              </p>
              <InterestLink
                href={formHref}
                interest={{ kind: "typology", name: typology.name }}
                aria-label={`Quero esta planta: ${typology.name}`}
                className={cn(
                  "rounded-sm text-sm font-semibold text-(--lp-primary-text) underline underline-offset-4",
                  lpFocus
                )}
              >
                Quero esta planta
              </InterestLink>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ComparisonRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col justify-center gap-0.5 border-t border-(--lp-line) px-5 py-3.5">
      <dt className="text-xs text-(--lp-ink-muted)">{label}</dt>
      <dd className="text-base font-medium tabular-nums">{children}</dd>
    </div>
  )
}

/**
 * Comparação lado a lado: cada tipologia é uma coluna e os atributos ficam
 * alinhados na mesma linha entre colunas (CSS subgrid). No mobile a região
 * rola na horizontal. Cada coluna tem CTA que informa a tipologia ao
 * formulário via `useLandingLeadInterest()`.
 */
export function TypologyComparison({
  typologies,
  formHref,
  ctaLabel,
  label,
  mode,
}: {
  typologies: LandingTypology[]
  formHref: string
  ctaLabel: string
  /** Nome acessível da região ("Comparação das plantas do Residencial X"). */
  label: string
  mode: LandingMode
}) {
  if (typologies.length === 0) {
    return <TypologiesEmpty mode={mode} formHref={formHref} ctaLabel={ctaLabel} />
  }

  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn("-mx-4 overflow-x-auto px-4 pb-3 @3xl:mx-0 @3xl:px-0", lpFocus)}
    >
      <ul className="grid snap-x snap-mandatory auto-cols-[minmax(15.5rem,1fr)] grid-flow-col grid-rows-[repeat(5,auto)] gap-x-4">
        {typologies.map((typology, index) => {
          const area = formatAreaRange(typology.area_min, typology.area_max)
          const bedrooms = typologyBedrooms(typology)
          const price = priceFrom(typology)
          return (
            <li
              key={`${index}-${typology.name}`}
              className="row-span-5 grid snap-start grid-rows-subgrid overflow-hidden rounded-(--lp-radius) border border-(--lp-line) bg-(--lp-surface) text-(--lp-ink)"
            >
              <div className="flex items-end bg-(--lp-surface-alt) px-5 pt-6 pb-4">
                <h3
                  className={cn(
                    lpSerifFont,
                    "text-[1.625rem] leading-tight font-medium text-balance"
                  )}
                >
                  {typology.name}
                </h3>
              </div>
              <dl className="row-span-3 grid grid-rows-subgrid">
                <ComparisonRow label="Área privativa">{area ?? <NotInformed />}</ComparisonRow>
                <ComparisonRow label="Quartos">{bedrooms ?? <NotInformed />}</ComparisonRow>
                <ComparisonRow label={price ? "A partir de" : "Valor"}>
                  <PriceValue typology={typology} size="md" />
                </ComparisonRow>
              </dl>
              <div className="flex items-end border-t border-(--lp-line) px-5 py-4">
                <InterestLink
                  href={formHref}
                  interest={{ kind: "typology", name: typology.name }}
                  aria-label={`Quero esta planta: ${typology.name}`}
                  className={lpButtonClass({
                    tone: "primary",
                    className: "w-full",
                  })}
                >
                  Quero esta planta
                </InterestLink>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
