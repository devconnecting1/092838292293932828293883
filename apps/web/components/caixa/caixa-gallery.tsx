"use client"

import * as React from "react"
import { ImagesIcon } from "lucide-react"

import { CAIXA_PHOTO_INDEX_LIMIT } from "@workspace/core/caixa/source"
import { Button } from "@workspace/ui/components/button"

import { CaixaPhoto } from "@/components/caixa/caixa-photo"

/**
 * Galeria da página de **um** imóvel.
 *
 * Começa com a foto de índice 0, a única que a investigação da fonte confirmou
 * existir sempre. As outras entram só quando o corretor pede — nunca todas de
 * uma vez, e nunca na lista: um grid pedindo 3 fotos por card viraria uma
 * rajada de requisições (boa parte 404) contra um site com bot manager, e quem
 * levaria o bloqueio seria o corretor.
 *
 * Quando a foto pedida não existe (404), o botão some: não há nada além dela.
 */
export function CaixaGallery({
  numero,
  enabled,
  alt,
}: {
  numero: string
  enabled: boolean
  alt: string
}) {
  const [visibleCount, setVisibleCount] = React.useState(1)
  const [exhausted, setExhausted] = React.useState(false)

  const canLoadMore = enabled && !exhausted && visibleCount < CAIXA_PHOTO_INDEX_LIMIT

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: visibleCount }, (_, index) => (
          <CaixaPhoto
            key={index}
            numero={numero}
            index={index}
            enabled={enabled}
            alt={index === 0 ? alt : `${alt} — foto ${index + 1}`}
            className="aspect-4/3 w-full rounded-lg"
            onUnavailable={index > 0 ? () => setExhausted(true) : undefined}
          />
        ))}
      </div>
      {canLoadMore ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setVisibleCount((current) => current + 1)}
        >
          <ImagesIcon data-icon="inline-start" />
          Carregar mais uma foto
        </Button>
      ) : null}
    </div>
  )
}
