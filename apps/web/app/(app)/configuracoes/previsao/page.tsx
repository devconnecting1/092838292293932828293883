import type { Metadata } from "next"
import { InfoIcon, LockIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { PageHeading } from "@/components/crm/page-placeholder"
import { StageProbabilitiesForm } from "@/components/previsao/stage-probabilities-form"
import { PageShell } from "@/components/shared/page-shell"
import { requireRole } from "@/lib/auth/session"
import { canEditForecastProbabilities, FORECAST_VIEWER_ROLES } from "@/lib/previsao/constants"
import { getStageProbabilities } from "@/lib/previsao/queries"

export const metadata: Metadata = {
  title: "Previsão de vendas",
}

export default async function PrevisaoSettingsPage() {
  const { membership } = await requireRole(FORECAST_VIEWER_ROLES)
  const canEdit = canEditForecastProbabilities(membership.role)
  const { values, usingDefaults } = await getStageProbabilities(membership.organizationId)

  return (
    <PageShell
      variant="settings"
      header={
        <PageHeading
          title="Previsão de vendas"
          description="A chance de fechar cada proposta em aberto, conforme a etapa. É o peso usado no pipeline ponderado dos relatórios."
        />
      }
    >
      <Alert>
        <InfoIcon />
        <AlertTitle>Como a previsão é calculada</AlertTitle>
        <AlertDescription>
          Entram as propostas em aberto (rascunho, enviada e contraproposta) com data prevista de
          fechamento no mês: cada uma soma o valor multiplicado pela probabilidade da etapa. As
          propostas aceitas no mês entram inteiras (100%) como comprometido. Venda e locação são
          somadas separadamente, e proposta sem data prevista não entra no mês.
        </AlertDescription>
      </Alert>

      {!canEdit ? (
        <Alert>
          <LockIcon />
          <AlertTitle>Só o dono altera</AlertTitle>
          <AlertDescription>
            Você vê os valores em vigor. Para mudar, peça ao dono da imobiliária.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Probabilidade por etapa</CardTitle>
          <CardDescription>
            Números inteiros de 0% a 100%. Valem para todas as propostas da imobiliária a partir de
            agora, inclusive as que já estão em aberto.
          </CardDescription>
          <CardAction>
            <Badge variant={usingDefaults ? "secondary" : "outline"}>
              {usingDefaults ? "Padrão" : "Personalizada"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <StageProbabilitiesForm
            defaultValues={values}
            usingDefaults={usingDefaults}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </PageShell>
  )
}
