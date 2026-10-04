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
  formatChartPercent,
  toChartNumber,
} from "@/components/painel/chart-tooltip-row"
import type { LeadsFunnelBar, LeadsFunnelChart } from "@/lib/painel/charts"

const config = {
  total: { label: "Leads", color: "var(--chart-1)" },
} satisfies ChartConfig

/**
 * Funil por etapa em barras horizontais: a etapa é lida no eixo, então o
 * gráfico não depende da cor para ser entendido. Uma cor só, porque quem separa
 * as etapas é o rótulo — cores diferentes sugeririam um significado que não existe.
 */
export function LeadsFunnelChartView({ data }: { data: LeadsFunnelChart }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <BarChart
        data={data.bars}
        layout="vertical"
        margin={{ top: 4, right: 40, left: 0, bottom: 16 }}
      >
        <CartesianGrid horizontal={false} />
        <XAxis
          type="number"
          dataKey="total"
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => formatChartInteger(toChartNumber(value))}
          label={{
            value: `Leads criados nos últimos ${data.days} dias`,
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
              hideLabel
              formatter={(value, _name, item) => {
                const bar = item.payload as LeadsFunnelBar | undefined

                return (
                  <ChartTooltipRow
                    color="var(--color-total)"
                    label={bar?.label ?? "Etapa"}
                    value={formatChartInteger(toChartNumber(value))}
                    hint={
                      bar && data.total > 0
                        ? `${formatChartPercent(bar.share)} dos leads do período`
                        : undefined
                    }
                  />
                )
              }}
            />
          }
        />
        <Bar dataKey="total" fill="var(--color-total)" radius={[0, 4, 4, 0]}>
          <LabelList
            dataKey="totalLabel"
            position="right"
            offset={8}
            className="fill-muted-foreground"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
