"use server"

import { revalidatePath } from "next/cache"

import { normalizeCnpj, normalizePhoneBr } from "@workspace/core/br/documents"
import type { TablesUpdate } from "@workspace/database/types"

import type { ActionResult } from "@/lib/auth/action-result"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"
import { mergeOrganizationBrand } from "@/lib/configuracoes/brand"
import { PERMISSION_DENIED_MESSAGE, translateDatabaseError } from "@/lib/configuracoes/errors"
import {
  brandSchema,
  getFieldErrors,
  organizationDataSchema,
  type BrandValues,
  type OrganizationDataValues,
} from "@/lib/configuracoes/schemas"
import { createClient } from "@/lib/supabase/server"

const PAGE_PATH = "/configuracoes/imobiliaria"
const OWNER_ONLY = ["owner"] as const

export async function updateOrganizationData(
  values: OrganizationDataValues
): Promise<FormActionResult<keyof OrganizationDataValues>> {
  const parsed = organizationDataSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: getFieldErrors<keyof OrganizationDataValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(OWNER_ONLY)

  if (!auth.ok) {
    return auth
  }

  const data = parsed.data
  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("organizations")
    .update({
      name: data.name,
      legal_name: data.legalName,
      cnpj: data.cnpj ? normalizeCnpj(data.cnpj) : null,
      creci: data.creci,
      phone: data.phone ? normalizePhoneBr(data.phone) : null,
      email: data.email ? data.email.toLowerCase() : null,
      city: data.city,
      state: data.state,
    })
    .eq("id", auth.context.membership.organizationId)
    .select("id")

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Já existe uma imobiliária cadastrada com este CNPJ.",
        fieldErrors: { cnpj: "Já existe uma imobiliária com este CNPJ." },
      }
    }

    return { ok: false, error: translateDatabaseError(error) }
  }

  // Com RLS, um UPDATE sem permissão não dá erro: só não altera nenhuma linha.
  if (!updated?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  // O nome aparece no seletor de imobiliárias da casca.
  revalidatePath("/", "layout")

  return { ok: true, message: "Dados da imobiliária salvos." }
}

export async function updateOrganizationBrand(
  values: BrandValues
): Promise<FormActionResult<keyof BrandValues>> {
  const parsed = brandSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: getFieldErrors<keyof BrandValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(OWNER_ONLY)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const supabase = await createClient()
  const { data: current, error: readError } = await supabase
    .from("organizations")
    .select("brand")
    .eq("id", organizationId)
    .maybeSingle()

  if (readError || !current) {
    return {
      ok: false,
      error: readError ? translateDatabaseError(readError) : PERMISSION_DENIED_MESSAGE,
    }
  }

  const brand = mergeOrganizationBrand(current.brand, {
    primaryColor: parsed.data.primaryColor || null,
    logoUrl: parsed.data.logoUrl || null,
  }) as TablesUpdate<"organizations">["brand"]

  const { data: updated, error } = await supabase
    .from("organizations")
    .update({ brand })
    .eq("id", organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!updated?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath(PAGE_PATH)

  return { ok: true, message: "Marca atualizada." }
}

export async function rotateFeedToken(): Promise<ActionResult> {
  const auth = await getActionMembership(OWNER_ONLY)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("rotate_feed_token", {
    p_organization_id: auth.context.membership.organizationId,
  })

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "Não foi possível gerar um novo endereço agora."),
    }
  }

  if (typeof data !== "string") {
    return {
      ok: false,
      error: "Não foi possível gerar um novo endereço agora.",
    }
  }

  revalidatePath(PAGE_PATH)

  return {
    ok: true,
    message:
      "Novo endereço gerado. Cadastre a nova URL no Canal Pro para os portais continuarem lendo o feed.",
  }
}
