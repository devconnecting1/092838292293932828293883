import { formatBRL } from "@workspace/core/billing/format"
import { Badge } from "@workspace/ui/components/badge"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { ConfirmDeleteButton } from "@/components/clientes/confirm-delete-button"
import {
  InvestmentFormDialog,
  type CampaignSuggestionOption,
} from "@/components/marketing/investimentos/investment-form-dialog"
import { centsToBrlInput } from "@/lib/comissoes/money"
import { LEAD_SOURCE_LABELS } from "@/lib/leads/constants"
import { deleteMarketingInvestment } from "@/lib/marketing/investimentos/actions"
import type { MarketingInvestment } from "@/lib/marketing/investimentos/queries"

function RowActions({
  investment,
  monthOptions,
  campaignSuggestions,
}: {
  investment: MarketingInvestment
  monthOptions: readonly string[]
  campaignSuggestions: readonly CampaignSuggestionOption[]
}) {
  const label = `${LEAD_SOURCE_LABELS[investment.source]}${investment.campaign ? ` · ${investment.campaign}` : ""}`

  return (
    <div className="flex items-center justify-end gap-1">
      <InvestmentFormDialog
        mode="edit"
        monthOptions={monthOptions}
        campaignSuggestions={campaignSuggestions}
        investment={{
          id: investment.id,
          month: investment.month,
          source: investment.source,
          campaign: investment.campaign ?? "",
          amount: centsToBrlInput(investment.amountCents),
          notes: investment.notes ?? "",
        }}
      />
      <ConfirmDeleteButton
        action={deleteMarketingInvestment.bind(null, investment.id)}
        label={`Excluir lançamento ${label}`}
        title="Excluir este lançamento?"
        description={`${label}: ${formatBRL(investment.amountCents)}. O custo por lead dos relatórios deixa de contar este valor. Não dá para desfazer.`}
        confirmLabel="Excluir lançamento"
      />
    </div>
  )
}

export function InvestmentsList({
  investments,
  canEdit,
  monthOptions,
  campaignSuggestions,
}: {
  investments: readonly MarketingInvestment[]
  canEdit: boolean
  monthOptions: readonly string[]
  campaignSuggestions: readonly CampaignSuggestionOption[]
}) {
  return (
    <>
      <ItemGroup className="gap-2 md:hidden" aria-label="Lançamentos do mês">
        {investments.map((investment) => (
          <Item key={investment.id} variant="outline" size="sm">
            <ItemContent className="min-w-0">
              <ItemTitle className="flex flex-wrap items-center gap-1.5">
                {LEAD_SOURCE_LABELS[investment.source]}
                {investment.campaign ? (
                  <Badge variant="secondary" className="max-w-full truncate">
                    {investment.campaign}
                  </Badge>
                ) : (
                  <Badge variant="outline">Canal inteiro</Badge>
                )}
              </ItemTitle>
              <ItemDescription className="font-medium text-foreground tabular-nums">
                {formatBRL(investment.amountCents)}
              </ItemDescription>
              {investment.notes ? <ItemDescription>{investment.notes}</ItemDescription> : null}
            </ItemContent>
            {canEdit ? (
              <ItemActions>
                <RowActions
                  investment={investment}
                  monthOptions={monthOptions}
                  campaignSuggestions={campaignSuggestions}
                />
              </ItemActions>
            ) : null}
          </Item>
        ))}
      </ItemGroup>

      <div className="hidden md:block">
        <Table>
          <TableCaption className="sr-only">Lançamentos do mês</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Canal</TableHead>
              <TableHead>Campanha</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Observação</TableHead>
              {canEdit ? (
                <TableHead className="w-24">
                  <span className="sr-only">Ações</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {investments.map((investment) => (
              <TableRow key={investment.id}>
                <TableCell className="font-medium">
                  {LEAD_SOURCE_LABELS[investment.source]}
                </TableCell>
                <TableCell className="max-w-56 truncate">
                  {investment.campaign ?? (
                    <span className="text-muted-foreground">Canal inteiro</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(investment.amountCents)}
                </TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground">
                  {investment.notes ?? "—"}
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    <RowActions
                      investment={investment}
                      monthOptions={monthOptions}
                      campaignSuggestions={campaignSuggestions}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
