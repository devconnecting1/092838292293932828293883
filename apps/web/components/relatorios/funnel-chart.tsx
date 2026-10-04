"use client"

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"

import {
  ChartTooltipRow,
  formatChartInteger,
  toChartNumber,
} from "@/components/painel/chart-tooltip-row"

const config = {
  entered: { label: "Entradas", color: "var(--chart-1)" },
  advanced: { label: "Avançaram", color: "var(--chart-2)" },
} satisfies ChartConfig

/**
 * Ponto do gráfico. Os rótulos já chegam prontos do servidor (mesmo HTML no
 * servidor e no navegador) — quem monta é `funnelPoints`, em report-sections.
 */
export type FunnelPoint = {
  label: string
  entered: number
  advanced: number
  /** "62,5%" ou "" quando a etapa não teve entrada. */
  advanceLabel: string
  /** "1 d 12 h" — tempo mediano na fase. */
  medianLabel: string
}

/**
 * Funil em barras horizontais: cada etapa mostra quantos entraram e, por cima,
 * quantos avançaram. O rótulo ao lado é a taxa de conversão para a etapa
 * seguinte — o número que decide onde o atendimento está travando.
 */
export function FunnelChartView({ data }: { data: FunnelPoint[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-80 w-full">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 16 }}>
        <CartesianGrid horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => formatChartInteger(toChartNumber(value))}
          label={{
            value: "Entradas na etapa no período",
            position: "insideBottom",
            offset: -12,
            className: "fill-muted-foreground",
          }}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={120}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, name, item) => {
                const point = item.payload as FunnelPoint | undefined
                const isAdvanced = name === "advanced"

                return (
                  <ChartTooltipRow
                    color={isAdvanced ? "var(--color-advanced)" : "var(--color-entered)"}
                    label={isAdvanced ? "Avançaram" : "Entradas"}
                    value={formatChartInteger(toChartNumber(value))}
                    hint={
                      isAdvanced && point
                        ? `Conversão de ${point.advanceLabel || "—"} · tempo na etapa: ${point.medianLabel}`
                        : undefined
                    }
                  />
                )
              }}
            />
          }
        />
        <Bar dataKey="entered" fill="var(--color-entered)" radius={[0, 4, 4, 0]} barSize={18}>
          <LabelList
            dataKey="advanceLabel"
            position="right"
            offset={8}
            className="fill-muted-foreground"
          />
        </Bar>
        <Bar dataKey="advanced" fill="var(--color-advanced)" radius={[0, 4, 4, 0]} barSize={10} />
      </BarChart>
    </ChartContainer>
  )
}
