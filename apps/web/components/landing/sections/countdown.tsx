"use client"

import { useSyncExternalStore } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { formatDateTime } from "@/lib/format"

import { lpDisplayFont, toneMuted, type LandingTone } from "./primitives"

function subscribe(onTick: () => void) {
  const interval = window.setInterval(onTick, 1000)
  return () => window.clearInterval(interval)
}

const getSnapshot = () => Math.floor(Date.now() / 1000)

/** No servidor e na hidratação não há "agora" confiável: mostra "--". */
const getServerSnapshot = () => null

const pad = (value: number) => String(value).padStart(2, "0")

/**
 * Contagem regressiva sem animação (só troca os números a cada segundo).
 * Os dígitos ficam ocultos para leitores de tela, que recebem a data-alvo
 * por extenso — anunciar cada segundo seria ruído.
 */
export function Countdown({
  until,
  caption,
  expiredMessage,
  tone = "surface",
  size = "lg",
  className,
}: {
  /** ISO 8601. */
  until: string
  /** Ex.: "As vendas abrem em" — completado com a data. */
  caption: string
  expiredMessage: string
  tone?: LandingTone
  size?: "lg" | "md"
  className?: string
}) {
  const nowSeconds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const target = Date.parse(until)

  if (Number.isNaN(target)) return null

  const remaining = nowSeconds === null ? null : Math.max(0, Math.floor(target / 1000) - nowSeconds)
  const dateLabel = formatDateTime(until)

  if (remaining === 0) {
    return (
      <p className={cn("text-lg leading-snug font-semibold text-balance", className)}>
        {expiredMessage}
      </p>
    )
  }

  const units: { label: string; value: string }[] = [
    {
      label: "dias",
      value: remaining === null ? "--" : String(Math.floor(remaining / 86400)),
    },
    {
      label: "horas",
      value: remaining === null ? "--" : pad(Math.floor((remaining % 86400) / 3600)),
    },
    {
      label: "min",
      value: remaining === null ? "--" : pad(Math.floor((remaining % 3600) / 60)),
    },
    { label: "seg", value: remaining === null ? "--" : pad(remaining % 60) },
  ]

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="sr-only">
        {caption} {dateLabel}.
      </p>
      <div aria-hidden="true" className="flex items-stretch">
        {units.map((unit, index) => (
          <div
            key={unit.label}
            className={cn(
              "flex min-w-0 flex-col pe-4 @xl:pe-6",
              index > 0 && "border-s border-current/25 ps-4 @xl:ps-6"
            )}
          >
            <span
              className={cn(
                lpDisplayFont,
                "leading-none font-extrabold tracking-tight tabular-nums",
                size === "lg"
                  ? "text-[2.75rem] @xl:text-[4.25rem]"
                  : "text-[2rem] @xl:text-[2.5rem]"
              )}
            >
              {unit.value}
            </span>
            <span className="mt-1 text-sm">{unit.label}</span>
          </div>
        ))}
      </div>
      <p aria-hidden="true" className={cn("text-sm", toneMuted[tone])}>
        {caption} {dateLabel}
      </p>
    </div>
  )
}
