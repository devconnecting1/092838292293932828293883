"use server"

import { revalidatePath } from "next/cache"

import { INVALID_FIELDS_MESSAGE } from "@/lib/clientes/action-result"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"
import { translateDatabaseError } from "@/lib/configuracoes/errors"
import { getFieldErrors } from "@/lib/configuracoes/schemas"
import { getPublicProperty } from "@/lib/imovel-publico/queries"
import { tryBuildPublicPropertyUrl } from "@/lib/imovel-publico/urls"
import { createClient } from "@/lib/supabase/server"
import {
  WHATSAPP_TEMPLATE_EDITOR_ROLES,
  WHATSAPP_TEMPLATES_SETTINGS_PATH,
  type WhatsappTemplate,
} from "@/lib/whatsapp-templates/constants"
import { listWhatsappTemplates } from "@/lib/whatsapp-templates/queries"
import {
  whatsappTemplateIdSchema,
  whatsappTemplateSchema,
  type WhatsappTemplateValues,
} from "@/lib/whatsapp-templates/schemas"

const EDITOR_ONLY_MESSAGE = "Só o dono e o gerente criam e editam os modelos de mensagem."
const NOT_FOUND_MESSAGE = "Modelo não encontrado. Ele pode ter sido apagado."

function translateTemplateError(error: Parameters<typeof translateDatabaseError>[0]) {
  if (error.code === "23505") {
    return "Já existe um modelo com este título. Use outro título."
  }

  return translateDatabaseError(error, "Não foi possível salvar o modelo agora. Tente de novo.")
}

/** Cria (sem id) ou altera (com id) um modelo da imobiliária atual. */
export async function saveWhatsappTemplate(
  values: WhatsappTemplateValues,
  templateId?: string | null
): Promise<FormActionResult<keyof WhatsappTemplateValues>> {
  const parsed = whatsappTemplateSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof WhatsappTemplateValues>(parsed.error),
    }
  }

  if (templateId && !whatsappTemplateIdSchema.safeParse(templateId).success) {
    return { ok: false, error: "Modelo inválido." }
  }

  const auth = await getActionMembership(WHATSAPP_TEMPLATE_EDITOR_ROLES)

  if (!auth.ok) {
    return { ok: false, error: EDITOR_ONLY_MESSAGE }
  }

  const organizationId = auth.context.membership.organizationId
  const supabase = await createClient()

  if (templateId) {
    const { data, error } = await supabase
      .from("whatsapp_message_templates")
      .update({ title: parsed.data.title, body: parsed.data.body })
      .eq("id", templateId)
      .eq("organization_id", organizationId)
      .select("id")

    if (error) {
      return { ok: false, error: translateTemplateError(error) }
    }

    if (data.length === 0) {
      return { ok: false, error: NOT_FOUND_MESSAGE }
    }
  } else {
    const { error } = await supabase.from("whatsapp_message_templates").insert({
      organization_id: organizationId,
      title: parsed.data.title,
      body: parsed.data.body,
    })

    if (error) {
      return { ok: false, error: translateTemplateError(error) }
    }
  }

  revalidatePath(WHATSAPP_TEMPLATES_SETTINGS_PATH)

  return { ok: true, message: templateId ? "Modelo atualizado." : "Modelo criado." }
}

export async function deleteWhatsappTemplate(templateId: string): Promise<FormActionResult> {
  if (!whatsappTemplateIdSchema.safeParse(templateId).success) {
    return { ok: false, error: "Modelo inválido." }
  }

  const auth = await getActionMembership(WHATSAPP_TEMPLATE_EDITOR_ROLES)

  if (!auth.ok) {
    return { ok: false, error: EDITOR_ONLY_MESSAGE }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("whatsapp_message_templates")
    .delete()
    .eq("id", templateId)
    .eq("organization_id", auth.context.membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateTemplateError(error) }
  }

  if (data.length === 0) {
    return { ok: false, error: NOT_FOUND_MESSAGE }
  }

  revalidatePath(WHATSAPP_TEMPLATES_SETTINGS_PATH)

  return { ok: true, message: "Modelo apagado." }
}

export type WhatsappComposerData =
  | {
      ok: true
      templates: WhatsappTemplate[]
      /** Nome de quem envia ({corretor}). */
      senderName: string | null
      /** Imóvel pedido (código e título), quando existe e o usuário o vê. */
      property: { code: string; title: string } | null
      /** Página pública do imóvel, só quando ela está no ar. */
      propertyLink: string | null
    }
  | { ok: false; error: string }

/**
 * Modelos da imobiliária para o botão de WhatsApp (lead e imóvel), carregados
 * quando o diálogo abre. Com o imóvel, devolve o link público só se a página
 * estiver no ar (a mesma consulta da página pública: nada de link que cai em
 * "não encontrado").
 */
export async function loadWhatsappComposerData(
  propertyId?: string | null
): Promise<WhatsappComposerData> {
  const auth = await getActionMembership()

  if (!auth.ok) {
    return { ok: false, error: auth.error }
  }

  const { membership, user } = auth.context

  try {
    const templates = await listWhatsappTemplates(membership.organizationId)
    let property: { code: string; title: string } | null = null
    let propertyLink: string | null = null

    if (propertyId && whatsappTemplateIdSchema.safeParse(propertyId).success) {
      const supabase = await createClient()
      const { data } = await supabase
        .from("properties")
        .select("code, title")
        .eq("id", propertyId)
        .eq("organization_id", membership.organizationId)
        .maybeSingle()

      if (data?.code) {
        const orgSlug = membership.organization.slug
        const publicProperty = await getPublicProperty(orgSlug, data.code).catch(() => null)

        property = { code: data.code, title: data.title ?? "" }
        propertyLink = publicProperty ? tryBuildPublicPropertyUrl(orgSlug, data.code) : null
      }
    }

    return { ok: true, templates, senderName: user.fullName, property, propertyLink }
  } catch {
    return { ok: false, error: "Não foi possível carregar os modelos de mensagem." }
  }
}
