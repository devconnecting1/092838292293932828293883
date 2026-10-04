"use client"

import { Badge } from "@workspace/ui/components/badge"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { useFilterParams } from "@/components/propostas/use-filter-params"

export type StatusTabItem = {
  value: string
  label: string
  count: number
}

const ALL = "all"

/** Abas de status com contagem, gravadas em ?status= (propostas e captações). */
export function StatusTabs({
  items,
  allLabel,
  allCount,
}: {
  items: StatusTabItem[]
  allLabel: string
  allCount: number
}) {
  const { searchParams, setParams } = useFilterParams()
  const current = searchParams.get("status")
  const value = items.some((item) => item.value === current) && current ? current : ALL

  return (
    <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <Tabs
        value={value}
        onValueChange={(next) => setParams({ status: next === ALL ? null : String(next) })}
      >
        <TabsList>
          <TabsTrigger value={ALL}>
            {allLabel}
            <Badge variant="secondary">{allCount}</Badge>
          </TabsTrigger>
          {items.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
              <Badge variant="secondary">{item.count}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
