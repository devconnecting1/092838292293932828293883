"use client"

import * as React from "react"
import { CheckIcon, InfoIcon, MinusIcon } from "lucide-react"

import {
  AI_OVERAGE_NOTE,
  AI_PLAN_NOTE,
  FEATURE_GROUPS,
  FEATURE_KEYS,
  FEATURES,
  formatBRL,
  formatLimit,
  IMPORTED_LISTINGS_NOTE,
  LIMIT_KEYS,
  LIMITS,
  LISTING_PHOTO_MAX_MB,
  LISTING_PHOTO_SIZE_NOTE,
  maxExtraSeats,
  OWNED_LISTINGS_NOTE,
  PLAN_KEYS,
  PLANS,
  THIRD_PARTY_ACCOUNTS_NOTE,
  WHATSAPP_BILLING_NOTE,
  type LimitKey,
  type PlanKey,
} from "@workspace/core/billing"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { PlanActionButton } from "@/components/billing/plan-action-button"
import {
  monthlyEquivalent,
  resolvePlanPricing,
  type CatalogPrices,
} from "@/components/billing/plan-content"
import { currentPaidPlan } from "@/components/billing/pricing-account"
import { usePricing } from "@/components/billing/pricing-provider"

type Cell = { kind: "text"; text: string } | { kind: "included"; included: boolean }

type ComparisonRow = {
  id: string
  label: string
  soon: boolean
  /** Explicação da linha (dica acessível por clique, toque, teclado e mouse). */
  description?: string
  cells: Record<PlanKey, Cell>
}

type ComparisonGroup = { title: string; rows: ComparisonRow[] }

function byPlan(build: (plan: PlanKey) => Cell): Record<PlanKey, Cell> {
  return Object.fromEntries(PLAN_KEYS.map((plan) => [plan, build(plan)])) as Record<PlanKey, Cell>
}

function text(value: string): Cell {
  return { kind: "text", text: value }
}

function sentence(value: string) {
  return value.endsWith(".") ? value : `${value}.`
}

function limitText(key: LimitKey, value: number) {
  // Locação no Corretor é vendida só como adicional.
  if (key === "rental_contracts" && value === 0) {
    return "Adicional"
  }

  return formatLimit(value, LIMITS[key].unit)
}

/** Regras do catálogo que explicam cada limite (só as que existem no core). */
const LIMIT_DESCRIPTIONS: Partial<Record<LimitKey, string>> = {
  owned_listings: sentence(OWNED_LISTINGS_NOTE),
  photos_per_listing: sentence(LISTING_PHOTO_SIZE_NOTE),
  ai_conversations: `${sentence(AI_PLAN_NOTE)} ${sentence(AI_OVERAGE_NOTE)}`,
  whatsapp_numbers: sentence(WHATSAPP_BILLING_NOTE),
  rental_contracts: sentence(THIRD_PARTY_ACCOUNTS_NOTE),
  esign_docs: sentence(THIRD_PARTY_ACCOUNTS_NOTE),
}

function buildGroups(prices: CatalogPrices): ComparisonGroup[] {
  const limitRows: ComparisonRow[] = [
    {
      // Só o que o banco não limita. Imóvel com foto tem linha própria (limit-owned_listings).
      id: "records",
      label: "Clientes, condomínios e imóveis sem foto ou só com fotos no site de origem",
      soon: false,
      description: sentence(IMPORTED_LISTINGS_NOTE),
      cells: byPlan(() => text("Sem limite")),
    },
    ...LIMIT_KEYS.map((key) => ({
      id: `limit-${key}`,
      label: key === "users" ? "Usuários incluídos" : LIMITS[key].label,
      soon: LIMITS[key].status === "soon",
      description: LIMIT_DESCRIPTIONS[key],
      cells: byPlan((plan) => text(limitText(key, PLANS[plan].limits[key]))),
    })),
    {
      // Igual em todos os planos: não é chave de `limits`, é constante do produto.
      id: "photo-size",
      label: "Tamanho máximo por foto",
      soon: false,
      description: sentence(LISTING_PHOTO_SIZE_NOTE),
      cells: byPlan(() => text(`${LISTING_PHOTO_MAX_MB} MB`)),
    },
    {
      id: "seat",
      label: "Usuário extra",
      soon: false,
      cells: byPlan((plan) => {
        const max = maxExtraSeats(plan)
        const price = `${formatBRL(resolvePlanPricing(prices, plan, "month").seatPrice, {
          omitZeroCents: true,
        })}/mês`

        if (max === 0) return text("Não incluso")
        return text(Number.isFinite(max) ? `${price} (até ${max})` : price)
      }),
    },
  ]

  const featureGroups = FEATURE_GROUPS.map((group) => ({
    title: group,
    rows: FEATURE_KEYS.filter((key) => FEATURES[key].group === group).map((key) => {
      const feature = FEATURES[key]

      return {
        id: key,
        label: feature.label,
        soon: feature.status === "soon",
        description: feature.description,
        cells: byPlan((plan) => {
          const note = feature.notes?.[plan]
          return note ? text(note) : { kind: "included", included: feature.plans.includes(plan) }
        }),
      } satisfies ComparisonRow
    }),
  })).filter((group) => group.rows.length > 0)

  return [{ title: "Limites e usuários", rows: limitRows }, ...featureGroups]
}

function CellValue({ cell }: { cell: Cell }) {
  if (cell.kind === "text") {
    return <span>{cell.text}</span>
  }

  return cell.included ? (
    <>
      <CheckIcon aria-hidden="true" className="size-4 text-primary" />
      <span className="sr-only">Incluso</span>
    </>
  ) : (
    <>
      <MinusIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      <span className="sr-only">Não incluso</span>
    </>
  )
}

