import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, BanIcon, CircleAlertIcon } from "lucide-react"
import { z } from "zod"

import { formatBRL } from "@workspace/core/billing/format"
import { BILLING_STATE_LABELS } from "@workspace/core/billing/state"
import {
  billingIntervalLabel,
  PLATFORM_ORGANIZATIONS_PATH,
  platformPlanLabel,
} from "@workspace/core/platform/accounts"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { AccountMilestone } from "@/components/plataforma/imobiliarias/account-milestone"
import { AccountSituationBadge } from "@/components/plataforma/imobiliarias/account-situation-badge"
import { AiUsageMeter } from "@/components/plataforma/imobiliarias/ai-usage-meter"
import { BillingHistoryList } from "@/components/plataforma/imobiliarias/billing-history-list"
import { ConsoleActionsList } from "@/components/plataforma/imobiliarias/console-actions-list"
import { MembersList } from "@/components/plataforma/imobiliarias/members-list"
import { PlatformReadOnlyNotice } from "@/components/plataforma/equipe/read-only-notice"
import { OrganizationActions } from "@/components/plataforma/imobiliarias/organization-actions"
import { PlatformRpcFailureAlert } from "@/components/plataforma/platform-rpc-failure-alert"
import { formatDate, formatDateTime, formatNumber } from "@/lib/format"
import { canAct, requirePlatformAdmin } from "@/lib/plataforma/admin"
import { listPlatformAuditEvents } from "@/lib/plataforma/audit"
import { getPlatformOrganization } from "@/lib/plataforma/imobiliarias"

export const metadata: Metadata = {
  title: "Ficha da imobiliária",
}

const CONSOLE_EVENTS_LIMIT = 20

type PageProps = {
  params: Promise<{ id: string }>
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  )
}

/**
 * Ficha de uma imobiliária no Console da Plataforma: assinatura, números,
 * membros (equipe da imobiliária, para suporte), histórico de assinatura e
 * últimas ações do console, com bloquear/desbloquear e prorrogar teste.
 * Nenhum dado de cliente ou lead da imobiliária aparece aqui.
 */
