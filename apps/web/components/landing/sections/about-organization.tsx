import { BadgeCheckIcon, MapPinIcon } from "lucide-react"

import type { LandingOrganizationView } from "@/lib/landing/view-model"

import { HighlightList } from "./highlights"
import { Paragraphs, SectionHeading } from "./primitives"

/** Sobre a imobiliária: texto, credenciais (CRECI, cidade) e números/diferenciais. */
export function AboutOrganization({
  headingId,
  title,
  organization,
  description,
  highlights,
}: {
  headingId: string
  title: string
  organization: LandingOrganizationView
  description: string | null
  highlights: string[]
}) {
  const hasSide = highlights.length > 0

  return (
    <div
      className={
        hasSide
          ? "grid gap-10 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @4xl:gap-16"
          : "flex flex-col gap-8"
      }
    >
      <div className="flex flex-col gap-6">
        <SectionHeading id={headingId} title={title} />
        {description ? <Paragraphs text={description} className="text-(--lp-ink)" /> : null}
        {organization.creciLabel || organization.place ? (
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            {organization.creciLabel ? (
              <li className="flex items-center gap-2">
                <BadgeCheckIcon aria-hidden="true" className="size-4 text-(--lp-primary-text)" />
                {organization.creciLabel}
              </li>
            ) : null}
            {organization.place ? (
              <li className="flex items-center gap-2">
                <MapPinIcon aria-hidden="true" className="size-4 text-(--lp-primary-text)" />
                {organization.place}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      {hasSide ? <HighlightList items={highlights} variant="statements" /> : null}
    </div>
  )
}
