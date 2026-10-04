import { ExternalLinkIcon, MapPinIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { lpButtonClass, lpSerifFont, toneMuted, type LandingTone } from "./primitives"

/**
 * Localização textual (sem mapa embutido: nada de script de terceiros na
 * landing). O link abre a busca do bairro no Google Maps em nova aba.
 */
export function LocationBlock({
  headingId,
  title = "Localização",
  place,
  description,
  font = "sans",
  tone = "surface",
}: {
  headingId: string
  title?: string
  place: string | null
  description?: string | null
  font?: "sans" | "serif"
  tone?: LandingTone
}) {
  if (!place) return null

  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`

  return (
    <div className="grid gap-6 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @3xl:items-end">
      <h2
        id={headingId}
        className={cn(
          "text-[1.75rem] leading-[1.12] font-semibold tracking-tight text-balance @3xl:text-[2.375rem]",
          font === "serif" && cn(lpSerifFont, "font-medium tracking-normal")
        )}
      >
        {title}
      </h2>
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-2.5 text-xl leading-snug font-medium text-balance">
          <MapPinIcon
            aria-hidden="true"
            className={cn("mt-1 size-5 shrink-0", tone === "surface" && "text-(--lp-primary-text)")}
          />
          {place}
        </p>
        {description ? (
          <p className={cn("max-w-[60ch] leading-relaxed text-pretty", toneMuted[tone])}>
            {description}
          </p>
        ) : null}
        <a
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          className={lpButtonClass({
            tone: tone === "surface" ? "outline" : "outline-inverse",
            className: "self-start",
          })}
        >
          Ver a região no mapa
          <ExternalLinkIcon aria-hidden="true" />
          <span className="sr-only">(abre em nova aba)</span>
        </a>
      </div>
    </div>
  )
}
