"use server"

import { revalidatePath } from "next/cache"

import { permissionDeniedMessage } from "@/lib/auth/permission-messages"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"
import { translateDatabaseError } from "@/lib/configuracoes/errors"
import {
  exportRolesFormSchema,
  exportRolesLabel,
  normalizeExportRoles,
  type ExportRolesFormValues,
} from "@/lib/configuracoes/export-permissions"
import { createClient } from "@/lib/supabase/server"

const PAGE_PATH = "/configuracoes/permissoes"
const REPORTS_PATH = "/relatorios"

/**
 * Quem exporta CSV nesta imobiliária. Só o dono (a RPC confere de novo e
 * registra a mudança em audit_events); a imobiliária vem da sessão, nunca do
 * formulário.
 */
export async function saveExportRoles(
  values: ExportRolesFormValues
): Promise<FormActionResult<keyof ExportRolesFormValues>> {
  const parsed = exportRolesFormSchema.safeParse(values)

  if (!parsed.success) {
    return { ok: false, error: "Escolha apenas papéis da lista." }
  }

  const auth = await getActionMembership(["owner"])

  if (!auth.ok) {
    return {
      ok: false,
      error: permissionDeniedMessage("mudar quem exporta os dados", ["owner"]),
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("set_export_roles", {
    p_organization_id: auth.context.membership.organizationId,
    p_roles: parsed.data.roles,
  })

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "Não foi possível salvar quem exporta. Tente de novo."),
    }
  }

  revalidatePath(PAGE_PATH)
  revalidatePath(REPORTS_PATH)

  return {
    ok: true,
    message: `Salvo. Agora exportam: ${exportRolesLabel(normalizeExportRoles(data))}.`,
  }
}
