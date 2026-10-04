"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import { CLIENTS_PATH } from "@/lib/clientes/constants"
import { permissionDeniedMessage, translateDatabaseError } from "@/lib/clientes/db-errors"
import { createClient } from "@/lib/supabase/server"

const idSchema = z.guid()

/** Compartilha o cliente com um colega (quem edita o cliente pode compartilhar). */
export async function addClientShare(clientId: string, userId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(clientId).success || !idSchema.safeParse(userId).success) {
    return { ok: false, error: "Selecione um colega válido." }
  }

  const { user, membership } = await requireMembership()
  const action = "compartilhar este cliente"

  if (membership.role === "finance") {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  if (userId === user.id) {
    return { ok: false, error: "Você já tem acesso a este cliente." }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("client_shares").insert({
    organization_id: membership.organizationId,
    client_id: clientId,
    user_id: userId,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  revalidatePath(`${CLIENTS_PATH}/${clientId}`)

  return { ok: true, message: "Cliente compartilhado." }
}

/** Remove o compartilhamento (dono, gerente ou quem compartilhou). */
export async function removeClientShare(shareId: string, clientId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(shareId).success || !idSchema.safeParse(clientId).success) {
    return { ok: false, error: "Compartilhamento inválido." }
  }

  const { membership } = await requireMembership()
  const action = "remover este compartilhamento"
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("client_shares")
    .delete()
    .eq("id", shareId)
    .eq("client_id", clientId)
    .eq("organization_id", membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  if (data.length === 0) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  revalidatePath(`${CLIENTS_PATH}/${clientId}`)

  return { ok: true, message: "Compartilhamento removido." }
}
