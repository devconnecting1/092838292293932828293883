"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CircleAlertIcon, PiggyBankIcon } from "lucide-react"

import {
  BILLING_INTERVAL_LABELS,
  clampExtraSeats,
  formatBRL,
  maxExtraSeats,
  MAX_OWNED_LISTING_PACKS,
  OWNED_LISTINGS_PACK_SIZE,
  PLANS,
  type BillingInterval,
  type PlanKey,
} from "@workspace/core/billing"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Separator } from "@workspace/ui/components/separator"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { BillingIntervalToggle } from "@/components/billing/billing-interval-toggle"
import {
  annualRuleText,
  monthlyEquivalent,
  planAnnualSavings,
  pluralize,
  resolvePackPrice,
  resolvePlanPricing,
  totalWithSeats,
  type CatalogPrices,
} from "@/components/billing/plan-content"
import {
  currentExtraSeats,
  currentOwnedListingPacks,
  currentPaidPlan,
  type PricingAccount,
  type PricingBilling,
} from "@/components/billing/pricing-account"
import { parseQuantity, QuantityStepper } from "@/components/billing/quantity-stepper"
import { useBillingRedirect } from "@/components/billing/use-billing-redirect"
import { changeSubscription, startCheckout } from "@/lib/billing/actions"
import { formatDate } from "@/lib/format"

/** Teto da tela; o servidor aceita até 500 e o plano pode limitar antes (clampExtraSeats). */
const MAX_EXTRA_SEATS = 200

type Choice = { plan: PlanKey; interval: BillingInterval; extraSeats: number; packs: number }

type PlanChangeDialogProps = {
  open: boolean
  plan: PlanKey
  initialInterval: BillingInterval
  prices: CatalogPrices
  account: PricingAccount
  billing: PricingBilling
  onOpenChange: (open: boolean) => void
}

/** Custo mensal equivalente, para saber se a troca aumenta ou reduz a assinatura. */
function monthlyCost(prices: CatalogPrices, choice: Choice) {
  const total =
    totalWithSeats(resolvePlanPricing(prices, choice.plan, choice.interval), choice.extraSeats) +
    resolvePackPrice(prices, choice.interval) * choice.packs
  return choice.interval === "year" ? total / 12 : total
}

/** Mensagens de erro sobre usuários ganham o atalho para a Equipe. */
function isUsersError(message: string) {
  return /usuári|membro|convite|acesso/i.test(message)
}

/**
 * Confirmação de assinatura (Checkout da Stripe) ou de troca de plano, período e
 * usuários extras (changeSubscription), com o total antes de qualquer cobrança.
 */
