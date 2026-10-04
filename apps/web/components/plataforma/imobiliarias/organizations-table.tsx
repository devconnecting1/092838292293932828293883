import Link from "next/link"
import { PanelRightOpenIcon } from "lucide-react"

import {
  billingIntervalLabel,
  PLATFORM_ORGANIZATIONS_PATH,
  platformPlanLabel,
} from "@workspace/core/platform/accounts"
import { Button } from "@workspace/ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { MobileCard, MobileCardList } from "@/components/mobile-cards/mobile-card"
import { AccountMilestone } from "@/components/plataforma/imobiliarias/account-milestone"
import { AccountSituationBadge } from "@/components/plataforma/imobiliarias/account-situation-badge"
import { AiUsageMeter } from "@/components/plataforma/imobiliarias/ai-usage-meter"
import { formatDate, formatDateTime, formatNumber } from "@/lib/format"
import type { PlatformOrganizationRow } from "@/lib/plataforma/imobiliarias"

function detailHref(row: PlatformOrganizationRow) {
  return `${PLATFORM_ORGANIZATIONS_PATH}/${row.id}`
}

function milestoneInput(row: PlatformOrganizationRow) {
  return {
    status: row.status,
    planKey: row.planKey,
    trialEndsAt: row.trialEndsAt,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  }
}

function PlanText({ row }: { row: PlatformOrganizationRow }) {
  const interval = billingIntervalLabel(row.interval)

  return (
    <span className="flex min-w-0 flex-col">
      <span>{platformPlanLabel(row.planKey)}</span>
      {interval ? <span className="text-xs text-muted-foreground">{interval}</span> : null}
    </span>
  )
}

/** Tabela (a partir de 640 px) e cartões (celular) das imobiliárias. */
export function OrganizationsTable({ rows, now }: { rows: PlatformOrganizationRow[]; now: Date }) {
  return (
    <>
      <div className="overflow-hidden rounded-lg border max-sm:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imobiliária</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Fim do teste ou cobrança</TableHead>
              <TableHead className="text-end">Usuários ativos</TableHead>
              <TableHead className="text-end">Imóveis com foto</TableHead>
              <TableHead className="text-end">Leads em 30 dias</TableHead>
              <TableHead>IA no ciclo</TableHead>
              <TableHead>Criada em</TableHead>
              <TableHead>Última atividade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className={row.situation === "bloqueada" ? "bg-destructive/5" : undefined}
              >
                <TableCell className="max-w-64">
                  <div className="flex min-w-0 flex-col">
                    <Link
                      href={detailHref(row)}
                      className="truncate font-medium underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {row.slug}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <PlanText row={row} />
                </TableCell>
                <TableCell>
                  <AccountSituationBadge situation={row.situation} />
                </TableCell>
                <TableCell>
                  <AccountMilestone input={milestoneInput(row)} now={now} />
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(row.activeMembers)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(row.ownedListings)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(row.leadsLast30Days)}
                </TableCell>
                <TableCell>
                  <AiUsageMeter costCents={row.aiCostCents} capCents={row.aiCapCents} />
                </TableCell>
                <TableCell className="tabular-nums">{formatDate(row.createdAt)}</TableCell>
                <TableCell className="tabular-nums">
                  {row.lastActivityAt ? (
                    formatDateTime(row.lastActivityAt)
                  ) : (
                    <span className="text-muted-foreground">Sem atividade</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <MobileCardList aria-label="Imobiliárias">
        {rows.map((row) => (
          <MobileCard
            key={row.id}
            highlight={row.situation === "bloqueada"}
            title={
              <Link href={detailHref(row)} className="underline-offset-4 hover:underline">
                {row.name}
              </Link>
            }
            description={<span className="font-mono text-xs">{row.slug}</span>}
            badges={<AccountSituationBadge situation={row.situation} />}
            facts={[
              { label: "Plano", value: <PlanText row={row} /> },
              {
                label: "Datas",
                value: <AccountMilestone input={milestoneInput(row)} now={now} />,
              },
              {
                label: "Uso",
                value: `${formatNumber(row.activeMembers)} usuários · ${formatNumber(row.ownedListings)} imóveis com foto · ${formatNumber(row.leadsLast30Days)} leads em 30 dias`,
              },
              {
                label: "IA",
                value: <AiUsageMeter costCents={row.aiCostCents} capCents={row.aiCapCents} />,
              },
              {
                label: "Atividade",
                value: row.lastActivityAt
                  ? `${formatDateTime(row.lastActivityAt)} · criada em ${formatDate(row.createdAt)}`
                  : `Sem atividade · criada em ${formatDate(row.createdAt)}`,
              },
            ]}
            actions={
              <Button
                variant="outline"
                render={<Link href={detailHref(row)} />}
                nativeButton={false}
              >
                <PanelRightOpenIcon data-icon="inline-start" />
                Abrir ficha
              </Button>
            }
          />
        ))}
      </MobileCardList>
    </>
  )
}
