import "server-only"

import {
  isDefaultStageProbabilities,
  toStageProbabilities,
  type StageProbabilities,
} from "@workspace/core/reports/stage-probabilities"

import { createClient } from "@/lib/supabase/server"

export type StageProbabilitiesState = {
  values: StageProbabilities
  /** Nenhuma etapa gravada pelo dono: vale o padrão do banco. */
  usingDefaults: boolean
}

/** Probabilidade em vigor por etapa (a do dono ou a padrão), pela RPC do banco. */
export async function getStageProbabilities(
  organizationId: string
): Promise<StageProbabilitiesState> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_proposal_stage_probabilities", {
    p_organization_id: organizationId,
  })

  if (error) {
    throw new Error(
      `Não foi possível carregar as probabilidades da previsão (${error.code ?? "erro"}).`
    )
  }

  const rows = data ?? []
  const values = toStageProbabilities(rows)

  return {
    values,
    usingDefaults: rows.every((row) => row.is_default) && isDefaultStageProbabilities(values),
  }
}
