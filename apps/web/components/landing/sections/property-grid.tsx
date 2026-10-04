import { HouseIcon } from "lucide-react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { cn } from "@workspace/ui/lib/utils"

import type { LandingPropertyView } from "@/lib/landing/view-model"

import { PropertyCard } from "./property-card"
import { lpButtonClass, type LandingMode } from "./primitives"

/** Estado vazio: em público convida ao formulário; na pré-visualização orienta o editor. */
export function PropertiesEmpty({
  mode,
  formHref,
  ctaLabel,
  className,
}: {
  mode: LandingMode
  formHref: string
  ctaLabel: string
  className?: string
}) {
  const preview = mode === "preview"
  return (
    <div
      className={cn(
        "rounded-(--lp-radius) border border-dashed border-(--lp-input-border) bg-(--lp-surface)",
        className
      )}
    >
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HouseIcon />
          </EmptyMedia>
          <EmptyTitle>{preview ? "Nenhum imóvel selecionado" : "Novas opções em breve"}</EmptyTitle>
          <EmptyDescription>
            {preview
              ? "Escolha no editor quais imóveis aparecem nesta página."
              : "Conte o que você procura e um corretor envia opções que combinam com você."}
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

export function PropertyGrid({
  properties,
  formHref,
  mode,
  ctaLabel,
  columns = 3,
}: {
  properties: LandingPropertyView[]
  formHref: string
  mode: LandingMode
  ctaLabel: string
  columns?: 2 | 3
}) {
  if (properties.length === 0) {
    return <PropertiesEmpty mode={mode} formHref={formHref} ctaLabel={ctaLabel} />
  }

  return (
    <ul className={cn("grid gap-5 @xl:grid-cols-2", columns === 3 && "@5xl:grid-cols-3")}>
      {properties.map((property) => (
        <li key={property.id} className="flex">
          <PropertyCard property={property} formHref={formHref} />
        </li>
      ))}
    </ul>
  )
}