export default async function PlatformOrganizationPage({ params }: PageProps) {
  const admin = await requirePlatformAdmin()
  const allowActions = canAct(admin)

  const { id } = await params
  const organizationId = z.guid().safeParse(id)

  if (!organizationId.success) {
    notFound()
  }

  const [result, events] = await Promise.all([
    getPlatformOrganization(organizationId.data),
    listPlatformAuditEvents({ organizationId: organizationId.data, limit: CONSOLE_EVENTS_LIMIT }),
  ])

  if (result.ok && result.data === null) {
    notFound()
  }

  const now = new Date()
  const backLink = (
    <Button
      variant="ghost"
      size="sm"
      className="self-start"
      render={<Link href={PLATFORM_ORGANIZATIONS_PATH} />}
      nativeButton={false}
    >
      <ArrowLeftIcon data-icon="inline-start" />
      Imobiliárias
    </Button>
  )

  if (!result.ok) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        {backLink}
        <PlatformRpcFailureAlert failure={result} />
      </div>
    )
  }

  const organization = result.data

  if (!organization) {
    notFound()
  }

  const { billing, metrics } = organization
  const interval = billingIntervalLabel(billing?.interval)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      {backLink}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight break-words">
              {organization.name}
            </h1>
            {billing ? <AccountSituationBadge situation={billing.situation} /> : null}
          </div>
          <p className="text-sm break-all text-muted-foreground">
            Subdomínio <span className="font-mono">{organization.slug}</span> · criada em{" "}
            {formatDate(organization.createdAt)}
          </p>
        </div>
        {billing ? (
          <OrganizationActions
            canAct={allowActions}
            organizationId={organization.id}
            organizationName={organization.name}
            blocked={Boolean(billing.blockedAt)}
            trial={{
              status: billing.status,
              planKey: billing.planKey,
              hasSubscription: billing.hasSubscription,
              trialEndsAt: billing.trialEndsAt,
            }}
          />
        ) : null}
      </div>

      {billing && !allowActions ? <PlatformReadOnlyNotice /> : null}

      {billing?.blockedAt ? (
        <Alert variant="destructive">
          <BanIcon />
          <AlertTitle>Conta bloqueada em {formatDateTime(billing.blockedAt)}</AlertTitle>
          <AlertDescription>
            <p>
              A imobiliária está em somente leitura, sem IA e sem envio pelas conexões, até ser
              desbloqueada. Nenhum dado foi apagado.
            </p>
            {billing.blockedReason ? <p>Motivo: {billing.blockedReason}</p> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!billing ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Imobiliária sem conta de assinatura</AlertTitle>
          <AlertDescription>
            Sem linha em billing_accounts ela fica em somente leitura. Veja a Saúde do sistema.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Assinatura</CardTitle>
            <CardDescription>
              Espelho da Stripe em billing_accounts (a Stripe é a fonte da verdade).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {billing ? (
              <dl className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
                <Fact label="Plano">
                  {platformPlanLabel(billing.planKey)}
                  {interval ? ` · ${interval}` : ""}
                </Fact>
                <Fact label="Acesso ao CRM">{BILLING_STATE_LABELS[billing.accessState]}</Fact>
                <Fact label="Fim do teste ou próxima cobrança">
                  <AccountMilestone
                    now={now}
                    input={{
                      status: billing.status,
                      planKey: billing.planKey,
                      trialEndsAt: billing.trialEndsAt,
                      currentPeriodEnd: billing.currentPeriodEnd,
                      cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
                    }}
                  />
                </Fact>
                <Fact label="Usuários contratados">{formatNumber(billing.seats)}</Fact>
                <Fact label="Vínculo com a Stripe">
                  {billing.hasSubscription
                    ? "Assinatura vinculada"
                    : billing.hasCustomer
                      ? "Cliente criado, sem assinatura"
                      : "Sem vínculo (teste grátis local)"}
                </Fact>
                <Fact label="Valor mensal na última fatura">
                  {billing.planNetMonthlyCents !== null
                    ? formatBRL(billing.planNetMonthlyCents)
                    : "—"}
                </Fact>
                <Fact label="Primeira fatura paga">
                  {billing.firstPaidAt ? formatDate(billing.firstPaidAt) : "—"}
                </Fact>
                <Fact label="Sincronizada em">
                  {billing.syncedAt ? formatDateTime(billing.syncedAt) : "—"}
                </Fact>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Sem dados de assinatura.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Uso</CardTitle>
            <CardDescription>Só contagens: nenhum dado de cliente ou lead.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
              <Fact label="Usuários ativos">{formatNumber(metrics.activeMembers)}</Fact>
              <Fact label="Imóveis com foto">{formatNumber(metrics.ownedListings)}</Fact>
              <Fact label="Leads nos últimos 30 dias">{formatNumber(metrics.leadsLast30Days)}</Fact>
              <Fact label="IA no ciclo">
                <AiUsageMeter costCents={metrics.aiCostCents} capCents={metrics.aiCapCents} />
                {metrics.aiPeriodStart && metrics.aiPeriodEnd ? (
                  <span className="text-xs text-muted-foreground">
                    Ciclo de {formatDate(metrics.aiPeriodStart)} a {formatDate(metrics.aiPeriodEnd)}
                  </span>
                ) : null}
              </Fact>
              <Fact label="Último acesso de um membro">
                {metrics.lastSignInAt ? formatDateTime(metrics.lastSignInAt) : "Nunca"}
              </Fact>
              <Fact label="Último registro no CRM">
                {metrics.lastAuditEventAt ? formatDateTime(metrics.lastAuditEventAt) : "Nenhum"}
              </Fact>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Membros</CardTitle>
          <CardDescription>
            Equipe da imobiliária, para suporte. E-mails só para contato de suporte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MembersList members={organization.members} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Histórico de assinatura</CardTitle>
            <CardDescription>
              Mudanças de plano, status, datas e bloqueio (até as 50 mais recentes).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BillingHistoryList entries={organization.history} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Últimas ações do console</CardTitle>
            <CardDescription>
              Quem fez, quando e por quê (até as {CONSOLE_EVENTS_LIMIT} mais recentes).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {events.ok ? (
              <ConsoleActionsList events={events.data} />
            ) : (
              <PlatformRpcFailureAlert failure={events} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
