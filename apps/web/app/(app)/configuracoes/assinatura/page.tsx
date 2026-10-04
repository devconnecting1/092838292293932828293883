import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRightIcon, CircleAlertIcon, LockIcon, SettingsIcon } from "lucide-react"

import {
  BILLING_INTERVAL_LABELS,
  isPlanKey,
  OWNED_LISTINGS_PACK_SIZE,
  PLANS,
  TRIAL_LIMITS,
} from "@workspace/core/billing"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
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

import { AiUsageCard } from "@/components/billing/ai-usage-card"
import {
  loadBillingOverview,
  loadCatalogPrices,
  loadOwnedListingUsage,
  loadRecentInvoices,
} from "@/components/billing/billing-data"
import { BillingPortalButton } from "@/components/billing/billing-portal-button"
import { BillingStateBadge } from "@/components/billing/billing-state-badge"
import {
  CheckoutReturnNotice,
  type CheckoutReturnStatus,
} from "@/components/billing/checkout-return-notice"
import { InvoicesList } from "@/components/billing/invoices-list"
import {
  describeBillingState,
  isSubscriptionConfirmed,
  planDisplayName,
} from "@/components/billing/overview-view"
import { OwnedListingPacksDialog } from "@/components/billing/owned-listing-packs-dialog"
import { pluralize, resolvePackPrice } from "@/components/billing/plan-content"
import { plansPageHref } from "@/components/billing/plans-page-link"
import { UsageMeters } from "@/components/billing/usage-meters"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { loadAiUsageOverview } from "@/lib/ai/queries"
import { hasRole, ORGANIZATION_VIEWER_ROLES, TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import { REFERRALS_SETTINGS_PATH } from "@/lib/auth/routes"
import { requireRole } from "@/lib/auth/session"
import { isStripeConfigured, type BillingOverview } from "@/lib/billing/queries"
import { getStoredReferralDiscountPercent } from "@/lib/billing/referrals"
import { formatDate } from "@/lib/format"

export const metadata: Metadata = {
  title: "Assinatura",
}

type AssinaturaPageProps = {
  searchParams: Promise<{ checkout?: string | string[] }>
}

function readCheckoutStatus(value: string | string[] | undefined): CheckoutReturnStatus | null {
  return value === "sucesso" || value === "cancelado" ? value : null
}

/** Imóveis com foto contratados: limite total e, havendo pacotes, a composição. */
function ownedListingsLabel(overview: BillingOverview) {
  const catalog = isPlanKey(overview.planKey) ? PLANS[overview.planKey].limits : TRIAL_LIMITS
  const limit = overview.limits.owned_listings ?? catalog.owned_listings
  const total = pluralize(limit, "imóvel", "imóveis")

  if (overview.ownedListingPacks === 0) {
    return total
  }

  return `${total} (${catalog.owned_listings} do plano + ${pluralize(overview.ownedListingPacks, "pacote", "pacotes")} de +${OWNED_LISTINGS_PACK_SIZE})`
}

function nextChargeLabel(overview: BillingOverview) {
  if (!overview.hasSubscription) {
    return "Nenhuma: você ainda não assinou"
  }

  if (overview.cancelAtPeriodEnd) {
    return "Nenhuma: assinatura cancelada"
  }

  return overview.currentPeriodEnd ? formatDate(overview.currentPeriodEnd) : "—"
}

/** O que segue funcionando e o que fica bloqueado no modo leitura (contrato, §1). */
function ReadOnlyDetails() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <p className="font-medium">Continua funcionando</p>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-muted-foreground">
          <li>Ver e exportar imóveis, clientes e leads em planilha</li>
          <li>Landing pages captando leads</li>
          <li>Assinar ou regularizar o pagamento</li>
        </ul>
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-medium">Fica pausado</p>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-muted-foreground">
          <li>Criar e editar registros</li>
          <li>Convidar pessoas para a equipe</li>
          <li>Feed de imóveis para os portais</li>
        </ul>
      </div>
    </div>
  )
}

