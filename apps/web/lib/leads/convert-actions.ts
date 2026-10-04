"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { isValidPhoneBr } from "@workspace/core/br/documents"
import { CLIENT_KIND_LABELS } from "@workspace/core/properties/enums"
import type { Enums } from "@workspace/database/types"

import { formatDateKey, isDateKey, toDateKey } from "@/lib/agenda/datetime"
import { requireMembership } from "@/lib/auth/session"
import type { ActionResultWithData } from "@/lib/clientes/action-result"
import { CLIENTS_PATH, isLgpdLegalBasis } from "@/lib/clientes/constants"
import { permissionDeniedMessage, translateDatabaseError } from "@/lib/clientes/db-errors"
import { maskPhoneInput } from "@/lib/clientes/format"
import {
  EMPTY_INTEREST_FORM_VALUES,
  interestFormSchema,
  toInterestRow,
  type InterestFormValues,
} from "@/lib/clientes/interest-schema"
import {
  clientFormSchema,
  EMPTY_CLIENT_FORM_VALUES,
  toClientRow,
  type ClientFormValues,
} from "@/lib/clientes/schemas"
import { formatDateTime } from "@/lib/format"
import {
  getLeadInterestLabel,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCE_TO_CLIENT_SOURCE,
  LEAD_STAGE_LABELS,
  LEADS_PATH,
} from "@/lib/leads/constants"
import { createLeadsClient, type LeadsServerClient } from "@/lib/leads/db"
import type { LeadRow, LeadStage, LeadUpdate } from "@/lib/leads/db-types"
import { isMobilePhone, leadPhoneDigits, maskLeadPhone, readLeadUtm } from "@/lib/leads/format"
import { canConvertLead } from "@/lib/leads/permissions"
import { convertLeadSchema, leadIdSchema, type ConvertLeadInput } from "@/lib/leads/schemas"

const CLIENT_NOTES_MAX_LENGTH = 10000
const CANDIDATE_LIMIT = 5
/** Faixa de preço do perfil de busca criado a partir do imóvel (±20%). */
const PRICE_RANGE_FACTOR = 0.2
/** Etapas que a conversão promove para "Qualificado". */
const PROMOTE_TO_QUALIFIED: readonly LeadStage[] = ["new", "contacted"]

export type LeadClientCandidate = {
  id: string
  name: string
  kindLabel: string
  matchedBy: ("email" | "phone")[]
  /** E-mail ou telefone mascarado, para conferir antes de vincular. */
  contactHint: string | null
}

export type ConvertLeadResult = {
  clientId: string
  clientName: string
  clientKind: Enums<"client_kind">
  created: boolean
  /** Algo secundário não saiu (perfil de busca, histórico); a conversão valeu. */
  warning: string | null
}

async function loadLead(supabase: LeadsServerClient, organizationId: string, leadId: string) {
  return supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle()
}

function validEmail(value: string | null) {
  const email = value?.trim().toLowerCase() ?? ""
  return email && email.length <= 254 && z.email().safeParse(email).success ? email : ""
}

function validPhone(value: string | null) {
  const digits = leadPhoneDigits(value)
  return digits && isValidPhoneBr(digits) ? digits : ""
}

// -----------------------------------------------------------------------------
// Clientes parecidos (mesmo e-mail ou telefone)
// -----------------------------------------------------------------------------

