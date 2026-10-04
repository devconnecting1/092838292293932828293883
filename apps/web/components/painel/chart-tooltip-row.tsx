"use client"

import type * as React from "react"

const integerFormat = new Intl.NumberFormat("pt-BR")
const percentFormat = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
})
const currencyFormat = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
})

/** Valor do recharts (número, texto ou lista) como número seguro. */
export function toChartNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatChartInteger(value: number) {
  return integerFormat.format(value)
}

export function formatChartPercent(value: number) {
  return percentFormat.format(value)
}

export function formatChartCurrency(value: number) {
  return currencyFormat.format(value)
}

type ChartTooltipRowProps = {
  label: React.ReactNode
  value: string
  /** Segunda linha, para contexto (fatia do total, valor da carteira). */
  hint?: string
  /** Token do tema já resolvido (`var(--color-...)`). */
  color?: string
}

/**
 * Linha do tooltip dos gráficos do Painel. Existe porque o `formatter` do
 * ChartTooltipContent substitui a linha inteira, e é ele que garante os números
 * em pt-BR (o padrão do componente usa o idioma do navegador).
 */
export function ChartTooltipRow({ label, value, hint, color }: ChartTooltipRowProps) {
  return (
    <div className="flex w-full flex-col gap-0.5">
      <div className="flex w-full items-center gap-2">
        {color ? (
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: color }}
          />
        ) : null}
        <span className="flex-1 text-muted-foreground">{label}</span>
        <span className="font-mono font-medium tabular-nums">{value}</span>
      </div>
      {hint ? <span className="text-muted-foreground">{hint}</span> : null}
    </div>
  )
}
