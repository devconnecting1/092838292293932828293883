"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"

import { Badge } from "@workspace/ui/components/badge"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import {
  DEFAULT_PROPERTY_DETAIL_TAB,
  isPropertyDetailTab,
  type PropertyDetailTab,
} from "@/components/imoveis/detail/tabs"

export type PropertyDetailTabItem = {
  value: PropertyDetailTab
  label: string
  count?: number
}

/**
 * Abas da ficha controladas pela query `?aba=`. Trocar de aba só reescreve a
 * URL (history.replaceState), sem refazer as consultas do servidor.
 */
export function PropertyDetailTabs({
  tabs,
  children,
}: {
  tabs: PropertyDetailTabItem[]
  children: React.ReactNode
}) {
  const searchParams = useSearchParams()
  const requested = searchParams.get("aba")
  // Abas escondidas por papel (Histórico) não valem nem vindas pela URL.
  const value =
    isPropertyDetailTab(requested) && tabs.some((tab) => tab.value === requested)
      ? requested
      : DEFAULT_PROPERTY_DETAIL_TAB

  function handleValueChange(next: unknown) {
    if (!isPropertyDetailTab(next)) return

    const params = new URLSearchParams(searchParams.toString())
    if (next === DEFAULT_PROPERTY_DETAIL_TAB) {
      params.delete("aba")
    } else {
      params.set("aba", next)
    }

    const query = params.toString()
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }

  return (
    <Tabs value={value} onValueChange={handleValueChange} className="gap-4">
      <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              {tab.count ? (
                <Badge variant="secondary" className="tabular-nums">
                  {tab.count}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {children}
    </Tabs>
  )
}
