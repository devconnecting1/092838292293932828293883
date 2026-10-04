import "server-only"

import type { HealthSection } from "@workspace/core/platform/health"
import { buildPlatformHealthSections } from "@workspace/core/platform/sections"

import { caixaFailureLabel } from "@/lib/plataforma/caixa-labels"
import { getCaixaLoadSummary } from "@/lib/plataforma/caixa-queries"
import { isProductionBuild, readPlatformEnvSnapshot } from "@/lib/plataforma/env"
import { getPlatformHealthSnapshot, type PlatformRpcFailure } from "@/lib/plataforma/rpc"
import { createClient } from "@/lib/supabase/server"

export type PlatformHealthReport = {
  checkedAt: Date
  sections: HealthSection[]
  /** Falha ao ler o banco global (chave ausente, recusada ou erro); null se deu certo. */
  databaseFailure: PlatformRpcFailure | null
}

async function readCaixaLoad() {
  try {
    const supabase = await createClient()
    const summary = await getCaixaLoadSummary(supabase)

    return {
      ok: true as const,
      value: summary
        ? {
            syncedAt: summary.sincronizado_em,
            listGeneratedOn: summary.lista_gerada_em,
            totalActive: summary.total_ativo,
            lastResult: summary.last_result,
            lastFailureAt: summary.last_failure_at,
            lastFailureLabel: caixaFailureLabel(summary.last_failure_reason),
          }
        : null,
    }
  } catch (cause) {
    console.error(
      `[plataforma] última carga da Caixa indisponível (${cause instanceof Error ? cause.name : "erro"})`
    )
    return { ok: false as const, reason: "Não foi possível ler a última carga da Caixa agora." }
  }
}

/**
 * Tudo o que a tela "Saúde do sistema" mostra. Chame só depois de
 * `requirePlatformAdmin()`; as RPCs globais conferem o administrador de novo.
 */
export async function loadPlatformHealth(): Promise<PlatformHealthReport> {
  const [database, caixa] = await Promise.all([getPlatformHealthSnapshot(), readCaixaLoad()])
  const checkedAt = new Date()

  return {
    checkedAt,
    databaseFailure: database.ok ? null : database,
    sections: buildPlatformHealthSections({
      now: checkedAt,
      env: readPlatformEnvSnapshot(),
      production: isProductionBuild(),
      database: database.ok
        ? { ok: true, value: database.data }
        : { ok: false, reason: database.message },
      caixa,
    }),
  }
}
