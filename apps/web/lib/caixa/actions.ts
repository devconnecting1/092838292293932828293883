"use server"

import { revalidatePath } from "next/cache"

import { CAIXA_BASE_PATH } from "@/lib/caixa/constants"
import { isCaixaListingNumber } from "@/lib/caixa/detail-queries"
import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"

const SEARCH_LIMIT = 10
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Remove curingas do LIKE (% _ *) e barra invertida; limita o tamanho. */
function sanitizeSearchTerm(value: unknown) {
  if (typeof value !== "string") {
    return ""
  }

  return value
    .replace(/[%_*\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
}

function revalidateCaixaPaths(numero: string) {
  revalidatePath(CAIXA_BASE_PATH)
  revalidatePath(`${CAIXA_BASE_PATH}/${numero}`)
}

/** Favoritar é por pessoa: o RLS só aceita `user_id = auth.uid()`. */
export async function toggleCaixaFavoriteAction(
  numero: string,
  favorite: boolean
): Promise<ActionResult> {
  if (!isCaixaListingNumber(numero)) {
    return { ok: false, error: "Imóvel inválido." }
  }

  const { user, membership } = await requireMembership()
  const supabase = await createClient()

  if (favorite) {
    const { error } = await supabase.from("caixa_favorites").insert({
      organization_id: membership.organizationId,
      user_id: user.id,
      numero,
    })

    // 23505: já estava favoritado (dois cliques seguidos). Não é erro para quem usa.
    if (error && error.code !== "23505") {
      return { ok: false, error: "Não foi possível favoritar este imóvel." }
    }

    revalidateCaixaPaths(numero)

    return { ok: true, message: "Imóvel favoritado." }
  }

  const { error } = await supabase
    .from("caixa_favorites")
    .delete()
    .eq("organization_id", membership.organizationId)
    .eq("user_id", user.id)
    .eq("numero", numero)

  if (error) {
    return { ok: false, error: "Não foi possível remover dos favoritos." }
  }

  revalidateCaixaPaths(numero)

  return { ok: true, message: "Removido dos favoritos." }
}

export type CaixaLinkTarget = {
  kind: "client" | "lead"
  id: string
  label: string
  description: string | null
}

/**
 * Clientes e leads da carteira para o seletor do vínculo. O RLS limita ao que o
 * papel enxerga (corretor: os seus e os compartilhados).
 */
export async function searchCaixaLinkTargetsAction(query: string): Promise<CaixaLinkTarget[]> {
  const { membership } = await requireMembership()
  const term = sanitizeSearchTerm(query)
  const supabase = await createClient()

  let clientsRequest = supabase
    .from("clients")
    .select("id, name, email, phone")
    .eq("organization_id", membership.organizationId)
    .order("name")
    .limit(SEARCH_LIMIT)

  let leadsRequest = supabase
    .from("leads")
    .select("id, name, email, phone, stage")
    .eq("organization_id", membership.organizationId)
    .order("created_at", { ascending: false })
    .limit(SEARCH_LIMIT)

  if (term) {
    clientsRequest = clientsRequest.ilike("name", `%${term}%`)
    leadsRequest = leadsRequest.ilike("name", `%${term}%`)
  }

  const [clients, leads] = await Promise.all([clientsRequest, leadsRequest])

  const targets: CaixaLinkTarget[] = []

  for (const client of clients.data ?? []) {
    targets.push({
      kind: "client",
      id: client.id,
      label: client.name,
      description: ["Cliente", client.phone ?? client.email].filter(Boolean).join(" · "),
    })
  }

  for (const lead of leads.data ?? []) {
    targets.push({
      kind: "lead",
      id: lead.id,
      label: lead.name,
      description: ["Lead", lead.phone ?? lead.email].filter(Boolean).join(" · "),
    })
  }

  return targets
}

export async function linkCaixaListingAction(
  numero: string,
  target: { kind: "client" | "lead"; id: string },
  notes: string
): Promise<ActionResult> {
  if (!isCaixaListingNumber(numero)) {
    return { ok: false, error: "Imóvel inválido." }
  }

  if (!UUID_PATTERN.test(target.id) || (target.kind !== "client" && target.kind !== "lead")) {
    return { ok: false, error: "Escolha um cliente ou um lead da sua carteira." }
  }

  const trimmedNotes = notes.trim().slice(0, 1000)
  const { membership } = await requireMembership()
  const supabase = await createClient()

  const { error } = await supabase.from("caixa_client_links").insert({
    organization_id: membership.organizationId,
    numero,
    client_id: target.kind === "client" ? target.id : null,
    lead_id: target.kind === "lead" ? target.id : null,
    notes: trimmedNotes || null,
  })

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Este imóvel já está ligado a esse cliente ou lead." }
    }

    if (error.code === "42501") {
      return { ok: false, error: "Você não tem acesso ao cliente ou lead escolhido." }
    }

    if (error.code === "23503") {
      return { ok: false, error: "Cliente ou lead não encontrado nesta imobiliária." }
    }

    return { ok: false, error: "Não foi possível criar o vínculo." }
  }

  revalidateCaixaPaths(numero)

  if (target.kind === "client") {
    revalidatePath(`/clientes/${target.id}`)
  }

  return { ok: true, message: "Imóvel ligado à carteira." }
}

export async function unlinkCaixaListingAction(
  numero: string,
  linkId: string
): Promise<ActionResult> {
  if (!isCaixaListingNumber(numero) || !UUID_PATTERN.test(linkId)) {
    return { ok: false, error: "Vínculo inválido." }
  }

  const { membership } = await requireMembership()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("caixa_client_links")
    .delete()
    .eq("organization_id", membership.organizationId)
    .eq("id", linkId)
    .select("id")

  if (error) {
    return { ok: false, error: "Não foi possível remover o vínculo." }
  }

  if (!data?.length) {
    return { ok: false, error: "Vínculo não encontrado ou fora do seu acesso." }
  }

  revalidateCaixaPaths(numero)

  return { ok: true, message: "Vínculo removido." }
}
