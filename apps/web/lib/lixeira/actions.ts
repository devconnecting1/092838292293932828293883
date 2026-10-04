"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { permissionDeniedMessage } from "@/lib/auth/permission-messages"
import { requireMembership } from "@/lib/auth/session"
import { CLIENTS_PATH } from "@/lib/clientes/constants"
import { translateDatabaseError, type DatabaseErrorLike } from "@/lib/clientes/db-errors"
import { LEADS_PATH } from "@/lib/leads/constants"
import {
  describeLegalHolds,
  isTrashEntity,
  TRASH_RETENTION_DAYS,
  TRASH_ROLES,
  TRASH_SETTINGS_PATH,
  type TrashEntity,
} from "@/lib/lixeira/constants"
import { drainStoragePurgeQueue } from "@/lib/lixeira/storage"
import { createClient } from "@/lib/supabase/server"

const idSchema = z.string().uuid()
const confirmationSchema = z.string().trim().min(1).max(300)

type Checked =
  { ok: true; entity: TrashEntity; organizationId: string } | { ok: false; error: string }

async function check(entity: unknown, recordId: unknown, action: string): Promise<Checked> {
  if (!isTrashEntity(entity) || !idSchema.safeParse(recordId).success) {
    return { ok: false, error: "Registro inválido." }
  }

  const { membership } = await requireMembership()

  if (!TRASH_ROLES.includes(membership.role)) {
    return { ok: false, error: permissionDeniedMessage(action, TRASH_ROLES) }
  }

  return { ok: true, entity, organizationId: membership.organizationId }
}

function revalidateEntity(entity: TrashEntity, recordId: string) {
  revalidatePath(TRASH_SETTINGS_PATH)
  revalidatePath("/painel")

  if (entity === "lead") {
    revalidatePath(LEADS_PATH)
    revalidatePath(`${LEADS_PATH}/${recordId}`)
  } else if (entity === "client") {
    revalidatePath(CLIENTS_PATH)
    revalidatePath(`${CLIENTS_PATH}/${recordId}`)
  } else {
    revalidatePath("/imoveis")
    revalidatePath(`/imoveis/${recordId}`)
  }
}

/** Erros das RPCs da lixeira: as mensagens do banco já vêm em pt-BR e sem dado pessoal. */
function translateTrashError(error: DatabaseErrorLike, action: string) {
  if (error.hint === "guarda_legal") {
    const holds = (error.details ?? "").split(",").filter(Boolean)
    return `Este registro tem guarda legal (${describeLegalHolds(holds)}) e não pode ser apagado por inteiro. Use "Anonimizar dados pessoais".`
  }

  if (error.code === "55000") {
    return error.message
  }

  if (error.code === "42501") {
    return permissionDeniedMessage(action, TRASH_ROLES)
  }

  return translateDatabaseError(error, action)
}

/** "Excluir": move lead, cliente ou imóvel para a lixeira por 30 dias. */
export async function moveToTrash(entity: TrashEntity, recordId: string): Promise<ActionResult> {
  const action = "excluir registros"
  const checked = await check(entity, recordId, action)
  if (!checked.ok) return checked

  const supabase = await createClient()
  const { error } = await supabase.rpc("move_to_trash", {
    p_entity: checked.entity,
    p_record_id: recordId,
  })

  if (error) {
    return { ok: false, error: translateTrashError(error, action) }
  }

  revalidateEntity(checked.entity, recordId)

  return {
    ok: true,
    message: `Movido para a lixeira. Dá para restaurar em Configurações > Lixeira por ${TRASH_RETENTION_DAYS} dias.`,
  }
}

export async function restoreFromTrash(
  entity: TrashEntity,
  recordId: string
): Promise<ActionResult> {
  const action = "restaurar registros da lixeira"
  const checked = await check(entity, recordId, action)
  if (!checked.ok) return checked

  const supabase = await createClient()
  const { error } = await supabase.rpc("restore_from_trash", {
    p_entity: checked.entity,
    p_record_id: recordId,
  })

  if (error) {
    return { ok: false, error: translateTrashError(error, action) }
  }

  revalidateEntity(checked.entity, recordId)
  return { ok: true, message: "Restaurado." }
}

