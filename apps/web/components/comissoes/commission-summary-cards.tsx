import { formatBRL } from "@workspace/core/billing/format"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import type { CommissionSummary } from "@/lib/comissoes/queries"

const numberFormat = new Intl.NumberFormat("pt-BR")

/** A receber, recebido e quantos negócios entraram na conta. */
export function CommissionSummaryCards({
  summary,
  scope,
}: {
  summary: CommissionSummary
  /** "mine" = só as partes da pessoa; "all" = a imobiliária inteira. */
  scope: "mine" | "all"
}) {
  const cards = [
    {
      label: "A receber",
      value: formatBRL(summary.pendingCents),
      hint: scope === "mine" ? "Suas partes ainda não pagas" : "Partes ainda não pagas da equipe",
    },
    {
      label: "Já recebido",
      value: formatBRL(summary.paidCents),
      hint: scope === "mine" ? "Suas partes já pagas" : "Partes já pagas da equipe",
    },
    {
      label: "Negócios",
      value: numberFormat.format(summary.deals),
      hint: scope === "mine" ? "Negócios em que você entrou" : "Negócios fechados com comissão",
    },
  ]

  return (
    <div className="grid gap-4 @min-[40rem]/page:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.label} className="@container/card">
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {card.value}
            </CardTitle>
          </CardHeader>
          <CardFooter className="text-muted-foreground">{card.hint}</CardFooter>
        </Card>
      ))}
    </div>
  )
}
