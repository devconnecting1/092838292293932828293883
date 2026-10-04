"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import type { ReportPeriod } from "@workspace/core/reports/period"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { buildReportHref, isReportTab, REPORT_TAB_LABELS, REPORT_TABS } from "@/lib/relatorios/url"
import type { ReportTab } from "@/lib/relatorios/url"

/**
 * Abas do relatório. Só a barra: o conteúdo é renderizado no servidor, pela
 * aba que está na URL — assim o link abre direto no relatório certo e a
 * consulta pesada não roda para as abas que ninguém está olhando.
 */
export function ReportTabs({
  tab,
  period,
  broker,
  team,
  month,
}: {
  tab: ReportTab
  period: ReportPeriod
  broker: string | null
  team: string | null
  month: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [selected, setOptimisticTab] = React.useOptimistic(tab)

  return (
    <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0" aria-busy={isPending || undefined}>
      <Tabs
        value={selected}
        onValueChange={(value) => {
          if (!isReportTab(value)) {
            return
          }

          startTransition(() => {
            setOptimisticTab(value)
            router.replace(
              buildReportHref({
                preset: period.preset,
                from: period.fromDay,
                to: period.toDay,
                broker,
                team,
                month,
                tab: value,
              }),
              { scroll: false }
            )
          })
        }}
      >
        <TabsList>
          {REPORT_TABS.map((item) => (
            <TabsTrigger key={item} value={item}>
              {REPORT_TAB_LABELS[item]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
