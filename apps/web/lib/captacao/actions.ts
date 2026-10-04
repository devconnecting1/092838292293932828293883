"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import { translateDbError } from "@/lib/propostas/db-errors"
import { CAPTURE_INBOX_ROLES } from "@/lib/propostas/permissions"
import { createClient } from "@/lib/supabase/server"

/** "Convertida" só é definida pelo cadastro do imóvel (/imoveis/novo?captacao=). */
const MANUAL_STATUSES = ["new", "contacted", "discarded"] as const

export type ManualCaptureStatus = (typeof MANUAL_STATUSES)[number]

const SUCCESS_MESSAGES: Record<ManualCaptureStatus, string> = {
  new: "Captação reaberta.",
  contacted: "Captação marcada como contatada.",
  discarded: "Captação descartada.",
}

const NO_PERMISSION = "Você não tem permissão para atualizar captações."

export async function updateCaptureStatus(
  captureId: string,
  status: ManualCaptureStatus
): Promise<ActionResult> {
  const id = z.guid().safeParse(captureId)
  const target = z.enum(MANUAL_STATUSES).safeParse(status)

  if (!id.success || !target.success) return { ok: false, error: "Status inválido." }

  const { membership } = await requireMembership()

  if (!CAPTURE_INBOX_ROLES.includes(membership.role)) {
    return { ok: false, error: NO_PERMISSION }
  }

  const supabase = await createClient()

  const { data: current, error: loadError } = await supabase
    .from("capture_requests")
    .select("status")
    .eq("id", id.data)
    .eq("organization_id", membership.organizationId)
    .maybeSingle()

  if (loadError) return { ok: false, error: translateDbError(loadError, NO_PERMISSION) }
  if (!current) return { ok: false, error: "Captação não encontrada. Recarregue a página." }

  if (current.status === "converted") {
    return { ok: false, error: "Esta captação já foi convertida em imóvel." }
  }

  if (current.status === target.data) {
    return { ok: true, message: SUCCESS_MESSAGES[target.data] }
  }

  const { data, error } = await supabase
    .from("capture_requests")
    .update({ status: target.data })
    .eq("id", id.data)
    .eq("organization_id", membership.organizationId)
    .neq("status", "converted")
    .select("id")

  if (error) return { ok: false, error: translateDbError(error, NO_PERMISSION) }
  if (data.length === 0) return { ok: false, error: NO_PERMISSION }

  revalidatePath("/captacao")
  return { ok: true, message: SUCCESS_MESSAGES[target.data] }
}
