import { SparklesIcon, TriangleAlertIcon } from "lucide-react"

import {
  AI_USAGE_WARNING_RATIO,
  aiUsageRatio,
  formatBRL,
  formatLimit,
  isUnlimited,
  usageRatio,
} from "@workspace/core/billing"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Progress, ProgressLabel } from "@workspace/ui/components/progress"

import { AiOverageCapForm } from "@/components/billing/ai-overage-cap-form"
import { describeRenewal } from "@/lib/ai/messages"
import type { AiUsageOverview } from "@/lib/ai/types"
import { formatDate, formatNumber } from "@/lib/format"

type AiUsageCardProps = {
  overview: AiUsageOverview
  /** Dono ou gerente: pode definir o teto de excedente. */
  canManage: boolean
}

function percent(ratio: number | null) {
  return ratio === null ? 0 : Math.min(100, Math.round(ratio * 100))
}

/**
 * Uso de IA do ciclo: franquia de conversas, custo contra o teto em reais,
 * tetos de dia e semana e o teto de excedente da imobiliária.
 */
export function AiUsageCard({ overview, canManage }: AiUsageCardProps) {
  const unlimited = isUnlimited(overview.conversationsLimit)
  const included = overview.conversationsLimit !== 0
  // Teste grátis não tem IA (o banco devolve franquia 0 em qualquer conta em teste).
  const trial = overview.billingState === "trialing" || overview.planKey === "trial"
  const conversationRatio = usageRatio(overview.conversationsLimit, overview.conversationsUsed)
  const costRatio =
    overview.effectiveCapCents > 0 ? overview.costCents / overview.effectiveCapCents : 0
  const ratio = aiUsageRatio({
    conversationsLimit: overview.conversationsLimit,
    conversationsUsed: overview.conversationsUsed,
    costMillicents: overview.costCents,
    capMillicents: overview.effectiveCapCents,
  })
  const overageUsedCents = Math.max(0, overview.costCents - overview.planCapCents)
  const inOverage = overageUsedCents > 0
  const empty = overview.requests === 0 && overview.conversationsUsed === 0
  const renewal = describeRenewal(overview.periodEnd)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Uso de IA</CardTitle>
        <CardDescription>
          Ciclo de {formatDate(overview.periodStart)} a {formatDate(overview.periodEnd)}
          {renewal ? `. A franquia vira ${renewal}` : ""}.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {trial ? (
          <Alert>
            <SparklesIcon />
            <AlertTitle>A IA começa quando você assina</AlertTitle>
            <AlertDescription>
              O teste grátis tem os recursos do plano, menos a IA. Assine um plano com conversas de
              IA para usar o atendimento e os textos automáticos.
            </AlertDescription>
          </Alert>
        ) : !included ? (
          <Alert>
            <SparklesIcon />
            <AlertTitle>IA não inclusa neste plano</AlertTitle>
            <AlertDescription>
              Mude para um plano com conversas de IA para usar o atendimento e os textos
              automáticos.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {unlimited ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium">Conversas de IA</span>
                  <span className="ms-auto text-sm text-muted-foreground tabular-nums">
                    {formatNumber(overview.conversationsUsed)} · Ilimitado
                  </span>
                </div>
              ) : (
                <Progress value={percent(conversationRatio)}>
                  <ProgressLabel>Conversas de IA</ProgressLabel>
                  <span className="ms-auto text-sm text-muted-foreground tabular-nums">
                    {formatNumber(overview.conversationsUsed)} de{" "}
                    {formatLimit(overview.conversationsLimit)}
                  </span>
                </Progress>
              )}
              <p className="text-sm text-muted-foreground">
                Uma conversa é a janela de 24 horas com o mesmo contato, por mais mensagens que
                tenha. Pedidos avulsos (redigir anúncio, resumir conversa, sugerir resposta) contam
                1 cada.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Progress value={percent(costRatio)}>
                <ProgressLabel>Custo do ciclo</ProgressLabel>
                <span className="ms-auto text-sm text-muted-foreground tabular-nums">
                  {formatBRL(overview.costCents)} de {formatBRL(overview.effectiveCapCents)}
                </span>
              </Progress>
              <p className="text-sm text-muted-foreground">
                Teto do plano: {formatBRL(overview.planCapCents)}
                {overview.overageCapCents > 0
                  ? ` + excedente autorizado de ${formatBRL(overview.overageCapCents)}`
                  : " (sem excedente autorizado)"}
                .
              </p>
              {ratio >= AI_USAGE_WARNING_RATIO ? (
                <Badge variant={ratio >= 1 ? "destructive" : "secondary"} className="self-start">
                  {ratio >= 1 ? "Limite atingido" : "Perto do limite"}
                </Badge>
              ) : null}
            </div>

            {empty ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma conversa de IA neste ciclo ainda.
              </p>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Pedidos à IA</dt>
                <dd className="tabular-nums">{formatNumber(overview.requests)}</dd>
                <dt className="text-muted-foreground">Hoje</dt>
                <dd className="tabular-nums">
                  {formatBRL(overview.dayCostCents)} de {formatBRL(overview.dayCapCents)}
                </dd>
                <dt className="text-muted-foreground">Nesta semana</dt>
                <dd className="tabular-nums">
                  {formatBRL(overview.weekCostCents)} de {formatBRL(overview.weekCapCents)}
                </dd>
                {inOverage ? (
                  <>
                    <dt className="text-muted-foreground">Excedente usado</dt>
                    <dd className="tabular-nums">
                      {formatBRL(overageUsedCents)} de {formatBRL(overview.overageCapCents)}
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Tokens (entrada · saída)</dt>
                <dd className="tabular-nums">
                  {formatNumber(overview.inputTokens)} · {formatNumber(overview.outputTokens)}
                </dd>
                <dt className="text-muted-foreground">Cache (leitura · escrita)</dt>
                <dd className="tabular-nums">
                  {formatNumber(overview.cacheReadTokens)} ·{" "}
                  {formatNumber(overview.cacheWriteTokens)}
                </dd>
              </dl>
            )}

            {ratio >= 1 ? (
              <Alert variant={overview.overageCapCents > 0 ? "warning" : "destructive"}>
                <TriangleAlertIcon />
                <AlertTitle>
                  {overview.overageCapCents > 0
                    ? "A IA está no excedente"
                    : "A IA está pausada neste ciclo"}
                </AlertTitle>
                <AlertDescription>
                  {overview.overageCapCents > 0
                    ? `A franquia acabou e o consumo segue dentro do teto de excedente de ${formatBRL(overview.overageCapCents)}. Quando ele acabar, a IA para${renewal ? ` até ${renewal}` : ""}.`
                    : `A franquia acabou e não há excedente autorizado, então a IA não é acionada${renewal ? ` até ${renewal}` : ""}. Libere um teto de excedente abaixo ou mude de plano.`}
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        )}
      </CardContent>

      {/* Sem franquia no plano, o excedente não libera nada: o corte é anterior. */}
      {included && !trial ? (
        <CardFooter className="flex-col items-stretch gap-3 border-t">
          <AiOverageCapForm
            overageCapCents={overview.overageCapCents}
            maxOverageCapCents={overview.maxOverageCapCents}
            canManage={canManage}
          />
        </CardFooter>
      ) : null}
    </Card>
  )
}
