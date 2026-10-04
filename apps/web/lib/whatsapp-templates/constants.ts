import type { Role } from "@/lib/auth/roles"

/** Tela de Configurações dos modelos de mensagem de WhatsApp. */
export const WHATSAPP_TEMPLATES_SETTINGS_PATH = "/configuracoes/mensagens-whatsapp"

/** Criam, editam e apagam modelos (RLS de whatsapp_message_templates). */
export const WHATSAPP_TEMPLATE_EDITOR_ROLES: readonly Role[] = ["owner", "manager"]

export function canEditWhatsappTemplates(role: Role) {
  return WHATSAPP_TEMPLATE_EDITOR_ROLES.includes(role)
}

export type WhatsappTemplate = {
  id: string
  title: string
  body: string
  updatedAt: string
}
