import type { Metadata } from "next"
import { InfoIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"

import { PageHeading } from "@/components/crm/page-placeholder"
import { TrashList } from "@/components/lixeira/trash-list"
import { PageShell } from "@/components/shared/page-shell"
import { requireRole } from "@/lib/auth/session"
import { formatDateTime } from "@/lib/format"
import {
  describeLegalHolds,
  formatPlainDate,
  TRASH_ENTITY_LABELS,
  TRASH_RETENTION_DAYS,
  TRASH_ROLES,
} from "@/lib/lixeira/constants"
import { getTrashPageData, type ErasureReceipt } from "@/lib/lixeira/queries"

export const metadata: Metadata = {
  title: "Lixeira",
}

const REASON_LABELS: Record<string, string> = {
  subject_request: "Pedido do titular (LGPD, art. 18)",
  manual: "Exclusão manual",
  trash_expired: `${TRASH_RETENTION_DAYS} dias na lixeira`,
  hold_expired: "Fim do prazo de guarda",
}

const OUTCOME_LABELS: Record<string, string> = {
  deleted: "Apagado",
  anonymized: "Anonimizado",
  identification_removed: "Nome e CPF/CNPJ removidos",
}

function receiptDescription(receipt: ErasureReceipt) {
  const who =
    receipt.executedByName ?? (receipt.executedBy ? "dono ou gerente" : "rotina automática")
  const parts = [`${formatDateTime(receipt.executedAt)} · ${who}`]

  if (receipt.legalHolds.length > 0) {
    parts.push(`Guardado por: ${describeLegalHolds(receipt.legalHolds)}`)
  }
  if (receipt.identificationKeptUntil) {
    parts.push(`Nome e CPF/CNPJ até ${formatPlainDate(receipt.identificationKeptUntil)}`)
  }

  return parts.join(" · ")
}

/**
 * Lixeira (dono e gerente): leads, clientes e imóveis excluídos ficam 30 dias
 * antes da rotina diária apagar de vez. Registros com guarda legal são
 * anonimizados em vez de apagados. Embaixo, os comprovantes (sem dado pessoal).
 */
export default async function LixeiraPage() {
  const { membership } = await requireRole(TRASH_ROLES)
  const { items, receipts, loadError } = await getTrashPageData(membership.organizationId)

  return (
    <PageShell
      variant="settings"
      width="reading"
      header={
        <PageHeading
          title="Lixeira"
          description={`Leads, clientes e imóveis excluídos ficam aqui por ${TRASH_RETENTION_DAYS} dias. Depois são apagados de vez, com fotos e documentos.`}
        />
      }
    >
      {loadError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Não foi possível carregar a lixeira</AlertTitle>
          <AlertDescription>Atualize a página em alguns instantes.</AlertDescription>
        </Alert>
      ) : null}

      <Alert>
        <InfoIcon />
        <AlertTitle>O que a lei obriga a guardar não é apagado</AlertTitle>
        <AlertDescription>
          Cliente ou imóvel com proposta aceita, comissão lançada, autorização assinada ou documento
          no dossiê tem guarda legal: em vez de apagar tudo, os dados pessoais são anonimizados e o
          obrigatório fica guardado.
        </AlertDescription>
      </Alert>

      <TrashList items={items} />

      <section aria-labelledby="lixeira-comprovantes" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="lixeira-comprovantes" className="text-base font-medium">
            Comprovantes de exclusão
          </h2>
          <p className="text-sm text-muted-foreground">
            Registro do que foi apagado ou anonimizado, quando e por quem — sem os dados apagados.
          </p>
        </div>
        {receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma exclusão definitiva ainda.</p>
        ) : (
          <ItemGroup className="gap-2">
            {receipts.map((receipt) => (
              <Item key={receipt.id} variant="outline" size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle className="flex-wrap">
                    {TRASH_ENTITY_LABELS[receipt.entity]}
                    <Badge variant={receipt.outcome === "deleted" ? "secondary" : "outline"}>
                      {OUTCOME_LABELS[receipt.outcome] ?? receipt.outcome}
                    </Badge>
                    <span className="text-muted-foreground">
                      {REASON_LABELS[receipt.reason] ?? receipt.reason}
                    </span>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-none">
                    {receiptDescription(receipt)}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </section>
    </PageShell>
  )
}