export async function findLeadClientCandidates(
  leadId: string
): Promise<ActionResultWithData<{ candidates: LeadClientCandidate[] }>> {
  if (!leadIdSchema.safeParse(leadId).success) {
    return { ok: false, error: "Lead inválido." }
  }

  const { membership } = await requireMembership()
  const supabase = await createLeadsClient()
  const { data: lead, error } = await loadLead(supabase, membership.organizationId, leadId)

  if (error) {
    return { ok: false, error: translateDatabaseError(error, "ver este lead") }
  }

  if (!lead) {
    return {
      ok: false,
      error: "Lead não encontrado. Ele pode ter sido removido.",
    }
  }

  const email = validEmail(lead.email)
  const phone = leadPhoneDigits(lead.phone)
  const columns = "id, name, kind, email, phone, whatsapp"

  const [byEmail, byPhone] = await Promise.all([
    email
      ? supabase
          .from("clients")
          .select(columns)
          .eq("organization_id", membership.organizationId)
          .eq("email", email)
          .limit(CANDIDATE_LIMIT)
      : Promise.resolve(null),
    phone.length >= 10
      ? supabase
          .from("clients")
          .select(columns)
          .eq("organization_id", membership.organizationId)
          .or(`phone.eq.${phone},whatsapp.eq.${phone}`)
          .limit(CANDIDATE_LIMIT)
      : Promise.resolve(null),
  ])

  const candidates = new Map<string, LeadClientCandidate>()

  for (const [result, reason] of [
    [byEmail, "email"],
    [byPhone, "phone"],
  ] as const) {
    for (const client of result?.data ?? []) {
      const existing = candidates.get(client.id)

      if (existing) {
        existing.matchedBy.push(reason)
        continue
      }

      candidates.set(client.id, {
        id: client.id,
        name: client.name,
        kindLabel: CLIENT_KIND_LABELS[client.kind],
        matchedBy: [reason],
        contactHint: client.email ?? maskLeadPhone(client.phone ?? client.whatsapp),
      })
    }
  }

  return {
    ok: true,
    data: { candidates: [...candidates.values()].slice(0, CANDIDATE_LIMIT) },
  }
}

// -----------------------------------------------------------------------------
// Conversão
// -----------------------------------------------------------------------------

type PropertyForInterest = {
  id: string
  code: string
  title: string
  purpose: Enums<"listing_purpose">
  type: Enums<"property_type">
  sale_price: number | null
  rent_price: number | null
  bedrooms: number | null
  neighborhood: string | null
  city: string | null
}

function buildClientNotes(
  lead: LeadRow,
  landingPageName: string | null,
  property: PropertyForInterest | null
) {
  const utm = readLeadUtm(lead.utm)
  const origin = landingPageName
    ? `${LEAD_SOURCE_LABELS[lead.source]} — ${landingPageName}`
    : LEAD_SOURCE_LABELS[lead.source]
  const lines = [
    "Cliente criado a partir de um lead do funil.",
    `Origem: ${origin}`,
    `Recebido em: ${formatDateTime(lead.created_at)}`,
  ]

  const interest = getLeadInterestLabel(lead.interest)
  if (interest) lines.push(`Interesse: ${interest}`)
  if (property) lines.push(`Imóvel de interesse: ${property.code} · ${property.title}`)

  const utmParts = [
    utm.campaign ? `campanha ${utm.campaign}` : null,
    utm.source ? `fonte ${utm.source}` : null,
    utm.medium ? `mídia ${utm.medium}` : null,
  ].filter(Boolean)

  if (utmParts.length > 0) lines.push(`UTM: ${utmParts.join(", ")}`)
  if (lead.referrer) lines.push(`Página de referência: ${lead.referrer}`)
  if (lead.message) lines.push("", "Mensagem do lead:", lead.message)

  return lines.join("\n").slice(0, CLIENT_NOTES_MAX_LENGTH)
}

/** Perfil de busca coerente com o imóvel de interesse (finalidade, tipo, região e faixa de preço). */
function buildInterestValues(lead: LeadRow, property: PropertyForInterest): InterestFormValues {
  let purpose: Enums<"listing_purpose"> = property.purpose

  if ((lead.interest === "buy" || lead.interest === "invest") && property.purpose !== "rent") {
    purpose = "sale"
  } else if (lead.interest === "rent" && property.purpose !== "sale") {
    purpose = "rent"
  }

  const price =
    purpose === "sale" ? property.sale_price : purpose === "rent" ? property.rent_price : null
  const hasPrice = price !== null && price > 0

  return {
    ...EMPTY_INTEREST_FORM_VALUES,
    purpose,
    types: [property.type],
    neighborhoods: property.neighborhood ? [property.neighborhood.slice(0, 120)] : [],
    city: property.city?.slice(0, 120) ?? "",
    minPrice: hasPrice ? String(Math.round(price * (1 - PRICE_RANGE_FACTOR))) : "",
    maxPrice: hasPrice ? String(Math.round(price * (1 + PRICE_RANGE_FACTOR))) : "",
    minBedrooms:
      property.bedrooms !== null && property.bedrooms > 0
        ? String(Math.min(property.bedrooms, 50))
        : "",
    notes: `Criado na conversão do lead: interesse no imóvel ${property.code} · ${property.title}.`,
    active: true,
  }
}

