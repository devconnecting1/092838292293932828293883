import {
  BathIcon,
  BedDoubleIcon,
  CarIcon,
  HouseIcon,
  MapPinIcon,
  RulerIcon,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

import { InterestLink } from "@/components/landing/lead-interest"
import type { PropertySpec } from "@/lib/landing/format"
import type { LandingPropertyView } from "@/lib/landing/view-model"

import { LandingImage, MediaFallback, lpButtonClass, lpDisplayFont } from "./primitives"

export const PROPERTY_SPEC_ICONS: Record<PropertySpec["key"], LucideIcon> = {
  area: RulerIcon,
  bedrooms: BedDoubleIcon,
  suites: BedDoubleIcon,
  bathrooms: BathIcon,
  parking: CarIcon,
}

/** Card de imóvel: foto, preço, título, bairro, características e CTA para o formulário. */
export function PropertyCard({
  property,
  formHref,
  headingLevel = 3,
}: {
  property: LandingPropertyView
  formHref: string
  headingLevel?: 2 | 3 | 4
}) {
  const Heading = `h${headingLevel}` as const
  const [mainPrice, otherPrice] = property.prices
  const specs = property.specs.filter((spec) => spec.key !== "bathrooms").slice(0, 4)

  return (
    <article className="flex w-full flex-col overflow-hidden rounded-(--lp-radius) border border-(--lp-line) bg-(--lp-surface) text-(--lp-ink)">
      <div className="relative aspect-4/3 overflow-hidden bg-(--lp-surface-alt)">
        {property.coverUrl ? (
          // Miniatura WebP de 400 px; foto antiga sem miniatura cai para a principal.
          <LandingImage
            src={property.coverThumbUrl ?? property.coverUrl}
            fallbackSrc={property.coverUrl}
            alt={`Foto do imóvel: ${property.title}`}
            width={400}
            height={300}
            className="size-full"
          />
        ) : (
          <MediaFallback icon={HouseIcon} className="size-full" />
        )}
        {property.purposeLabel ? (
          <Badge variant="secondary" className="absolute top-3 left-3">
            {property.purposeLabel}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <Heading className="text-base leading-snug font-semibold text-balance">
          {property.title}
        </Heading>

        <div className="order-first flex flex-col gap-0.5">
          {mainPrice ? (
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="sr-only">{mainPrice.label}: </span>
              <span
                className={cn(
                  lpDisplayFont,
                  "text-[1.625rem] leading-none font-bold tracking-tight tabular-nums"
                )}
              >
                {mainPrice.amount}
              </span>
              {mainPrice.suffix ? (
                <span className="text-sm text-(--lp-ink-muted)">{mainPrice.suffix}</span>
              ) : null}
            </p>
          ) : (
            <p className="text-sm font-medium text-(--lp-ink-muted)">Valor sob consulta</p>
          )}
          {otherPrice ? (
            <p className="text-sm text-(--lp-ink-muted)">
              {otherPrice.label} {otherPrice.amount}
              {otherPrice.suffix}
            </p>
          ) : null}
        </div>

        {property.place ? (
          <p className="flex items-start gap-1.5 text-sm text-(--lp-ink-muted)">
            <MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {property.place}
          </p>
        ) : null}

        {specs.length > 0 ? (
          <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1.5 border-t border-(--lp-line) pt-3 text-sm">
            {specs.map((spec) => {
              const Icon = PROPERTY_SPEC_ICONS[spec.key]
              return (
                <li key={spec.key} className="flex items-center gap-1.5">
                  <Icon aria-hidden="true" className="size-4 text-(--lp-primary-text)" />
                  {spec.value}
                </li>
              )
            })}
          </ul>
        ) : null}

        <InterestLink
          href={formHref}
          interest={{
            kind: "property",
            id: property.id,
            code: property.code,
            title: property.title,
          }}
          aria-label={`Tenho interesse: ${property.title}`}
          className={lpButtonClass({
            tone: "outline",
            className: cn("w-full", specs.length > 0 ? "mt-2" : "mt-auto"),
          })}
        >
          Tenho interesse
        </InterestLink>
      </div>
    </article>
  )
}
