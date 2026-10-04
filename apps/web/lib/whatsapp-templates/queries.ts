import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { WhatsappTemplate } from "@/lib/whatsapp-templates/constants"

/** Modelos da imobiliária em ordem alfabética (RLS: qualquer membro lê). */
export async function listWhatsappTemplates(organizationId: string): Promise<WhatsappTemplate[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("whatsapp_message_templates")
    .select("id, title, body, updated_at")
    .eq("organization_id", organizationId)
    .order("title", { ascending: true })

  if (error) {
    throw new Error(`Não foi possível carregar os modelos de mensagem (${error.code ?? "erro"}).`)
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    updatedAt: row.updated_at,
  }))
}
