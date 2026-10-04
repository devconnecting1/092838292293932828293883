import type { Metadata } from "next"
import { TriangleAlertIcon } from "lucide-react"

import { LEAD_DELIVERY_STATUS_LABELS } from "@workspace/core/leads/ingest"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { PageHeading } from "@/components/crm/page-placeholder"
import {
  CanalProCard,
  DeliveriesTable,
  MetaCard,
} from "@/components/configuracoes/lead-integrations"
import { PageShell } from "@/components/shared/page-shell"
import { TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import { requireRole } from "@/lib/auth/session"
import { buildCanalProWebhookUrl, buildMetaWebhookUrl } from "@/lib/integracoes/constants"
import { getLeadIntegrationsOverview } from "@/lib/integracoes/queries"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Integrações",
}

/**
 * Onde a imobiliária liga as contas DELA nas origens de lead e confere, sem
 * pedir ajuda, se está entrando: as últimas entregas, o que foi recusado e por
 * quê, e um botão de teste.
 */
export default async function IntegracoesPage() {
  const { membership } = await requireRole(TEAM_MANAGER_ROLES)
  const supabase = await createClient()
  const state = await getLeadIntegrationsOverview(supabase, membership.organizationId)

  const header = (
    <PageHeading
      title="Integrações"
      description="Conecte os portais e os anúncios para o contato entrar direto no funil, com o corretor da vez e o prazo de resposta valendo."
    />
  )

  if (state.status !== "ok") {
    return (
      <PageShell variant="settings" width="wide" header={header}>
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            {state.status === "forbidden"
              ? "Seu papel não vê as integrações"
              : "Não deu para carregar"}
          </AlertTitle>
          <AlertDescription>
            {state.status === "forbidden"
              ? "Só o dono e o gerente da imobiliária configuram as integrações."
              : state.message}
          </AlertDescription>
        </Alert>
      </PageShell>
    )
  }

  const { integrations, deliveries, totals } = state.overview
  const canalProToken = integrations.canal_pro.webhookToken
  const summary = (["canal_pro", "meta_lead_ads"] as const).flatMap((provider) =>
    Object.entries(totals[provider]).map(([status, total]) => ({
      key: `${provider}-${status}`,
      label: LEAD_DELIVERY_STATUS_LABELS[status as keyof typeof LEAD_DELIVERY_STATUS_LABELS],
      total,
    }))
  )

  return (
    <PageShell variant="settings" width="wide" header={header}>
      <CanalProCard
        integration={integrations.canal_pro}
        webhookUrl={canalProToken ? buildCanalProWebhookUrl(canalProToken) : null}
      />

      <MetaCard integration={integrations.meta_lead_ads} webhookUrl={buildMetaWebhookUrl()} />

      <Card>
        <CardHeader>
          <CardTitle>Últimas entregas recebidas</CardTitle>
          <CardDescription>
            Tudo o que as origens mandaram, aceito ou não. Entrega recusada aparece aqui com o
            motivo, para você não descobrir o problema pelo cliente reclamando.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {summary.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Últimos 30 dias:</span>
              {summary.map((item) => (
                <Badge key={item.key} variant="outline">
                  {item.label}: {item.total}
                </Badge>
              ))}
            </div>
          ) : null}

          <DeliveriesTable deliveries={deliveries} />
        </CardContent>
      </Card>
    </PageShell>
  )
}
