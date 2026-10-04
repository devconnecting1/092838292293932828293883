"use client"

import * as React from "react"
import { ImageOffIcon } from "lucide-react"
import { cn } from "cn"

import { buildCaixaPhotoUrl, CAIXA_PHOTO_CREDIT } from "@workspace/core/caixa/source"

/**
 * Foto do imóvel no servidor da Caixa, exibida **por referência**.
 *
 * NÃO use `next/image` aqui, e não acrescente o domínio da Caixa em
 * `images.remotePatterns` do `next.config.ts`. A ausência desse bloco não é um
 * problema a resolver: é a salvaguarda que impede alguém de ligar o otimizador
 * sem perceber. Com `next/image`:
 *
 * 1. o otimizador buscaria a imagem **no nosso servidor**, converteria e
 *    guardaria em cache na Vercel — passaria a existir uma cópia nossa da foto,
 *    o oposto da regra que faz este módulo caber no plano mais barato;
 * 2. todas as requisições sairiam de um punhado de IPs de datacenter contra um
 *    site protegido por bot manager. Com `<img>` puro, quem busca a foto é o
 *    navegador de cada corretor, do IP dele — carga distribuída por natureza.
 *
 * `loading="lazy"` para o navegador nem pedir o que está fora da tela, e 404 é
 * situação normal (nem todo imóvel tem a foto de índice 22 ou 23): a imagem
 * simplesmente some, sem erro na tela e sem nova tentativa.
 */
export function CaixaPhoto({
  numero,
  index = 0,
  enabled,
  alt,
  className,
  onUnavailable,
}: {
  numero: string
  /** 0 é a única foto que a lista deve pedir. Ver CAIXA_PHOTO_INDEX_LIMIT. */
  index?: number
  /** Interruptor geral, lido no servidor (CAIXA_PHOTOS_ENABLED). */
  enabled: boolean
  alt: string
  className?: string
  /** Avisa a galeria de que esta foto não existe, para ela parar de avançar. */
  onUnavailable?: () => void
}) {
  const [failed, setFailed] = React.useState(false)
  const url = enabled ? buildCaixaPhotoUrl(numero, index) : null

  if (!url || failed) {
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
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ver o comentário acima: next/image criaria cópia nossa da foto e concentraria as requisições num IP de datacenter. */}
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="size-full object-cover"
        onError={() => {
          setFailed(true)
          onUnavailable?.()
        }}
      />
      <span className="absolute inset-e-1 bottom-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] leading-4 font-medium text-white">
        {CAIXA_PHOTO_CREDIT}
      </span>
    </div>
  )
}
