"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRightIcon, MinusIcon, PiggyBankIcon, PlusIcon, SparklesIcon } from "lucide-react"

import {
  formatBRL,
  OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT,
  PLAN_KEYS,
  PLANS,
  recommendPlan,
  TRIAL_DAYS,
} from "@workspace/core/billing"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Separator } from "@workspace/ui/components/separator"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { PlanActionButton } from "@/components/billing/plan-action-button"
import {
  annualRuleText,
  annualSavings,
  pluralize,
  resolvePlanPricing,
  signUpHref,
  totalWithSeats,
  type CatalogPrices,
} from "@/components/billing/plan-content"
import { useOptionalPricing } from "@/components/billing/pricing-provider"

const MAX_TEAM_SIZE = 500

const integer = new Intl.NumberFormat("pt-BR")

/**
 * Faixas de imóveis com foto nas bordas do limite de cada plano (5, 20, 50,
 * 150): cada resposta cabe inteira num plano, e "Mais de 150" mostra que nenhum
 * comporta. O valor é o topo da faixa, que é o que o core compara com o limite.
 */
const LISTING_LIMITS = [
  ...new Set(
    PLAN_KEYS.map((plan) => PLANS[plan].limits.owned_listings).filter((limit) => limit > 0)
  ),
].sort((a, b) => a - b)

const LARGEST_LISTING_LIMIT = LISTING_LIMITS.at(-1) ?? 0

const LISTING_OPTIONS = [
  ...LISTING_LIMITS.map((limit, index) => {
    const previous = LISTING_LIMITS[index - 1]
    return {
      value: String(limit),
      label:
        previous === undefined
          ? `Até ${integer.format(limit)}`
          : `${integer.format(previous + 1)} a ${integer.format(limit)}`,
    }
  }),
  {
    value: String(LARGEST_LISTING_LIMIT + 1),
    label: `Mais de ${integer.format(LARGEST_LISTING_LIMIT)}`,
  },
]

/** Começa na segunda faixa (6 a 20), a de uma imobiliária pequena. */
const DEFAULT_LISTING_OPTION = LISTING_OPTIONS[1]?.value ?? String(LARGEST_LISTING_LIMIT)

function isListingOption(value: unknown): value is string {
  return LISTING_OPTIONS.some((option) => option.value === value)
}

function parseTeamSize(value: string) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.min(MAX_TEAM_SIZE, Math.max(1, parsed)) : 1
}

