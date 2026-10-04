"use client"

import type { BillingInterval } from "@workspace/core/billing"
import { Badge } from "@workspace/ui/components/badge"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { ANNUAL_FREE_MONTHS, pluralize } from "@/components/billing/plan-content"

type BillingIntervalToggleProps = {
  value: BillingInterval
  onValueChange: (value: BillingInterval) => void
  disabled?: boolean
  size?: "sm" | "default" | "lg"
}

export function BillingIntervalToggle({
  value,
  onValueChange,
  disabled,
  size = "default",
}: BillingIntervalToggleProps) {
  return (
    <ToggleGroup
      aria-label="Período de cobrança"
      variant="outline"
      size={size}
      value={[value]}
      disabled={disabled}
      onValueChange={(next) => {
        const selected = next[0]

        // Um período sempre fica marcado: clicar no ativo não desmarca.
        if (selected === "month" || selected === "year") {
          onValueChange(selected)
        }
      }}
    >
      <ToggleGroupItem value="month">Mensal</ToggleGroupItem>
      <ToggleGroupItem value="year">
        Anual
        {/* Os meses grátis saem da razão entre o anual e o mensal de PLANS: se a
            regra mudar (ou variar entre planos), o selo some em vez de prometer. */}
        {ANNUAL_FREE_MONTHS ? (
          <Badge variant="secondary">
            {pluralize(ANNUAL_FREE_MONTHS, "mês grátis", "meses grátis")}
          </Badge>
        ) : null}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
