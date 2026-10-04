import "server-only"

import {
  parsePlatformAiCosts,
  type PlatformAiCostsSnapshot,
} from "@workspace/core/platform/ai-costs"

import {
  PlatformRpcError,
  throwPlatformRpcError,
  withPlatformRpc,
  type PlatformRpcResult,
} from "@/lib/plataforma/rpc"

export const PLATFORM_AI_COSTS_PATH = "/plataforma/custos-ia"

/**
 * Custo real de IA de todas as imobiliárias (`platform_ai_costs`): ciclo atual
 * e anterior como estão em `ai_usage_periods`, teto do plano, preço e câmbio do
 * banco. Só números. Chame depois de `requirePlatformAdmin()`.
 */
export async function getPlatformAiCosts(): Promise<PlatformRpcResult<PlatformAiCostsSnapshot>> {
  const operation = "platform_ai_costs"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, { p_server_key: serverKey })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    const snapshot = parsePlatformAiCosts(data)

    if (!snapshot) {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return snapshot
  })
}
