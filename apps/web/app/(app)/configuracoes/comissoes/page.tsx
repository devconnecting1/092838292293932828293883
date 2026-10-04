import type { Metadata } from "next"
import { InfoIcon } from "lucide-react"

import { formatBRL } from "@workspace/core/billing/format"
import {
  COMMISSION_BASIS_LABELS,
  COMMISSION_PURPOSE_LABELS,
  COMMISSION_ROLE_LABELS,
  formatPercent,
} from "@workspace/core/comissoes"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { CommissionRuleForm } from "@/components/comissoes/commission-rule-form"
import { CommissionSettingsForm } from "@/components/comissoes/commission-settings-form"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { requireRole } from "@/lib/auth/session"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { getMemberName } from "@/lib/clientes/options"
import { COMMISSION_MANAGER_ROLES } from "@/lib/comissoes/permissions"
import { getCommissionRules, getCommissionSettings } from "@/lib/comissoes/queries"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Tabela de comissão",
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

function formatDate(value: string | null) {
  if (!value) {
    return "—"
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? "—" : dateFormat.format(parsed)
}

export default async function ComissoesSettingsPage() {
  const { membership } = await requireRole(COMMISSION_MANAGER_ROLES)
  const organizationId = membership.organizationId
  const supabase = await createClient()

  const [rules, settings, members] = await Promise.all([
    getCommissionRules(supabase, organizationId),
    getCommissionSettings(supabase, organizationId),
    getOrganizationMembers(organizationId),
  ])

  const managerOptions = members.filter(
    (member) => member.role === "owner" || member.role === "manager"
  )

  return (
    <PageShell
      variant="settings"
      width="wide"
      header={
        <PageHeading
          title="Tabela de comissão"
          description="Quanto a imobiliária cobra, como o valor é dividido entre quem participou e quando um desconto precisa de aprovação."
        />
      }
    >
      <Alert>
        <InfoIcon />
        <AlertTitle>Cada versão fica guardada</AlertTitle>
        <AlertDescription>
          Salvar não sobrescreve nada: a tabela atual vira histórico com a data em que deixou de
          valer e a nova passa a valer daqui para a frente. Negócio fechado no mês passado continua
          com a regra daquele mês.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Venda</CardTitle>
          <CardDescription>
            Vale para toda proposta de venda aceita a partir de agora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CommissionRuleForm purpose="sale" rule={rules.current.sale} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Locação</CardTitle>
          <CardDescription>
            O percentual incide sobre o valor do aluguel da proposta (100% = um aluguel).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CommissionRuleForm purpose="rent" rule={rules.current.rent} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gerência e desconto</CardTitle>
          <CardDescription>
            Quem recebe a fatia de gerência e a partir de que desconto a proposta precisa passar
            pelo gerente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CommissionSettingsForm
            defaultValues={{
              managerUserId: settings.managerUserId ?? "",
              discountApprovalEnabled: settings.discountApprovalEnabled,
              maxDiscountPercent: settings.maxDiscountPercent,
            }}
            members={managerOptions}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>
            Versões que deixaram de valer. Elas continuam mandando nos negócios fechados enquanto
            estavam em vigor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ainda não houve mudança: a tabela em vigor é a primeira.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Negócio</TableHead>
                  <TableHead>Comissão</TableHead>
                  <TableHead>Divisão</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Quem mudou</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.history.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>{COMMISSION_PURPOSE_LABELS[rule.purpose]}</TableCell>
                    <TableCell>
                      {rule.basis === "percent"
                        ? formatPercent(rule.percent)
                        : `${formatBRL(rule.fixedCents)} · ${COMMISSION_BASIS_LABELS.fixed}`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {COMMISSION_ROLE_LABELS.capturer} {formatPercent(rule.split.capturer)} ·{" "}
                      {COMMISSION_ROLE_LABELS.seller} {formatPercent(rule.split.seller)} ·{" "}
                      {COMMISSION_ROLE_LABELS.manager} {formatPercent(rule.split.manager)} ·{" "}
                      {COMMISSION_ROLE_LABELS.agency} {formatPercent(rule.split.agency)} ·{" "}
                      {COMMISSION_ROLE_LABELS.partner} {formatPercent(rule.split.partner)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(rule.effectiveFrom)} → {formatDate(rule.effectiveTo)}
                    </TableCell>
                    <TableCell>{getMemberName(members, rule.createdBy, "Sistema")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
