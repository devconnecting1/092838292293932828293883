"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export type PreviewDevice = "desktop" | "mobile"

const DEVICE_WIDTHS: Record<PreviewDevice, number> = {
  desktop: 1280,
  mobile: 390,
}

/** Respiro lateral do "aparelho" no modo celular. */
const MOBILE_GUTTER = 32

/**
 * Pré-visualização em escala. Os modelos respondem à largura do próprio
 * contêiner (`@container`), então basta renderizar o modelo com a largura do
 * aparelho (1280 px ou 390 px) e reduzir com `transform: scale()` para caber
 * no painel. O `transform` também vira o bloco de contenção de elementos
 * `fixed` do modelo, que ficam presos à prévia.
 *
 * - `fit="scroll"`: a prévia rola dentro do painel (editor);
 * - `fit="clip"`: mostra só o topo (miniaturas da galeria).
 */
export function LandingPreviewFrame({
  device,
  title,
  fit = "scroll",
  className,
  children,
}: {
  device: PreviewDevice
  title: string
  fit?: "scroll" | "clip"
  className?: string
  children: React.ReactNode
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const [contentHeight, setContentHeight] = React.useState(0)

  React.useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container) setContainerWidth(entry.contentRect.width)
        if (entry.target === content) setContentHeight(entry.contentRect.height)
      }
    })

    observer.observe(container)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const frameWidth = DEVICE_WIDTHS[device]
  const gutter = device === "mobile" ? MOBILE_GUTTER : 0
  const measured = containerWidth > 0
  const scale = measured ? Math.min(1, Math.max(0.05, (containerWidth - gutter) / frameWidth)) : 1

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={title}
      className={cn(
        "relative size-full min-h-0 overflow-x-hidden",
        fit === "scroll" ? "overflow-y-auto overscroll-contain" : "overflow-hidden",
        device === "mobile" && "bg-muted/40 py-4",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto overflow-hidden",
          device === "mobile" && "rounded-[1.75rem] shadow-lg ring-8 ring-foreground/80"
        )}
        style={{
          width: frameWidth * scale,
          height: contentHeight > 0 ? contentHeight * scale : undefined,
          visibility: measured ? undefined : "hidden",
        }}
      >
        <div
          ref={contentRef}
          className="origin-top-left"
          style={{ width: frameWidth, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
