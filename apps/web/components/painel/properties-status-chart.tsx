"use client"

import { Cell, Pie, PieChart } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"

import {
  ChartTooltipRow,
  formatChartCurrency,
  formatChartInteger,
  toChartNumber,
} from "@/components/painel/chart-tooltip-row"
import type { PropertiesStatusChart, PropertiesStatusSlice } from "@/lib/painel/charts"

/** Valor da carteira daquele status, em R$, para a segunda linha do tooltip. */
function sliceHint(slice: PropertiesStatusSlice) {
  const parts: string[] = []

  if (slice.saleValue > 0) {
    parts.push(`${formatChartCurrency(slice.saleValue)} em venda`)
  }

  if (slice.rentValue > 0) {
    parts.push(`${formatChartCurrency(slice.rentValue)}/mês em locação`)
  }

  return parts.length > 0 ? parts.join(" · ") : undefined
}

/**
 * Carteira por status, em rosca. A legenda com nome, quantidade e valor fica
 * fora do gráfico (no cartão), renderizada no servidor: ela é a leitura
 * acessível da rosca e não depende de JavaScript.
 */
export function PropertiesStatusChartView({ data }: { data: PropertiesStatusChart }) {
  const config: ChartConfig = Object.fromEntries(
    data.slices.map((slice) => [slice.status, { label: slice.label, color: slice.color }])
  )

  return (
    <ChartContainer config={config} className="mx-auto aspect-square h-56 w-full max-w-56">
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => {
                const slice = item.payload as PropertiesStatusSlice | undefined

                return (
                  <ChartTooltipRow
                    color={slice ? `var(--color-${slice.status})` : undefined}
                    label={slice?.label ?? "Status"}
                    value={formatChartInteger(toChartNumber(value))}
                    hint={slice ? sliceHint(slice) : undefined}
                  />
                )
              }}
            />
          }
        />
        <Pie
          data={data.slices}
          dataKey="total"
          nameKey="status"
          innerRadius="56%"
          outerRadius="86%"
          paddingAngle={2}
          strokeWidth={1}
        >
          {data.slices.map((slice) => (
            <Cell key={slice.status} fill={`var(--color-${slice.status})`} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  )
}
