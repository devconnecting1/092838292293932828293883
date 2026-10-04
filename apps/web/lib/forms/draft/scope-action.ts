"use server"

import { unstable_rethrow } from "next/navigation"

import type { FormDraftScope } from "@workspace/core/forms/draft"

import { getOrganizationContext } from "@/lib/auth/session"

/**
 * Usuário e imobiliária atuais, só para separar os rascunhos locais de
 * formulários abertos em diálogo (quem já tem os ids no servidor passa por
 * prop). Não redireciona: sem sessão, apenas não há rascunho. Não é
 * autorização; quem salva continua validando tudo no servidor.
 */
export async function getFormDraftScopeAction(): Promise<FormDraftScope | null> {
  try {
    const context = await getOrganizationContext()

    if (!context?.membership) {
      return null
    }

    return {
      userId: context.user.id,
      organizationId: context.membership.organizationId,
    }
  } catch (error) {
    unstable_rethrow(error)
    return null
  }
}
