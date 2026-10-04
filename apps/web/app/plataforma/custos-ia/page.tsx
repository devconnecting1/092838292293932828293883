import type { Metadata } from "next"

import { isAiCostCycle, summarizeAiCosts } from "@workspace/core/platform/ai-costs"

import { PageHeading } from "@/components/crm/page-placeholder"
import { AiCostsOverview } from "@/components/plataforma/custos-ia/ai-costs-overview"
import { PlatformRpcFailureAlert } from "@/components/plataforma/platform-rpc-failure-alert"
import { RefreshButton } from "@/components/plataforma/refresh-button"
import { formatDateTime } from "@/lib/format"
import { requirePlatformAdmin } from "@/lib/plataforma/admin"
import { getPlatformAiCosts } from "@/lib/plataforma/custos-ia"

export const metadata: Metadata = {
  title: "Custos de IA",
}

type PlatformAiCostsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Custos de IA de todas as imobiliárias: ciclo atual ou anterior, contra o teto
 * do plano, e a conversa real contra a estimativa usada nos planos. Só leitura
 * e só números (nenhum conteúdo de conversa).
 */
export default async function PlatformAiCostsPage({ searchParams }: PlatformAiCostsPageProps) {
  await requirePlatformAdmin()

  const [params, result] = await Promise.all([searchParams, getPlatformAiCosts()])
  const cycleParam = Array.isArray(params.ciclo) ? params.ciclo[0] : params.ciclo
  const cycle = isAiCostCycle(cycleParam) ? cycleParam : "atual"

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          title="Custos de IA"
          description={
            result.ok && result.data.generatedAt
              ? `Custo real medido até ${formatDateTime(result.data.generatedAt)}, contra o teto de cada plano. Só números: nenhum conteúdo de conversa.`
              : "Custo real medido, contra o teto de cada plano. Só números: nenhum conteúdo de conversa."
          }
        />
        <RefreshButton />
      </div>

      {result.ok ? (
        <AiCostsOverview snapshot={result.data} summary={summarizeAiCosts(result.data, cycle)} />
      ) : (
        <PlatformRpcFailureAlert failure={result} />
      )}
    </div>
  )
}