export function PlanRecommender({ prices }: { prices: CatalogPrices }) {
  const pricing = useOptionalPricing()
  const teamSizeId = React.useId()
  const [teamSizeInput, setTeamSizeInput] = React.useState("3")
  const [doesRentals, setDoesRentals] = React.useState(false)
  const [listings, setListings] = React.useState(DEFAULT_LISTING_OPTION)

  const teamSize = parseTeamSize(teamSizeInput)
  const recommendation = recommendPlan({ teamSize, ownedListings: Number(listings) })
  const plan = PLANS[recommendation.plan]
  const { extraSeats } = recommendation
  const monthly = resolvePlanPricing(prices, recommendation.plan, "month")
  const yearly = resolvePlanPricing(prices, recommendation.plan, "year")
  const monthlyTotal = totalWithSeats(monthly, extraSeats)
  const yearlyTotal = totalWithSeats(yearly, extraSeats)
  const savings = annualSavings(monthlyTotal, yearlyTotal)

  const aiConversations = plan.limits.ai_conversations
  const rentalContracts = plan.limits.rental_contracts
  const reasons = [...recommendation.reasons]

  // Locação e IA ainda estão em construção: informam, mas não mudam o plano
  // sugerido (recomendar plano mais caro por recurso "em breve" seria vender o
  // que não entregamos).
  if (doesRentals) {
    reasons.push(
      rentalContracts === 0
        ? `A locação ainda está em construção. No plano ${plan.name}, ela virá como adicional.`
        : rentalContracts < 0
          ? "A locação ainda está em construção; quando chegar, os contratos não terão limite neste plano."
          : `A locação ainda está em construção; quando chegar, este plano inclui ${pluralize(rentalContracts, "contrato ativo", "contratos ativos")}.`
    )
  }

  if (aiConversations > 0) {
    reasons.push(
      `${pluralize(aiConversations, "conversa", "conversas")} de IA no WhatsApp por mês (em breve). O teste grátis não inclui a IA: ela começa quando você assina.`
    )
  }

  function stepTeamSize(delta: number) {
    setTeamSizeInput(String(parseTeamSize(String(teamSize + delta))))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>
            <h3>Conte sobre a sua operação</h3>
          </CardTitle>
          <CardDescription>Três respostas rápidas. A sugestão muda na hora.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={teamSizeId}>Quantas pessoas vão usar o CRM?</FieldLabel>
              <InputGroup className="w-40">
                <InputGroupAddon align="inline-start">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Diminuir uma pessoa"
                    disabled={teamSize <= 1}
                    onClick={() => stepTeamSize(-1)}
                  >
                    <MinusIcon />
                  </InputGroupButton>
                </InputGroupAddon>
                <InputGroupInput
                  id={teamSizeId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_TEAM_SIZE}
                  value={teamSizeInput}
                  onChange={(event) => setTeamSizeInput(event.target.value)}
                  onBlur={() => setTeamSizeInput(String(teamSize))}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Aumentar uma pessoa"
                    disabled={teamSize >= MAX_TEAM_SIZE}
                    onClick={() => stepTeamSize(1)}
                  >
                    <PlusIcon />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>Corretores, gerentes, assistentes e financeiro.</FieldDescription>
            </Field>

            <FieldSet>
              <FieldLegend>A imobiliária faz locação?</FieldLegend>
              <ToggleGroup
                aria-label="A imobiliária faz locação?"
                variant="outline"
                value={[doesRentals ? "sim" : "nao"]}
                onValueChange={(next) => {
                  if (next[0] === "sim" || next[0] === "nao") {
                    setDoesRentals(next[0] === "sim")
                  }
                }}
              >
                <ToggleGroupItem value="sim">Sim</ToggleGroupItem>
                <ToggleGroupItem value="nao">Não</ToggleGroupItem>
              </ToggleGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Quantos imóveis à venda ou para alugar vão ter fotos?</FieldLegend>
              <ToggleGroup
                aria-label="Quantos imóveis à venda ou para alugar vão ter fotos?"
                variant="outline"
                className="flex-wrap"
                value={[listings]}
                onValueChange={(next) => {
                  if (isListingOption(next[0])) {
                    setListings(next[0])
                  }
                }}
              >
                {LISTING_OPTIONS.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>
                Só contam imóveis com fotos hospedadas por aqui, inclusive as trazidas por link na
                importação de planilhas. Imóveis sem foto, só com fotos no site de origem,{" "}
                {OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT} ficam de fora.
              </FieldDescription>
            </FieldSet>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Plano sugerido</CardDescription>
          <CardTitle>
            <h3 className="text-xl font-semibold">{plan.name}</h3>
          </CardTitle>
          <CardAction>
            <Badge variant="secondary">
              <SparklesIcon data-icon="inline-start" />
              Sugestão
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <p className="sr-only" aria-live="polite">
            {`Plano sugerido: ${plan.name}, ${formatBRL(monthlyTotal, { omitZeroCents: true })} por mês.`}
            {savings.savings > 0
              ? ` No anual, ${formatBRL(savings.monthlyEquivalent)} por mês, com economia de ${formatBRL(savings.savings, { omitZeroCents: true })} por ano.`
              : ""}
          </p>
          <div className="flex flex-col gap-2">
            <p className="font-medium">Por que este plano</p>
            <ul className="flex list-disc flex-col gap-1 ps-5 text-muted-foreground">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>

          <Separator />

          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Plano {plan.name}</dt>
            <dd className="text-end tabular-nums">
              {formatBRL(monthly.price, { omitZeroCents: true })}/mês
            </dd>
            {extraSeats > 0 ? (
              <>
                <dt className="text-muted-foreground">
                  {pluralize(extraSeats, "usuário extra", "usuários extras")}
                </dt>
                <dd className="text-end tabular-nums">
                  {extraSeats} × {formatBRL(monthly.seatPrice, { omitZeroCents: true })}/mês
                </dd>
              </>
            ) : null}
            <dt className="font-medium">Total mensal</dt>
            <dd className="text-end font-medium tabular-nums">
              {formatBRL(monthlyTotal, { omitZeroCents: true })}/mês
            </dd>
            <dt className="text-muted-foreground">No anual</dt>
            <dd className="text-end tabular-nums">
              {formatBRL(yearlyTotal, { omitZeroCents: true })}/ano
            </dd>
            <dt className="text-muted-foreground">Equivale a</dt>
            <dd className="text-end tabular-nums">{formatBRL(savings.monthlyEquivalent)}/mês</dd>
          </dl>

          {/* A economia do anual em destaque, sempre contra o mensal vigente
              deste mesmo plano: nada de preço antigo riscado. */}
          {savings.savings > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
              <Badge variant="secondary">
                <PiggyBankIcon data-icon="inline-start" />
                Economia de {formatBRL(savings.savings, { omitZeroCents: true })}/ano
              </Badge>
              <span>{annualRuleText(savings)}</span>
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          {/* Com conta conectada (/planos logado), o mesmo botão dos cartões: assinar ou trocar. */}
          {pricing?.account ? (
            <PlanActionButton
              plan={recommendation.plan}
              size="default"
              className="w-full sm:w-auto"
            />
          ) : (
            <Button
              className="w-full sm:w-auto"
              render={<Link href={signUpHref(recommendation.plan)} />}
              nativeButton={false}
            >
              Testar o {plan.name} por {TRIAL_DAYS} dias
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
