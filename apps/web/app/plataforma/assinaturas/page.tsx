import type { Metadata } from "next"
import { RefreshCcwIcon, TriangleAlertIcon } from "lucide-react"

import type { StripeKeyMode } from "@workspace/core/platform/env"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import { PageHeading } from "@/components/crm/page-placeholder"
import {
  AccountBreakdown,
  RevenueMetrics,
  RevenueWatchlists,
} from "@/components/plataforma/assinaturas/revenue-overview"
import { PlatformRpcFailureAlert } from "@/components/plataforma/platform-rpc-failure-alert"
import { RefreshButton } from "@/components/plataforma/refresh-button"
import { formatDateTime } from "@/lib/format"
import { loadPlatformRevenue, readStripeMode } from "@/lib/plataforma/assinaturas"
import { requirePlatformAdmin } from "@/lib/plataforma/admin"

export const metadata: Metadata = {
  title: "Assinaturas e receita",
}

function stripeSourceText(mode: StripeKeyMode | null): string {
  switch (mode) {
    case "teste":
      return "Dados sincronizados da Stripe em modo teste: assinaturas e cobranças são simuladas."
    case "producao":
      return "Dados sincronizados da Stripe em modo produção: cobranças reais."
    case "desconhecido":
      return "Dados sincronizados da Stripe, mas a chave deste servidor não tem formato reconhecido (modo teste ou produção desconhecido)."
    default:
      return "Stripe não configurada neste servidor: os números abaixo são os últimos sincronizados em billing_accounts."
  }
}

/**
 * Console da Plataforma: receita recorrente, contas por situação e plano,
 * testes acabando, inadimplentes, cancelamentos e novas assinaturas do mês.
 * Só leitura. Tudo sai de billing_accounts, que a Stripe (fonte da verdade)
 * sincroniza; os cálculos estão em packages/core/src/platform/revenue.ts.
 */
export default async function PlatformSubscriptionsPage() {
  await requirePlatformAdmin()

  const mode = readStripeMode()
  const result = await loadPlatformRevenue()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          title="Assinaturas e receita"
          description="Receita recorrente, contas por situação e plano, testes que estão acabando e inadimplentes. Valores em reais, sem dados de clientes."
        />
        <RefreshButton />
      </div>

      <Alert variant={mode === null || mode === "desconhecido" ? "destructive" : "default"}>
        {mode === null || mode === "desconhecido" ? <TriangleAlertIcon /> : <RefreshCcwIcon />}
        <AlertTitle>{stripeSourceText(mode)}</AlertTitle>
        <AlertDescription>
          A Stripe é a fonte da verdade e atualiza as assinaturas pelo webhook.
          {result.ok && result.data.lastSyncedAt
            ? ` Última sincronização: ${formatDateTime(result.data.lastSyncedAt)}.`
            : ""}
        </AlertDescription>
      </Alert>

      {result.ok ? (
        <>
          <RevenueMetrics summary={result.data.summary} />
          <AccountBreakdown summary={result.data.summary} />
          <RevenueWatchlists summary={result.data.summary} now={result.data.generatedAt} />
        </>
      ) : (
        <PlatformRpcFailureAlert failure={result} />
      )}
    </div>
  )
}