export async function convertLeadToClient(
  input: ConvertLeadInput
): Promise<ActionResultWithData<ConvertLeadResult>> {
  const parsed = convertLeadSchema.safeParse(input)

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Conversão inválida.",
    }
  }

  const { user, membership } = await requireMembership()
  const organizationId = membership.organizationId
  const role = membership.role
  const action = "converter este lead"
  const supabase = await createLeadsClient()

  const { data: lead, error: leadError } = await loadLead(
    supabase,
    organizationId,
    parsed.data.leadId
  )

  if (leadError) {
    return { ok: false, error: translateDatabaseError(leadError, action) }
  }

  if (!lead) {
    return {
      ok: false,
      error: "Lead não encontrado. Ele pode ter sido removido.",
    }
  }

  if (!canConvertLead(role, { assignedTo: lead.assigned_to }, user.id)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  if (lead.client_id) {
    return { ok: false, error: "Este lead já foi convertido em cliente." }
  }

  // Imóvel de interesse (para o perfil de busca e as observações).
  let property: PropertyForInterest | null = null

  if (lead.property_id) {
    const { data } = await supabase
      .from("properties")
      .select(
        "id, code, title, purpose, type, sale_price, rent_price, bedrooms, neighborhood, city"
      )
      .eq("id", lead.property_id)
      .eq("organization_id", organizationId)
      .maybeSingle()

    property = data
  }

  let clientId: string
  let clientName: string
  let clientKind: Enums<"client_kind">
  let created = false

  if (parsed.data.clientId) {
    // Vincular a um cliente existente (e visível para o usuário).
    const { data: existing, error } = await supabase
      .from("clients")
      .select("id, name, kind")
      .eq("id", parsed.data.clientId)
      .eq("organization_id", organizationId)
      .maybeSingle()

    if (error) {
      return { ok: false, error: translateDatabaseError(error, action) }
    }

    if (!existing) {
      return {
        ok: false,
        error: "Cliente não encontrado ou sem acesso para você.",
      }
    }

    clientId = existing.id
    clientName = existing.name
    clientKind = existing.kind
  } else {
    // Base legal: o consentimento do formulário, se houver; senão a escolhida agora.
    let legalBasis = parsed.data.legalBasis
    let consentDate = parsed.data.consentDate

    if (lead.consent_at) {
      legalBasis = "consent"
      consentDate = toDateKey(lead.consent_at)
    } else if (!isLgpdLegalBasis(legalBasis)) {
      return {
        ok: false,
        error: "Selecione a base legal para tratar os dados deste cliente (LGPD).",
        fieldErrors: { legalBasis: "Selecione a base legal." },
      }
    } else if (legalBasis === "consent" && !isDateKey(consentDate)) {
      return {
        ok: false,
        error: "Informe a data do consentimento.",
        fieldErrors: { consentDate: "Informe a data do consentimento." },
      }
    }

    let landingPageName: string | null = null

    if (lead.landing_page_id) {
      const { data } = await supabase
        .from("landing_pages")
        .select("name")
        .eq("id", lead.landing_page_id)
        .eq("organization_id", organizationId)
        .maybeSingle()

      landingPageName = data?.name ?? null
    }

    const phone = validPhone(lead.phone)
    const assignee = lead.assigned_to ?? (role === "broker" ? user.id : null)

    const values: ClientFormValues = {
      ...EMPTY_CLIENT_FORM_VALUES,
      kind: "pf",
      name: lead.name.trim().slice(0, 200),
      email: validEmail(lead.email),
      phone: phone ? maskPhoneInput(phone) : "",
      whatsapp: phone && isMobilePhone(phone) ? maskPhoneInput(phone) : "",
      source: LEAD_SOURCE_TO_CLIENT_SOURCE[lead.source],
      assignedTo: assignee ?? "",
      legalBasis: legalBasis ?? "",
      consentDate: legalBasis === "consent" ? consentDate : "",
      notes: buildClientNotes(lead, landingPageName, property),
    }

    const clientParsed = clientFormSchema.safeParse(values)

    if (!clientParsed.success) {
      return {
        ok: false,
        error: `Não foi possível criar o cliente: ${clientParsed.error.issues[0]?.message ?? "confira os dados do lead."}`,
      }
    }

    const row = toClientRow(clientParsed.data, {
      previousConsentAt: lead.consent_at,
    })

    // Corretor só enxerga clientes atribuídos a ele (mesma regra do cadastro de clientes).
    if (role === "broker") {
      row.assigned_to = user.id
    }

    const { data: inserted, error } = await supabase
      .from("clients")
      .insert({ ...row, organization_id: organizationId })
      .select("id, name, kind")
      .single()

    if (error) {
      return {
        ok: false,
        error: translateDatabaseError(error, "cadastrar clientes"),
      }
    }

    clientId = inserted.id
    clientName = inserted.name
    clientKind = inserted.kind
    created = true
  }

  const warnings: string[] = []

  if (property) {
    const interest = interestFormSchema.safeParse(buildInterestValues(lead, property))

    if (interest.success) {
      const { error } = await supabase.from("client_interests").insert({
        ...toInterestRow(interest.data),
        organization_id: organizationId,
        client_id: clientId,
      })

      if (error) {
        warnings.push("o perfil de busca do imóvel não foi criado")
      }
    } else {
      warnings.push("o perfil de busca do imóvel não foi criado")
    }
  }

  const nextStage: LeadStage = PROMOTE_TO_QUALIFIED.includes(lead.stage) ? "qualified" : lead.stage
  // Converter em cliente não é contato: o 1º contato vem só do registro de contato.
  const patch: LeadUpdate = { client_id: clientId, stage: nextStage }

  if (role === "broker" && !lead.assigned_to) {
    patch.assigned_to = user.id
  }

  const { data: updated, error: updateError } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", lead.id)
    .eq("organization_id", organizationId)
    .is("client_id", null)
    .select("id")

  if (updateError || updated.length === 0) {
    const reason = updateError
      ? translateDatabaseError(updateError, action)
      : permissionDeniedMessage(action)

    return {
      ok: false,
      error: created
        ? `O cliente "${clientName}" foi criado, mas não foi possível vinculá-lo ao lead. ${reason}`
        : reason,
    }
  }

  const { error: activityError } = await supabase.from("activities").insert({
    organization_id: organizationId,
    client_id: clientId,
    property_id: property?.id ?? null,
    type: "status_change",
    body: [
      `Lead convertido em cliente (${LEAD_SOURCE_LABELS[lead.source]}, recebido em ${formatDateKey(toDateKey(lead.created_at))}).`,
      nextStage !== lead.stage
        ? `Etapa do lead: ${LEAD_STAGE_LABELS[lead.stage]} → ${LEAD_STAGE_LABELS[nextStage]}.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
  })

  if (activityError) {
    warnings.push("o registro no histórico do cliente não foi criado")
  }

  revalidatePath(LEADS_PATH)
  revalidatePath(`${LEADS_PATH}/${lead.id}`)
  revalidatePath(CLIENTS_PATH)
  revalidatePath(`${CLIENTS_PATH}/${clientId}`)
  revalidatePath("/painel")

  return {
    ok: true,
    data: {
      clientId,
      clientName,
      clientKind,
      created,
      warning: warnings.length > 0 ? `Atenção: ${warnings.join(" e ")}.` : null,
    },
    message: created ? "Lead convertido em cliente." : "Lead vinculado ao cliente.",
  }
}