export default async function AssinaturaPage({ searchParams }: AssinaturaPageProps) {
  const { membership } = await requireRole(ORGANIZATION_VIEWER_ROLES)
  const isOwner = membership.role === "owner"
  // O teto de excedente de IA é uma trava de gasto: dono e gerente definem.
  const canManageAi = hasRole(membership.role, TEAM_MANAGER_ROLES)
  const { checkout } = await searchParams
  const checkoutStatus = readCheckoutStatus(checkout)
  const stripeConfigured = isStripeConfigured()

  // A escolha de plano fica em /planos, fora do painel, ligada a esta imobiliária.
  const plansHref = plansPageHref(membership.organization.slug)

  const [overview, invoicesResult, referralPercent, aiUsage, ownedListings, catalogPrices] =
    await Promise.all([
      loadBillingOverview(membership.organizationId),
      loadRecentInvoices(membership.organizationId),
      getStoredReferralDiscountPercent(membership.organizationId),
      loadAiUsageOverview(membership.organizationId),
      loadOwnedListingUsage(membership.organizationId),
      loadCatalogPrices(),
    ])

  const stateMessage = overview ? describeBillingState(overview) : null
  const portalAvailable = stripeConfigured && overview !== null && overview.planKey !== "trial"
  // Pacotes de +10 imóveis: mesma troca de assinatura do plano (só assinatura ativa ou em teste pago).
  const paidPlan =
    overview?.hasSubscription && isPlanKey(overview.planKey) ? overview.planKey : null
  const packsChangeable =
    overview !== null &&
    stripeConfigured &&
    !overview.platformBlocked &&
    (overview.status === "active" || overview.status === "trialing")

  return (
    <PageShell
      variant="settings"
      width="wide"
      header={
        <PageHeading
          title="Assinatura"
          description="Plano, uso, pagamento e faturas da imobiliária."
        />
      }
    >
      {checkoutStatus ? (
        <CheckoutReturnNotice
          status={checkoutStatus}
          confirmed={isSubscriptionConfirmed(overview)}
        />
      ) : null}

      {!stripeConfigured ? (
        <Alert>
          <SettingsIcon />
          <AlertTitle>Pagamentos em configuração</AlertTitle>
          <AlertDescription>
            A cobrança online ainda está sendo configurada. Você já pode ver o plano e o uso;
            assinar, trocar de plano e consultar faturas ficam disponíveis assim que terminarmos.
          </AlertDescription>
        </Alert>
      ) : null}

      {!isOwner ? (
        <Alert>
          <LockIcon />
          <AlertTitle>Somente leitura para o seu papel</AlertTitle>
          <AlertDescription>
            Só o dono da imobiliária pode assinar, trocar de plano ou alterar o pagamento.
          </AlertDescription>
        </Alert>
      ) : null}

      {overview && stateMessage ? (
        <>
          {/* Situação, plano e uso lado a lado conforme a largura da coluna. */}
          <div className="grid gap-6 @min-[40rem]/main:grid-cols-2 @min-[72rem]/main:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Situação</CardTitle>
                <CardDescription>{stateMessage.title}</CardDescription>
                <CardAction>
                  <BillingStateBadge state={overview.state} />
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p>{stateMessage.description}</p>
                {overview.state === "read_only" && !overview.platformBlocked ? (
                  <ReadOnlyDetails />
                ) : null}
              </CardContent>
              {/* Conta suspensa pela plataforma: assinar não libera, então sem botão de plano. */}
              {isOwner && overview.state !== "active" && !overview.platformBlocked ? (
                <CardFooter className="flex-wrap gap-2">
                  {overview.state === "grace" && overview.hasSubscription ? (
                    <BillingPortalButton
                      flow="payment_method_update"
                      variant="default"
                      disabled={!stripeConfigured}
                    >
                      Atualizar forma de pagamento
                    </BillingPortalButton>
                  ) : (
                    <Button render={<a href={plansHref} />} nativeButton={false}>
                      Escolher um plano
                    </Button>
                  )}
                </CardFooter>
              ) : null}
            </Card>

            <Card id="imoveis-extras" className="scroll-mt-20">
              <CardHeader>
                <CardTitle>Plano atual</CardTitle>
                <CardDescription>Resumo do que está contratado.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
                  <dt className="text-muted-foreground">Plano</dt>
                  <dd className="font-medium">{planDisplayName(overview.planKey)}</dd>
                  <dt className="text-muted-foreground">Cobrança</dt>
                  <dd>
                    {overview.interval ? BILLING_INTERVAL_LABELS[overview.interval].label : "—"}
                  </dd>
                  <dt className="text-muted-foreground">Usuários contratados</dt>
                  <dd>{pluralize(overview.seats, "usuário", "usuários")}</dd>
                  <dt className="text-muted-foreground">Imóveis com foto</dt>
                  <dd>{ownedListingsLabel(overview)}</dd>
                  {overview.hasSubscription ? null : (
                    <>
                      <dt className="text-muted-foreground">Teste grátis até</dt>
                      <dd>{formatDate(overview.trialEndsAt)}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Próxima cobrança</dt>
                  <dd>{nextChargeLabel(overview)}</dd>
                  {referralPercent !== null ? (
                    <>
                      <dt className="text-muted-foreground">Desconto por indicações</dt>
                      <dd>
                        <Link
                          href={REFERRALS_SETTINGS_PATH}
                          className="underline-offset-4 hover:underline"
                        >
                          {referralPercent}%
                        </Link>
                        {referralPercent > 0 && overview.status !== "active" ? (
                          <span className="text-muted-foreground"> (a aplicar)</span>
                        ) : null}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </CardContent>
              {isOwner ? (
                <CardFooter className="flex-col items-start gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <BillingPortalButton
                      disabled={!portalAvailable}
                      describedBy={portalAvailable ? undefined : "portal-indisponivel"}
                    />
                    {paidPlan && overview.interval && !overview.cancelAtPeriodEnd ? (
                      <OwnedListingPacksDialog
                        planKey={paidPlan}
                        planName={PLANS[paidPlan].name}
                        interval={overview.interval}
                        extraSeats={Math.max(0, overview.seats - PLANS[paidPlan].usersIncluded)}
                        currentPacks={overview.ownedListingPacks}
                        planListings={PLANS[paidPlan].limits.owned_listings}
                        packPrice={resolvePackPrice(catalogPrices, overview.interval)}
                        ownedListingsInUse={ownedListings}
                        currentPeriodEnd={overview.currentPeriodEnd}
                        disabled={!packsChangeable}
                      />
                    ) : null}
                    {overview.hasSubscription && !overview.cancelAtPeriodEnd ? (
                      <BillingPortalButton
                        flow="subscription_cancel"
                        variant="ghost"
                        disabled={!stripeConfigured}
                      >
                        Cancelar assinatura
                      </BillingPortalButton>
                    ) : null}
                  </div>
                  {paidPlan ? null : (
                    <p className="text-sm text-muted-foreground">
                      Precisa de mais imóveis com foto? Escolha pacotes de +
                      {OWNED_LISTINGS_PACK_SIZE} imóveis junto com o plano, em{" "}
                      <a href={`${plansHref}#adicionais`} className="underline underline-offset-4">
                        Ver planos
                      </a>
                      .
                    </p>
                  )}
                  {portalAvailable ? null : (
                    <p id="portal-indisponivel" className="text-sm text-muted-foreground">
                      {stripeConfigured
                        ? "Disponível depois da primeira assinatura."
                        : "Disponível quando os pagamentos estiverem configurados."}
                    </p>
                  )}
                </CardFooter>
              ) : null}
            </Card>

            <Card className="@min-[40rem]/main:col-span-2 @min-[72rem]/main:col-span-1">
              <CardHeader>
                <CardTitle>Uso do plano</CardTitle>
                <CardDescription>
                  Acima do limite, novos usuários, publicações e fotos de outro imóvel ficam
                  bloqueados; nada é apagado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UsageMeters
                  overview={overview}
                  ownedListings={ownedListings}
                  upgradeHref={isOwner ? plansHref : undefined}
                />
              </CardContent>
            </Card>
          </div>

          {aiUsage ? <AiUsageCard overview={aiUsage} canManage={canManageAi} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>Planos</CardTitle>
              <CardDescription>
                Compare os planos, os adicionais e o que cada um inclui.
                {isOwner
                  ? " Upgrade na hora, com cobrança proporcional; downgrade no próximo ciclo, sem apagar nada."
                  : " Só o dono da imobiliária pode assinar ou trocar de plano."}
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button render={<a href={plansHref} />} nativeButton={false}>
                {overview.hasSubscription ? "Ver planos e trocar" : "Ver planos e assinar"}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </CardFooter>
          </Card>
        </>
      ) : (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Não foi possível carregar a assinatura</AlertTitle>
          <AlertDescription>
            Recarregue a página em instantes. Seus dados e o acesso ao CRM não foram afetados.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Faturas recentes</CardTitle>
          <CardDescription>Últimas cobranças, lidas direto da Stripe.</CardDescription>
        </CardHeader>
        <CardContent>
          {invoicesResult.ok ? (
            <InvoicesList invoices={invoicesResult.invoices} stripeConfigured={stripeConfigured} />
          ) : (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Faturas indisponíveis no momento</AlertTitle>
              <AlertDescription>
                Tente de novo em instantes
                {isOwner && portalAvailable ? " ou abra o portal de pagamento" : ""}.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