/**
 * Dica da linha. Popover (e não Tooltip) porque a dica do Base UI não abre no
 * toque nem é lida por leitor de tela: aqui abre com clique, toque, Enter/Espaço
 * e ao passar o mouse, e fecha com Esc.
 */
function RowInfo({ label, description }: { label: string; description: string }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="-my-1 ms-0.5 align-middle"
          />
        }
        aria-label={`Sobre: ${label}`}
      >
        <InfoIcon className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start">
        <PopoverHeader>
          <PopoverTitle>{label}</PopoverTitle>
          <PopoverDescription>{description}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  )
}

/** Texto corrido: o selo e o ícone de informação ficam colados à última palavra. */
function RowLabel({ row }: { row: ComparisonRow }) {
  return (
    <span>
      {row.label}
      {row.soon ? (
        <Badge variant="outline" className="ms-1.5 align-middle">
          Em breve
        </Badge>
      ) : null}
      {row.description ? <RowInfo label={row.label} description={row.description} /> : null}
    </span>
  )
}

function PlanPrice({ plan }: { plan: PlanKey }) {
  const { prices, interval } = usePricing()
  const pricing = resolvePlanPricing(prices, plan, interval)

  return (
    <p className="flex items-baseline gap-0.5">
      <span className="text-lg font-semibold tracking-tight tabular-nums">
        {formatBRL(monthlyEquivalent(pricing, interval), { omitZeroCents: true })}
      </span>
      <span className="text-muted-foreground">/mês</span>
    </p>
  )
}

/**
 * Tabela completa com o cabeçalho dos planos fixo ao rolar (a partir de 1024 px)
 * e, no celular, um plano por vez escolhido num seletor fixo, sem rolagem lateral.
 */
export function PlanComparison() {
  const { prices, account } = usePricing()
  const groups = React.useMemo(() => buildGroups(prices), [prices])
  const current = currentPaidPlan(account?.billing ?? null)
  const highlighted = PLAN_KEYS.find((plan) => PLANS[plan].highlight) ?? PLAN_KEYS[0] ?? "corretor"
  const [mobilePlan, setMobilePlan] = React.useState<PlanKey>(current ?? highlighted)
  const selectId = React.useId()
  const items = PLAN_KEYS.map((plan) => ({ value: plan, label: PLANS[plan].name }))

  return (
    <>
      {/*
        <table> sem o wrapper do componente Table: o contêiner com overflow dele
        prenderia o `sticky` do cabeçalho dentro da tabela em vez da página.
        border-separate: com bordas colapsadas, a borda do cabeçalho fixo some ao rolar.
      */}
      <table className="hidden w-full table-fixed border-separate border-spacing-0 text-sm lg:table">
        <caption className="sr-only">Comparação de limites e recursos entre os planos</caption>
        <colgroup>
          <col className="w-[31%]" />
          {PLAN_KEYS.map((plan) => (
            <col key={plan} />
          ))}
        </colgroup>
        <thead className="sticky top-14 z-10 bg-background">
          <tr>
            <th scope="col" className="border-b p-3 text-start align-bottom font-normal">
              <span className="text-muted-foreground">Recursos por plano</span>
            </th>
            {PLAN_KEYS.map((plan) => (
              <th key={plan} scope="col" className="border-b p-3 text-start align-top font-normal">
                <div className="flex flex-col gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-medium">{PLANS[plan].name}</span>
                    {plan === current ? <Badge>Plano atual</Badge> : null}
                  </span>
                  <PlanPrice plan={plan} />
                  <PlanActionButton plan={plan} size="sm" className="w-full" />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.title}>
            <tr>
              <th
                scope="colgroup"
                colSpan={PLAN_KEYS.length + 1}
                className="border-b px-3 pt-8 pb-2 text-start text-base font-medium"
              >
                {group.title}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-muted/50">
                <th scope="row" className="border-b p-3 text-start align-middle font-normal">
                  <RowLabel row={row} />
                </th>
                {PLAN_KEYS.map((plan) => (
                  <td key={plan} className="border-b p-3 align-middle">
                    <span className="inline-flex items-center">
                      <CellValue cell={row.cells[plan]} />
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      <div className="flex flex-col gap-6 lg:hidden">
        <div className="sticky top-14 z-10 -mx-4 border-b bg-background px-4 py-3">
          <div className="flex items-end justify-between gap-3">
            <Field className="w-auto min-w-0 flex-1">
              <FieldLabel htmlFor={selectId}>Plano para comparar</FieldLabel>
              <Select
                items={items}
                value={mobilePlan}
                onValueChange={(value) => {
                  if (value) setMobilePlan(value)
                }}
              >
                <SelectTrigger id={selectId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {mobilePlan === current ? <Badge>Plano atual</Badge> : null}
              <PlanPrice plan={mobilePlan} />
            </div>
          </div>
        </div>

        <PlanActionButton plan={mobilePlan} className="w-full" />

        {groups.map((group) => (
          <table key={group.title} className="w-full table-fixed text-sm">
            <caption className="pb-2 text-start text-base font-medium">{group.title}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Recurso</th>
                <th scope="col">Plano {PLANS[mobilePlan].name}</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.id}>
                  <th
                    scope="row"
                    className="border-b py-3 pe-3 text-start align-middle font-normal"
                  >
                    <RowLabel row={row} />
                  </th>
                  <td className="w-[38%] border-b py-3 text-end align-middle">
                    <span className="inline-flex items-center justify-end">
                      <CellValue cell={row.cells[mobilePlan]} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </>
  )
}