/** "Excluir permanentemente": só sem guarda legal; confirmação = nome/título digitado. */
export async function purgeFromTrash(
  entity: TrashEntity,
  recordId: string,
  confirmation: string
): Promise<ActionResult> {
  const action = "excluir registros permanentemente"
  const checked = await check(entity, recordId, action)
  if (!checked.ok) return checked

  const typed = confirmationSchema.safeParse(confirmation)
  if (!typed.success) {
    return { ok: false, error: "Digite o nome exatamente como aparece para confirmar." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("purge_from_trash", {
    p_entity: checked.entity,
    p_record_id: recordId,
    p_confirmation: typed.data,
  })

  if (error) {
    return { ok: false, error: translateTrashError(error, action) }
  }

  await drainStoragePurgeQueue(supabase, checked.organizationId)
  revalidateEntity(checked.entity, recordId)
  return { ok: true, message: "Excluído permanentemente." }
}

/** "Anonimizar dados pessoais": cliente ou imóvel da lixeira com guarda legal. */
export async function anonymizeFromTrash(
  entity: TrashEntity,
  recordId: string,
  confirmation: string
): Promise<ActionResult> {
  const action = "anonimizar dados pessoais"
  const checked = await check(entity, recordId, action)
  if (!checked.ok) return checked

  const typed = confirmationSchema.safeParse(confirmation)
  if (!typed.success) {
    return { ok: false, error: "Digite o nome exatamente como aparece para confirmar." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("anonymize_from_trash", {
    p_entity: checked.entity,
    p_record_id: recordId,
    p_confirmation: typed.data,
  })

  if (error) {
    return { ok: false, error: translateTrashError(error, action) }
  }

  await drainStoragePurgeQueue(supabase, checked.organizationId)
  revalidateEntity(checked.entity, recordId)
  return { ok: true, message: "Dados pessoais anonimizados. O que a lei obriga a guardar ficou." }
}

type ErasureOutcome = {
  outcome?: string
  legal_holds?: string[]
  identification_kept_until?: string | null
  linked_client?: ErasureOutcome | null
}

function describeOutcome(result: ErasureOutcome | null | undefined) {
  if (!result || result.outcome === "deleted") {
    return "apagados"
  }

  const holds = describeLegalHolds(result.legal_holds ?? [])
  return `anonimizados (guardado por obrigação legal: ${holds})`
}

/**
 * "Excluir dados a pedido do titular" (LGPD art. 18): lead ou cliente. Apaga na
 * hora ou, com guarda legal, anonimiza. O comprovante (sem dado pessoal) fica
 * em Configurações > Lixeira e, quando o cliente é anonimizado, no histórico.
 */
export async function eraseSubjectData(
  entity: "lead" | "client",
  recordId: string,
  confirmation: string
): Promise<ActionResult> {
  const action = "atender pedidos de exclusão do titular"

  if (entity !== "lead" && entity !== "client") {
    return { ok: false, error: "Registro inválido." }
  }

  const checked = await check(entity, recordId, action)
  if (!checked.ok) return checked

  const typed = confirmationSchema.safeParse(confirmation)
  if (!typed.success) {
    return { ok: false, error: "Digite o nome exatamente como aparece para confirmar." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("erase_subject_data", {
    p_entity: checked.entity,
    p_record_id: recordId,
    p_confirmation: typed.data,
  })

  if (error) {
    return { ok: false, error: translateTrashError(error, action) }
  }

  await drainStoragePurgeQueue(supabase, checked.organizationId)
  revalidateEntity(checked.entity, recordId)

  const result = (data ?? null) as ErasureOutcome | null
  const linked = result?.linked_client
    ? ` Cliente vinculado: dados ${describeOutcome(result.linked_client)}.`
    : ""

  return {
    ok: true,
    message: `Pedido do titular atendido: dados ${describeOutcome(result)}.${linked} O comprovante está em Configurações > Lixeira.`,
  }
}