export function PlanChangeDialog({
  open,
  plan,
  initialInterval,
  prices,
  account,
  billing,
  onOpenChange,
}: PlanChangeDialogProps) {
  const router = useRouter()
  const seatsId = React.useId()
  const packsId = React.useId()
  const currentPlan = currentPaidPlan(billing)
  const currentSeats = currentExtraSeats(billing)
  const currentPacks = currentOwnedListingPacks(billing)
  const hasSubscription = billing.hasSubscription
  const details = PLANS[plan]
  const seatLimit = Math.min(MAX_EXTRA_SEATS, maxExtraSeats(plan))

  const [interval, setBillingInterval] = React.useState<BillingInterval>(initialInterval)
  const [extraSeatsInput, setExtraSeatsInput] = React.useState(
    String(hasSubscription ? clampExtraSeats(plan, currentSeats) : 0)
  )
  // Os pacotes valem para qualquer plano: trocar de plano mantém os já contratados.
  const [packsInput, setPacksInput] = React.useState(String(hasSubscription ? currentPacks : 0))
  const [error, setError] = React.useState<string | null>(null)
  const [isChanging, startChange] = React.useTransition()
  const { busy, run } = useBillingRedirect()

  const extraSeats = parseQuantity(extraSeatsInput, seatLimit)
  const packs = parseQuantity(packsInput, MAX_OWNED_LISTING_PACKS)
  const choice: Choice = { plan, interval, extraSeats, packs }
  const pricing = resolvePlanPricing(prices, plan, interval)
  const packPrice = resolvePackPrice(prices, interval)
  const total = totalWithSeats(pricing, extraSeats) + packPrice * packs
  // Economia do anual desta escolha inteira (plano + usuários extras + pacotes).
  const savings = planAnnualSavings(prices, plan, extraSeats, packs)
  const listingLimit = details.limits.owned_listings + packs * OWNED_LISTINGS_PACK_SIZE
  const suffix = BILLING_INTERVAL_LABELS[interval].suffix
  const users = details.usersIncluded + extraSeats
  const belowUsage = users < billing.usersInUse
  const unchanged =
    hasSubscription &&
    plan === currentPlan &&
    interval === billing.interval &&
    extraSeats === currentSeats &&
    packs === currentPacks
  const locked = isChanging || busy !== null
  const organizationName =
    account.organizations.find((organization) => organization.id === account.selectedOrganizationId)
      ?.name ?? null
  // A imobiliária mostrada na página (o servidor confere se o usuário é dono dela)
  // e o retorno da Stripe para /planos.
  const target = {
    organizationId: account.selectedOrganizationId ?? undefined,
    returnTo: "planos",
  } as const

  let kind: "upgrade" | "downgrade" | "mixed" = "mixed"

  if (currentPlan && billing.interval) {
    const before = monthlyCost(prices, {
      plan: currentPlan,
      interval: billing.interval,
      extraSeats: currentSeats,
      packs: currentPacks,
    })
    const after = monthlyCost(prices, choice)
    kind = after > before ? "upgrade" : after < before ? "downgrade" : "mixed"
  }

  const title = hasSubscription
    ? plan === currentPlan
      ? `Alterar o plano ${details.name}`
      : `Trocar para o plano ${details.name}`
    : `Assinar o plano ${details.name}`

  function handleOpenChange(next: boolean) {
    if (!next && locked) {
      return
    }

    onOpenChange(next)
  }

  function confirm() {
    setError(null)

    if (!hasSubscription) {
      void run(
        plan,
        () =>
          startCheckout({
            planKey: plan,
            interval,
            extraSeats,
            ownedListingPacks: packs,
            ...target,
          }),
        "Não foi possível iniciar o pagamento"
      )
      return
    }

    startChange(async () => {
      try {
        const result = await changeSubscription({
          planKey: plan,
          interval,
          extraSeats,
          ownedListingPacks: packs,
          ...target,
        })

        if (!result.ok) {
          setError(result.error)
          return
        }

        toast.add(
          result.effective === "now"
            ? {
                type: "success",
                title: "Assinatura atualizada",
                description:
                  "A mudança já vale. A diferença proporcional entra na cobrança de hoje.",
              }
            : {
                type: "success",
                title: "Mudança agendada",
                description: `Vale a partir de ${formatDate(billing.currentPeriodEnd)}. Até lá, nada muda.`,
              }
        )
        onOpenChange(false)
        router.refresh()
      } catch {
        setError("Não foi possível falar com o servidor. Tente de novo em instantes.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {organizationName ? `Assinatura de ${organizationName}. ` : ""}
            {hasSubscription
              ? "Confira o total antes de confirmar."
              : "Você confirma o pagamento na página segura da Stripe."}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-4">
          <Field>
            <FieldTitle>Período de cobrança</FieldTitle>
            <BillingIntervalToggle
              value={interval}
              onValueChange={setBillingInterval}
              disabled={locked}
            />
          </Field>

          {seatLimit > 0 ? (
            <Field>
              <FieldLabel htmlFor={seatsId}>Usuários extras</FieldLabel>
              <QuantityStepper
                id={seatsId}
                value={extraSeatsInput}
                quantity={extraSeats}
                max={seatLimit}
                disabled={locked}
                itemLabel="usuário extra"
                onValueChange={setExtraSeatsInput}
              />
              <FieldDescription>
                {pluralize(details.usersIncluded, "usuário incluído", "usuários incluídos")} no
                plano. Hoje a equipe usa {pluralize(billing.usersInUse, "usuário", "usuários")},
                entre membros ativos e convites pendentes.
              </FieldDescription>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor={packsId}>
              Pacotes de +{OWNED_LISTINGS_PACK_SIZE} imóveis com foto
            </FieldLabel>
            <QuantityStepper
              id={packsId}
              value={packsInput}
              quantity={packs}
              max={MAX_OWNED_LISTING_PACKS}
              disabled={locked}
              itemLabel="pacote de imóveis"
              onValueChange={setPacksInput}
            />
            <FieldDescription>
              O plano {details.name} inclui{" "}
              {pluralize(details.limits.owned_listings, "imóvel com foto", "imóveis com foto")}.
              Cada pacote soma mais {OWNED_LISTINGS_PACK_SIZE} por{" "}
              {formatBRL(packPrice, { omitZeroCents: true })}
              {suffix}: com {pluralize(packs, "pacote", "pacotes")}, o limite fica em{" "}
              {pluralize(listingLimit, "imóvel", "imóveis")}.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <Separator />

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Plano {details.name}</dt>
          <dd className="text-end tabular-nums">
            {formatBRL(pricing.price, { omitZeroCents: true })}
            {suffix}
          </dd>
          {extraSeats > 0 ? (
            <>
              <dt className="text-muted-foreground">
                {pluralize(extraSeats, "usuário extra", "usuários extras")}
              </dt>
              <dd className="text-end tabular-nums">
                {extraSeats} × {formatBRL(pricing.seatPrice, { omitZeroCents: true })}
                {suffix}
              </dd>
            </>
          ) : null}
          {packs > 0 ? (
            <>
              <dt className="text-muted-foreground">
                {pluralize(packs, "pacote", "pacotes")} de +{OWNED_LISTINGS_PACK_SIZE} imóveis
              </dt>
              <dd className="text-end tabular-nums">
                {packs} × {formatBRL(packPrice, { omitZeroCents: true })}
                {suffix}
              </dd>
            </>
          ) : null}
          <dt className="font-medium">
            Total com {pluralize(users, "usuário", "usuários")} e{" "}
            {pluralize(listingLimit, "imóvel com foto", "imóveis com foto")}
          </dt>
          <dd className="text-end font-medium tabular-nums">
            {formatBRL(total, { omitZeroCents: true })}
            {suffix}
          </dd>
          {interval === "year" ? (
            <>
              <dt className="text-muted-foreground">Equivale a</dt>
              <dd className="text-end tabular-nums">
                {formatBRL(monthlyEquivalent({ price: total, seatPrice: 0 }, "year"), {
                  omitZeroCents: true,
                })}
                /mês
              </dd>
            </>
          ) : null}
        </dl>

        {/* Economia do anual em destaque, sempre comparada ao mensal VIGENTE
            desta mesma configuração — nunca a um preço antigo riscado. */}
        {savings.savings > 0 ? (
          <Alert>
            <PiggyBankIcon />
            <AlertTitle>
              {interval === "year"
                ? `Economia de ${formatBRL(savings.savings, { omitZeroCents: true })} por ano`
                : `No anual você economiza ${formatBRL(savings.savings, { omitZeroCents: true })} por ano`}
            </AlertTitle>
            <AlertDescription>
              {interval === "year"
                ? `${annualRuleText(savings)}: ${formatBRL(savings.monthlyEquivalent)}/mês, contra ${formatBRL(savings.monthlyPerYear, { omitZeroCents: true })} por ano pagando mês a mês.`
                : `${annualRuleText(savings)}: ${formatBRL(savings.yearlyTotal, { omitZeroCents: true })} à vista, o equivalente a ${formatBRL(savings.monthlyEquivalent)}/mês. Troque o período de cobrança acima.`}
            </AlertDescription>
          </Alert>
        ) : null}

        <ul className="flex list-disc flex-col gap-1 ps-5 text-muted-foreground">
          {hasSubscription ? (
            <>
              {kind !== "downgrade" ? (
                <li>
                  Aumentos valem na hora: cobramos hoje a diferença proporcional ao tempo que falta
                  no ciclo.
                </li>
              ) : null}
              {kind !== "upgrade" ? (
                <li>
                  Reduções valem no fim do ciclo atual
                  {billing.currentPeriodEnd ? ` (${formatDate(billing.currentPeriodEnd)})` : ""}.
                  Até lá, nada muda.
                </li>
              ) : null}
            </>
          ) : (
            <li>O plano é liberado assim que a Stripe confirmar o pagamento.</li>
          )}
          <li>
            Nenhum dado é apagado. Com menos pacotes, os imóveis acima do novo limite continuam no
            ar; só a foto de um imóvel novo fica bloqueada até liberar vagas.
          </li>
        </ul>

        {unchanged ? (
          <p className="text-muted-foreground" role="status">
            Essa já é a configuração atual da assinatura.
          </p>
        ) : null}

        {belowUsage ? (
          <Alert variant={hasSubscription ? "destructive" : "default"}>
            <CircleAlertIcon />
            <AlertTitle>Usuários insuficientes</AlertTitle>
            <AlertDescription>
              A equipe usa {pluralize(billing.usersInUse, "usuário", "usuários")} e a{" "}
              {hasSubscription ? "nova assinatura" : "assinatura"} teria {users}.{" "}
              {hasSubscription
                ? `Aumente os usuários extras ou remova ${pluralize(billing.usersInUse - users, "acesso", "acessos")}.`
                : "Acima do limite, novos usuários ficam bloqueados; nada é apagado."}{" "}
              <a href={account.teamSettingsHref}>Gerenciar a equipe</a>
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>
              {hasSubscription
                ? "Não foi possível mudar a assinatura"
                : "Não foi possível iniciar o pagamento"}
            </AlertTitle>
            <AlertDescription>
              {error}
              {isUsersError(error) ? (
                <>
                  {" "}
                  <a href={account.teamSettingsHref}>Gerenciar a equipe</a>
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={locked}>
            Voltar
          </DialogClose>
          <Button
            type="button"
            onClick={confirm}
            disabled={locked || unchanged || (hasSubscription && belowUsage)}
          >
            {locked ? <Spinner data-icon="inline-start" aria-label="Aguarde" /> : null}
            {hasSubscription ? "Confirmar mudança" : "Ir para o pagamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
