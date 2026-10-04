"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import { activityFormSchema, type ActivityFormValues } from "@/lib/clientes/activity-schema"
import { CLIENTS_PATH } from "@/lib/clientes/constants"
import { permissionDeniedMessage, translateDatabaseError } from "@/lib/clientes/db-errors"
import { canDeleteClientData } from "@/lib/clientes/permissions"
import { createClient } from "@/lib/supabase/server"

const idSchema = z.guid()

export async function createClientActivity(
  clientId: string,
  values: ActivityFormValues
): Promise<ActionResult> {
  if (!idSchema.safeParse(clientId).success) {
    return { ok: false, error: "Cliente inválido." }
  }

  const parsed = activityFormSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Confira os campos.",
    }
  }

  const { membership } = await requireMembership()
  const action = "registrar atividades neste cliente"

  if (membership.role === "finance") {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("activities").insert({
    organization_id: membership.organizationId,
    client_id: clientId,
    type: parsed.data.type,
    body: parsed.data.body,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  revalidatePath(`${CLIENTS_PATH}/${clientId}`)

  return { ok: true, message: "Atividade registrada." }
}

export async function deleteClientActivity(
  activityId: string,
  clientId: string
): Promise<ActionResult> {
  if (!idSchema.safeParse(activityId).success || !idSchema.safeParse(clientId).success) {
    return { ok: false, error: "Atividade inválida." }
  }

  const { membership } = await requireMembership()
  const action = "excluir atividades"

  if (!canDeleteClientData(membership.role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("activities")
    .delete()
    .eq("id", activityId)
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

  return { ok: true, message: "Atividade excluída." }
}
