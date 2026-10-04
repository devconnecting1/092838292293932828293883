import { formatBRL } from "@workspace/core/billing/format"
import {
  COMMISSION_PURPOSE_LABELS,
  COMMISSION_ROLE_LABELS,
  COMMISSION_STATUS_LABELS,
  formatPercent,
} from "@workspace/core/comissoes"
import { Badge } from "@workspace/ui/components/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { HandCoinsIcon } from "lucide-react"

import { PartnerDialog } from "@/components/comissoes/partner-dialog"
import { PayShareDialog, ReopenShareButton } from "@/components/comissoes/pay-share-dialog"
import type { CommissionShareRow } from "@/lib/comissoes/queries"
import { groupSharesByDeal } from "@/lib/comissoes/queries"

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

function dealLabel(share: CommissionShareRow) {
  return (
    [share.deal.propertyCode, share.deal.propertyTitle].filter(Boolean).join(" · ") ||
    "Imóvel removido"
  )
}

function shareOwner(share: CommissionShareRow, nameOf: (userId: string | null) => string) {
  if (share.role === "agency") {
    return "A imobiliária"
  }

  if (share.role === "partner") {
    return share.partnerName ?? "Parceiro externo"
  }

  return nameOf(share.userId)
}

/** Extrato: uma linha por parte. O RLS já entregou só o que a pessoa pode ver. */
export function CommissionStatementTable({
  shares,
  canPay,
  nameOf,
}: {
  shares: readonly CommissionShareRow[]
  canPay: boolean
  nameOf: (userId: string | null) => string
}) {
  if (shares.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HandCoinsIcon />
          </EmptyMedia>
          <EmptyTitle>Nada por aqui ainda</EmptyTitle>
          <EmptyDescription>
            A comissão nasce quando uma proposta é aceita. Feche um negócio em Propostas e ele
            aparece aqui com a divisão já calculada.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Negócio</TableHead>
          <TableHead>Papel</TableHead>
          <TableHead>Quem recebe</TableHead>
          <TableHead className="text-end">Parte</TableHead>
          <TableHead>Situação</TableHead>
          {canPay ? <TableHead className="text-end">Ação</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {shares.map((share) => (
          <TableRow key={share.id}>
            <TableCell>
              <div className="flex flex-col">
                <span className="font-medium">{dealLabel(share)}</span>
                <span className="text-xs text-muted-foreground">
                  {COMMISSION_PURPOSE_LABELS[share.deal.purpose]} de{" "}
                  {formatBRL(share.deal.dealAmountCents)} · fechado em{" "}
                  {formatDate(share.deal.closedAt)}
                  {share.deal.clientName ? ` · ${share.deal.clientName}` : ""}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{COMMISSION_ROLE_LABELS[share.role]}</Badge>
            </TableCell>
            <TableCell>{shareOwner(share, nameOf)}</TableCell>
            <TableCell className="text-end tabular-nums">
              <div className="flex flex-col items-end">
                <span className="font-medium">{formatBRL(share.amountCents)}</span>
                <span className="text-xs text-muted-foreground">
                  {formatPercent(share.percent)} de {formatBRL(share.deal.totalCents)}
                </span>
              </div>
            </TableCell>
            <TableCell>
              {share.paidAt ? (
                <div className="flex flex-col">
                  <Badge>Pago em {formatDate(share.paidAt)}</Badge>
                  {share.paidNote ? (
                    <span className="mt-1 text-xs text-muted-foreground">{share.paidNote}</span>
                  ) : null}
                </div>
              ) : (
                <Badge variant="secondary">A receber</Badge>
              )}
            </TableCell>
            {canPay ? (
              <TableCell className="text-end">
                {share.paidAt ? (
                  <ReopenShareButton shareId={share.id} />
                ) : (
                  <PayShareDialog
                    shareId={share.id}
                    amountCents={share.amountCents}
                    who={shareOwner(share, nameOf)}
                    deal={dealLabel(share)}
                  />
                )}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Um cartão por negócio fechado, com a regra congelada e o parceiro externo. */
export function CommissionDealsList({ shares }: { shares: readonly CommissionShareRow[] }) {
  const deals = groupSharesByDeal(shares)

  if (deals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum negócio fechado ainda. Assim que uma proposta for aceita, a comissão entra aqui.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {deals.map(({ deal, shares: dealShares }) => {
        const agency = dealShares.find((share) => share.role === "agency")
        const partner = dealShares.find((share) => share.role === "partner")

        return (
          <li key={deal.id} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">
                  {[deal.propertyCode, deal.propertyTitle].filter(Boolean).join(" · ") ||
                    "Imóvel removido"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {COMMISSION_PURPOSE_LABELS[deal.purpose]} de {formatBRL(deal.dealAmountCents)} ·
                  comissão de {formatBRL(deal.totalCents)}
                  {deal.frozenBasis === "percent" && deal.frozenPercent !== null
                    ? ` (${formatPercent(deal.frozenPercent)} pela tabela do dia)`
                    : " (valor fixo pela tabela do dia)"}
                </span>
              </div>
              <Badge variant={deal.status === "paid" ? "default" : "secondary"}>
                {COMMISSION_STATUS_LABELS[deal.status]}
              </Badge>
            </div>

            {agency ? (
              <div className="flex flex-wrap items-center gap-2">
                <PartnerDialog
                  commissionId={deal.id}
                  totalCents={deal.totalCents}
                  agencyCents={agency.amountCents}
                  partnerName={partner?.partnerName ?? null}
                  partnerPercent={partner?.percent ?? 0}
                  deal={
                    [deal.propertyCode, deal.propertyTitle].filter(Boolean).join(" · ") || "Negócio"
                  }
                />
                {partner ? (
                  <span className="text-xs text-muted-foreground">
                    {partner.partnerName} recebe {formatBRL(partner.amountCents)}
                  </span>
                ) : null}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
