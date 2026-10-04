"use client"

import * as React from "react"

export type FallbackImageProps = Omit<React.ComponentProps<"img">, "src" | "ref"> & {
  src: string
  /**
   * URL usada se `src`/`srcSet` falhar. Fotos antigas não têm a miniatura
   * `__thumb.webp`; aqui a imagem cai para a foto principal.
   */
  fallbackSrc?: string | null
}

function swapToFallback(image: HTMLImageElement, fallbackSrc: string) {
  if (image.dataset.fallbackApplied === "true") return
  image.dataset.fallbackApplied = "true"
  if (!image.hasAttribute("srcset") && image.getAttribute("src") === fallbackSrc) return
  image.removeAttribute("srcset")
  image.removeAttribute("sizes")
  image.src = fallbackSrc
}

/**
 * <img> simples (sem next/image e sem o otimizador da Vercel) que troca para
 * `fallbackSrc` quando a imagem falha. A troca é feita direto no elemento, sem
 * novo render; o `key` reinicia o elemento quando a URL muda.
 */
export function FallbackImage({ src, fallbackSrc, alt, onError, ...props }: FallbackImageProps) {
  // Falha antes da hidratação não dispara onError no React: confere o estado do
  // elemento na montagem (currentSrc vazio = imagem lazy ainda não pedida).
  const checkBroken = React.useCallback(
    (image: HTMLImageElement | null) => {
      if (
        image &&
        fallbackSrc &&
        image.complete &&
        image.naturalWidth === 0 &&
        image.currentSrc !== ""
      ) {
        swapToFallback(image, fallbackSrc)
      }
    },
    [fallbackSrc]
  )

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={`${src}|${fallbackSrc ?? ""}`}
      ref={checkBroken}
      src={src}
      alt={alt}
      onError={(event) => {
        onError?.(event)
        if (fallbackSrc) swapToFallback(event.currentTarget, fallbackSrc)
      }}
      {...props}
    />
  )
}
