"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"

import {
  ChartTooltipRow,
  formatChartInteger,
  toChartNumber,
} from "@/components/painel/chart-tooltip-row"
import type { LeadsWeeklyChart, LeadsWeeklyPoint } from "@/lib/painel/charts"

const AXIS_LABEL_CLASS = "fill-muted-foreground"
const BAR_RADIUS = 3

/** Canto arredondado só nas pontas da pilha (base embaixo, topo em cima). */
function barRadius(index: number, count: number): [number, number, number, number] {
  if (count === 1) {
    return [BAR_RADIUS, BAR_RADIUS, BAR_RADIUS, BAR_RADIUS]
  }

  if (index === 0) {
    return [0, 0, BAR_RADIUS, BAR_RADIUS]
  }

  if (index === count - 1) {
    return [BAR_RADIUS, BAR_RADIUS, 0, 0]
  }

  return [0, 0, 0, 0]
}

/**
 * Captação por semana, empilhada por origem. Barra (e não linha) porque cada
 * semana é um balde fechado: interpolar entre semanas sugeriria um fluxo
 * contínuo que não existe. A pilha responde de onde vêm os leads.
 */
export function LeadsWeeklyChartView({ data }: { data: LeadsWeeklyChart }) {
  const config: ChartConfig = Object.fromEntries(
    data.series.map((item) => [item.key, { label: item.label, color: item.color }])
  )

  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <BarChart data={data.points} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={12}
          label={{
            value: "Semana (segunda a domingo)",
            position: "insideBottom",
            offset: -12,
            className: AXIS_LABEL_CLASS,
          }}
        />
        <YAxis
          width={44}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tickFormatter={(value) => formatChartInteger(toChartNumber(value))}
          label={{
            value: "Leads",
            angle: -90,
            position: "insideLeft",
            className: AXIS_LABEL_CLASS,
          }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as LeadsWeeklyPoint | undefined
                return point ? `Semana de ${point.rangeLabel}` : ""
              }}
              formatter={(value, name, item) => (
                <ChartTooltipRow
                  color={item.color}
                  label={config[String(name)]?.label ?? String(name)}
                  value={formatChartInteger(toChartNumber(value))}
                />
              )}
            />
          }
        />
        {/* itemSorter null: a legenda segue a ordem das séries (a maior na base da pilha). */}
        <ChartLegend verticalAlign="top" itemSorter={null} content={<ChartLegendContent />} />
        {data.series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            stackId="leads"
            fill={`var(--color-${item.key})`}
            radius={barRadius(index, data.series.length)}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
