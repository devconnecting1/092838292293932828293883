import type { Metadata } from "next"
import Link from "next/link"
import { InfoIcon, SettingsIcon } from "lucide-react"

import { formatPercent } from "@workspace/core/comissoes"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import {
  CommissionDealsList,
  CommissionStatementTable,
} from "@/components/comissoes/commission-statement"
import { CommissionSummaryCards } from "@/components/comissoes/commission-summary-cards"
import {
  DiscountRequestsList,
  ProposalsNeedingApproval,
} from "@/components/comissoes/discount-approvals"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { requireMembership } from "@/lib/auth/session"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { getMemberName } from "@/lib/clientes/options"
import {
  canManageCommissions,
  COMMISSION_SETTINGS_PATH,
  isCommissionAuditor,
} from "@/lib/comissoes/permissions"
import {
  getCommissionRules,
  getCommissionSettings,
  getCommissionStatement,
  getCommissionSummary,
  getDiscountRequests,
  getProposalsNeedingApproval,
} from "@/lib/comissoes/queries"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Comissões",
}

export default async function ComissoesPage() {
  const { user, membership } = await requireMembership()
  const organizationId = membership.organizationId
  const role = membership.role
  const auditor = isCommissionAuditor(role)
  const canManage = canManageCommissions(role)

  const supabase = await createClient()

  const [shares, summary, settings, rules, members, requests] = await Promise.all([
    // Sem filtro por pessoa: o RLS já entrega só o que este papel pode ver.
    getCommissionStatement(supabase, organizationId),
    getCommissionSummary(supabase, auditor ? null : user.id),
    getCommissionSettings(supabase, organizationId),
    getCommissionRules(supabase, organizationId),
    getOrganizationMembers(organizationId),
    getDiscountRequests(supabase, organizationId),
  ])

  const proposals = await getProposalsNeedingApproval(supabase, organizationId, settings, requests)

  const names = Object.fromEntries(members.map((member) => [member.id, member.name]))
  const nameOf = (userId: string | null) => getMemberName(members, userId)
  const pendingRequests = requests.filter((request) => request.status === "pending")
  const recentRequests = requests.filter((request) => request.status !== "pending").slice(0, 10)
  const currentSale = rules.current.sale

  return (
    <PageShell
      header={
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeading
            title="Comissões"
            description={
              auditor
                ? "O que cada pessoa tem a receber, o que já foi pago e de qual negócio veio."
                : "O que você tem a receber, o que já recebeu e de qual negócio veio."
            }
          />
          {canManage ? (
            <Button
              variant="outline"
              render={<Link href={COMMISSION_SETTINGS_PATH} />}
              nativeButton={false}
            >
              <SettingsIcon data-icon="inline-start" />
              Tabela de comissão
            </Button>
          ) : null}
        </div>
      }
    >
      <CommissionSummaryCards summary={summary} scope={auditor ? "all" : "mine"} />

      {currentSale ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>
            Tabela em vigor na venda:{" "}
            {currentSale.basis === "percent"
              ? formatPercent(currentSale.percent)
              : "valor fixo por negócio"}
          </AlertTitle>
          <AlertDescription>
            A comissão nasce quando a proposta é aceita e congela a tabela daquele momento. Mudar a
            tabela hoje não altera nenhum negócio já fechado.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Extrato</CardTitle>
          <CardDescription>
            {auditor
              ? "Uma linha por pessoa em cada negócio. A soma das partes é sempre o total da comissão."
              : "Uma linha por participação sua. Só você, o dono, o gerente e o financeiro veem estes valores."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CommissionStatementTable shares={shares} canPay={auditor} nameOf={nameOf} />
        </CardContent>
      </Card>

      {auditor ? (
        <Card>
          <CardHeader>
            <CardTitle>Negócios fechados</CardTitle>
            <CardDescription>
              A regra congelada de cada negócio e o parceiro externo, quando houver.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CommissionDealsList shares={shares} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Aprovação de desconto</CardTitle>
          <CardDescription>
            {settings.discountApprovalEnabled
              ? `Proposta mais de ${formatPercent(settings.maxDiscountPercent)} abaixo do anunciado só segue depois que o gerente aprovar.`
              : "Está desligada. Ligue na tabela de comissão para o CRM segurar propostas com desconto grande."}
          </CardDescription>
          {canManage ? (
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                render={<Link href={COMMISSION_SETTINGS_PATH} />}
                nativeButton={false}
              >
                Ajustar limite
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">Esperando resposta</h3>
            <DiscountRequestsList requests={pendingRequests} canReview={canManage} names={names} />
          </section>

          {settings.discountApprovalEnabled ? (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Propostas abertas abaixo do limite</h3>
              <ProposalsNeedingApproval proposals={proposals} />
            </section>
          ) : null}

          {recentRequests.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Já respondidos</h3>
              <DiscountRequestsList requests={recentRequests} canReview={false} names={names} />
            </section>
          ) : null}
        </CardContent>
      </Card>
    </PageShell>
  )
}
