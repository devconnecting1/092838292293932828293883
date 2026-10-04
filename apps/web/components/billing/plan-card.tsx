import { CheckIcon } from "lucide-react"

import { formatBRL, PLANS, type BillingInterval, type PlanKey } from "@workspace/core/billing"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { cn } from "@workspace/ui/lib/utils"

import {
  monthlyEquivalent,
  planFootnotes,
  planIncrements,
  previousPlan,
  seatsSummary,
  type AnnualSavings,
  type PlanPricing,
} from "@/components/billing/plan-content"

type PlanCardProps = {
  plan: PlanKey
  interval: BillingInterval
  pricing: PlanPricing
  /** Economia do anual deste plano (nunca preço antigo riscado). */
  savings?: AnnualSavings
  /** Plano da imobiliária escolhida (selo "Plano atual"). */
  current?: boolean
  /** Botão principal, no topo do cartão. */
  action?: React.ReactNode
  headingLevel?: "h2" | "h3"
}

/**
 * Coluna de plano: nome, para quem é, botão, preço, o que acrescenta ao plano
 * anterior e notas de uso. Sem estado: o período e o botão vêm de quem usa.
 */
export function PlanCard({
  plan,
  interval,
  pricing,
  savings,
  current = false,
  action,
  headingLevel: Heading = "h3",
}: PlanCardProps) {
  const details = PLANS[plan]
  const previous = previousPlan(plan)
  const benefits = planIncrements(plan)
  const headingId = `plano-${plan}`
  const listHeadingId = `plano-${plan}-itens`

  return (
    <Card
      role="group"
      aria-labelledby={headingId}
      className={cn("h-full", details.highlight && "ring-2 ring-primary")}
    >
      <CardHeader>
        <CardTitle className="text-lg">
          <Heading id={headingId}>{details.name}</Heading>
        </CardTitle>
        <CardDescription className="md:min-h-[2lh] xl:min-h-[3lh]">
          {details.audience}
        </CardDescription>
        {current || details.highlight ? (
          <CardAction>
            {current ? (
              <Badge>Plano atual</Badge>
            ) : (
              <Badge variant="secondary">Mais escolhido</Badge>
            )}
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5">
        {action ? <div className="flex flex-col empty:hidden">{action}</div> : null}

        <div className="flex flex-col gap-1">
          <p className="flex items-baseline gap-1">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">
              {formatBRL(monthlyEquivalent(pricing, interval), { omitZeroCents: true })}
            </span>
            <span className="text-muted-foreground">/mês</span>
          </p>
          <p className="text-muted-foreground">
            {interval === "year"
              ? `${formatBRL(pricing.price, { omitZeroCents: true })} cobrados anualmente`
              : "Cobrança mensal, sem fidelidade"}
          </p>
          {/* Economia real do anual contra o mensal VIGENTE. Nunca preço antigo
              riscado: reajuste não é desconto. */}
          {savings && savings.savings > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
              <Badge variant="secondary">
                Economia de {formatBRL(savings.savings, { omitZeroCents: true })}/ano
              </Badge>
              <span>
                {interval === "year"
                  ? `contra ${formatBRL(savings.monthlyPerYear, { omitZeroCents: true })} pagando mês a mês`
                  : `no anual sai ${formatBRL(savings.monthlyEquivalent)}/mês`}
              </span>
            </p>
          ) : null}
          <p className="text-muted-foreground md:min-h-[2lh]">
            {seatsSummary(plan, pricing, interval)}
          </p>
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <p id={listHeadingId} className="text-muted-foreground">
            {previous ? `Tudo do plano ${PLANS[previous].name}, mais:` : "Inclui:"}
          </p>
          <ul className="flex flex-col gap-2.5" aria-labelledby={listHeadingId}>
            {benefits.map((benefit) => (
              <li key={benefit.text} className="flex items-start gap-2">
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {benefit.text}
                  {benefit.status === "soon" ? <Badge variant="outline">Em breve</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>

      <CardFooter className="flex-col items-start gap-1 text-muted-foreground">
        {planFootnotes(plan).map((note) => (
          <p key={note}>{note}</p>
        ))}
      </CardFooter>
    </Card>
  )
}
