import "server-only"

import { cache } from "react"

import { createClient } from "@/lib/supabase/server"

export type OrganizationDeletionStatus = {
  scheduled: boolean
  requestedAt: string | null
  executeAfter: string | null
  requestedByName: string | null
  /** A assinatura da Stripe ainda renova: agendar é recusado até cancelar. */
  subscriptionRenews: boolean
}

export type AccountDeletionBlocker = { organizationId: string; organizationName: string }

/**
 * Exclusão agendada da imobiliária (membros ativos). null quando a leitura
 * falha: quem chama não mostra nada e o banco continua aplicando a trava.
 */
export const getOrganizationDeletion = cache(
  async (organizationId: string): Promise<OrganizationDeletionStatus | null> => {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("get_organization_deletion", {
      p_organization_id: organizationId,
    })

    if (error) {
      console.error(`[exclusao] get_organization_deletion falhou (código ${error.code || "vazio"})`)
      return null
    }

    const row = data?.[0]

    if (!row) {
      return null
    }

    return {
      scheduled: Boolean(row.scheduled),
      requestedAt: row.requested_at,
      executeAfter: row.execute_after,
      requestedByName: row.requested_by_name,
      subscriptionRenews: Boolean(row.subscription_renews),
    }
  }
)

/** Imobiliárias em que o usuário é o único dono ativo (impedem excluir a conta). */
export async function getAccountDeletionBlockers(): Promise<AccountDeletionBlocker[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_my_account_deletion_blockers")

  if (error) {
    console.error(
      `[exclusao] get_my_account_deletion_blockers falhou (código ${error.code || "vazio"})`
    )
    return null
  }

  return (data ?? []).map((row) => ({
    organizationId: row.organization_id,
    organizationName: row.organization_name,
  }))
}
