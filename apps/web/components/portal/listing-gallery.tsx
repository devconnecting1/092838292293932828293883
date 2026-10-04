"use client"

import * as React from "react"

import { ListingPhoto } from "@/components/portal/listing-photo"

/**
 * Galeria da página do imóvel: foto principal e até duas fotos extras.
 * Foto extra que não existe some da tela, em vez de deixar um quadro vazio;
 * sem extras, a principal ocupa a largura toda.
 */
export function ListingGallery({
  numero,
  fotos,
  caixa,
  enabled,
}: {
  numero: string
  fotos: string[]
  caixa: boolean
  enabled: boolean
}) {
  const [missing, setMissing] = React.useState<Record<number, boolean>>({})
  const extras = [1, 2].filter((i) => !missing[i])
  const hide = (i: number) => () => setMissing((m) => ({ ...m, [i]: true }))

  return (
    <div className={extras.length ? "grid gap-3 md:grid-cols-[2fr_1fr]" : "grid"}>
      <ListingPhoto
        numero={numero}
        fotos={fotos}
        caixa={caixa}
        index={0}
        enabled={enabled}
        alt="Foto principal do imóvel"
        className="h-72 w-full rounded-2xl object-cover md:h-[420px]"
      />
      {extras.length ? (
        <div className="grid gap-3">
          {extras.map((i) => (
            <ListingPhoto
              key={i}
              numero={numero}
              fotos={fotos}
              caixa={caixa}
              index={i}
              enabled={enabled}
              alt="Foto do imóvel"
              onUnavailable={hide(i)}
              className={`w-full rounded-2xl object-cover ${extras.length === 1 ? "h-40 md:h-[420px]" : "h-40 md:h-[204px]"}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
