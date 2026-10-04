import { MailWarningIcon } from "lucide-react"

import {
  emailFailureLabel,
  emailKindLabel,
  emailPriorityForKind,
} from "@workspace/core/email/quota"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"

import { createClient } from "@/lib/supabase/server"

const numberFormat = new Intl.NumberFormat("pt-BR")

type Row = { kind: string; reason: string; notices: number }

async function loadUndeliveredEmails(organizationId: string): Promise<Row[] | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("dashboard_undelivered_emails", {
      p_organization_id: organizationId,
    })

    if (error || !Array.isArray(data)) {
      if (error) {
        console.error(`[painel] avisos não enviados indisponíveis (código ${error.code || "?"})`)
      }
      return null
    }

    return data.flatMap((row) =>
      typeof row.kind === "string" &&
      typeof row.reason === "string" &&
      typeof row.notices === "number" &&
      row.notices > 0
        ? [{ kind: row.kind, reason: row.reason, notices: row.notices }]
        : []
    )
  } catch (cause) {
    console.error(
      `[painel] avisos não enviados indisponíveis (${cause instanceof Error ? cause.name : "erro"})`
    )
    return null
  }
}

/**
 * "Avisos não enviados hoje" (dono e gerente): e-mails desta imobiliária que não
 * saíram hoje — cota diária da plataforma, limite ou falha do provedor. Só
 * contagens por tipo e motivo, sem nome nem e-mail. Some quando está tudo em
 * dia (ou quando não carregou: não assusta ninguém à toa).
 */
export async function UndeliveredEmailsCard({ organizationId }: { organizationId: string }) {
  const rows = await loadUndeliveredEmails(organizationId)

  if (!rows || rows.length === 0) {
    return null
  }

  const total = rows.reduce((sum, row) => sum + row.notices, 0)
  const sorted = [...rows].sort(
    (a, b) => emailPriorityForKind(a.kind) - emailPriorityForKind(b.kind) || b.notices - a.notices
  )
  const hasLeadNotices = rows.some((row) => emailPriorityForKind(row.kind) === 1)

  return (
    <div className="px-4 lg:px-6">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Avisos não enviados hoje</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {numberFormat.format(total)}
          </CardTitle>
          <CardAction>
            <MailWarningIcon className="text-muted-foreground" aria-hidden />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {hasLeadNotices
              ? "O e-mail não saiu, mas o lead está no CRM e o aviso no celular continua saindo para quem ligou as notificações. Confira os leads novos no funil."
              : "Estes e-mails não saíram. Tudo continua registrado no CRM; o sistema tenta de novo quando houver cota."}
          </p>
          <ItemGroup className="gap-2">
            {sorted.map((row) => (
              <Item key={`${row.kind}:${row.reason}`} variant="outline" size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full min-w-0">
                    <span className="truncate">{emailKindLabel(row.kind)}</span>
                  </ItemTitle>
                  <ItemDescription className="truncate">
                    {emailFailureLabel(row.reason)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge variant={emailPriorityForKind(row.kind) === 1 ? "destructive" : "outline"}>
                    {numberFormat.format(row.notices)}
                  </Badge>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>
    </div>
  )
}
