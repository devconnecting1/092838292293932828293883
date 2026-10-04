"use client"

import * as React from "react"
import { ImageOffIcon } from "lucide-react"
import { cn } from "cn"

import { CaixaPhoto } from "@/components/caixa/caixa-photo"

/**
 * Foto de um imóvel de qualquer origem, sempre por referência (sem copiar a
 * imagem para o nosso servidor). Caixa: servidor da Caixa pelo número do
 * imóvel. Demais origens: a lista de fotos que o parceiro enviou.
 */
export function ListingPhoto({
  numero,
  fotos,
  caixa,
  index = 0,
  enabled,
  alt,
  className,
  onUnavailable,
}: {
  numero: string
  fotos: string[]
  caixa: boolean
  index?: number
  enabled: boolean
  alt: string
  className?: string
  onUnavailable?: () => void
}) {
  const [failed, setFailed] = React.useState(false)
  const src = caixa ? undefined : fotos[index]
  React.useEffect(() => {
    if (!caixa && !src) onUnavailable?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caixa, src])

  if (caixa) {
    return (
      <CaixaPhoto
        numero={numero}
        index={index}
        enabled={enabled}
        alt={alt}
        className={className}
        onUnavailable={onUnavailable}
      />
    )
  }

  if (!src || failed) {
    return (
      <div
        className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}
        aria-hidden="true"
      >
        <ImageOffIcon className="size-6" />
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={cn("object-cover", className)}
      onError={() => {
        setFailed(true)
        onUnavailable?.()
      }}
    />
  )
}
