import { FileOutputIcon, ShieldBanIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { ROLE_LABELS } from "@/lib/auth/roles"
import type { ExportAuditItem, ExportAuditResult } from "@/lib/configuracoes/export-audit"
import { formatDateTime } from "@/lib/format"

const ROWS = new Intl.NumberFormat("pt-BR")

function rowsLabel(rows: number) {
  return `${ROWS.format(rows)} ${rows === 1 ? "linha" : "linhas"}`
}

/** "Clientes · Últimos 30 dias (…) · Corretor: Fulano". */
function details(item: ExportAuditItem) {
  const parts = [item.datasetLabel]

  if (item.periodLabel) parts.push(item.periodLabel)
  if (item.brokerName) parts.push(`Corretor: ${item.brokerName}`)
  else if (item.ownRecordsOnly) parts.push("só os registros de quem exportou")

  return parts.join(" · ")
}

export function ExportAuditList({ result }: { result: ExportAuditResult }) {
  if (result.failed) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Não foi possível carregar as exportações</AlertTitle>
        <AlertDescription>
          Pode ser uma instabilidade momentânea. Recarregue a página.
        </AlertDescription>
      </Alert>
    )
  }

  if (result.items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileOutputIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhuma exportação registrada</EmptyTitle>
          <EmptyDescription>
            Cada download de CSV em Relatórios (e cada tentativa recusada) aparece aqui.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ItemGroup className="gap-2" aria-label="Exportações de dados">
        {result.items.map((item) => {
          const who = item.actorName ?? "Ex-membro da equipe"
          const role = item.role ? ` (${ROLE_LABELS[item.role]})` : ""

          return (
            <Item key={item.id} variant="outline" role="listitem">
              <ItemMedia variant="icon">
                {item.allowed ? <FileOutputIcon /> : <ShieldBanIcon />}
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="line-clamp-none w-full flex-wrap">
                  <span className="break-words">
                    {who}
                    {role}{" "}
                    {item.allowed
                      ? `exportou ${rowsLabel(item.rows)}`
                      : "tentou exportar sem permissão"}
                  </span>
                  {item.allowed ? null : <Badge variant="destructive">Recusada</Badge>}
                </ItemTitle>
                <ItemDescription className="line-clamp-none break-words">
                  {formatDateTime(item.createdAt)} · {details(item)}
                </ItemDescription>
              </ItemContent>
            </Item>
          )
        })}
      </ItemGroup>
      <p className="text-xs text-muted-foreground">
        Mostra as {result.items.length} exportações mais recentes. O registro guarda quem, quando, o
        quê, os filtros e a quantidade de linhas — nunca o conteúdo do arquivo — e fica guardado por
        5 anos.
      </p>
    </div>
  )
}
