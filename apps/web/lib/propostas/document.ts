// Documento da proposta: o payload que o banco monta em uma única função
// (private.proposal_document) e que alimenta as três saídas — o PDF gerado no
// CRM, a página pública /proposta/{token} e o PDF baixado nela.
//
// A validação aqui é a fronteira entre o jsonb do banco e o que é desenhado:
// campo faltando ou em formato estranho vira null em vez de derrubar a página.

import { z } from "zod"

import {
  formatCnpj,
  formatCpf,
  formatPhoneBr,
  formatPostalCode,
  isValidPhoneBr,
} from "@workspace/core/br/documents"
import {
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_USAGE_LABELS,
  type ListingPurpose,
  type PropertyType,
  type PropertyUsage,
} from "@workspace/core/properties/enums"
import {
  PROPOSAL_ROUND_KIND_LABELS,
  PROPOSAL_ROUND_KIND_VALUES,
  type ProposalRoundKind,
  type ProposalRoundTerms,
} from "@workspace/core/proposals/rounds"

import { readOrganizationBrand, type OrganizationBrand } from "@/lib/configuracoes/brand"
import type { ProposalStatus } from "@/lib/propostas/status"

const text = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim()
    return trimmed ? trimmed : null
  })

const numeric = z
  .number()
  .nullish()
  .transform((value) => (typeof value === "number" && Number.isFinite(value) ? value : null))

const timestamp = z
  .string()
  .nullish()
  .transform((value) => (value && !Number.isNaN(Date.parse(value)) ? value : null))

const proposalSchema = z.object({
  id: z.guid(),
  status: z.enum(["draft", "sent", "countered", "accepted", "rejected", "withdrawn"]),
  purpose: z.enum(["sale", "rent"]),
  amount: z.number(),
  payment_terms: text,
  conditions: text,
  valid_until: text,
  decided_at: timestamp,
  created_at: z.string(),
  // Rodada vigente da negociação (migração proposal_negotiation_rounds).
  round_number: z.number().int().positive().nullish(),
  round_kind: z
    .enum(PROPOSAL_ROUND_KIND_VALUES as [ProposalRoundKind, ...ProposalRoundKind[]])
    .nullish(),
  round_created_at: timestamp,
  down_payment: numeric,
  financing_amount: numeric,
  exchange_description: text,
  payment_deadline: text,
})

const organizationSchema = z.object({
  slug: z.string(),
  name: z.string().min(1),
  legal_name: text,
  cnpj: text,
  creci: text,
  phone: text,
  email: text,
  city: text,
  state: text,
  brand: z.unknown(),
})

const propertySchema = z.object({
  code: z.string(),
  title: z.string(),
  type: text,
  usage: text,
  postal_code: text,
  street: text,
  street_number: text,
  complement: text,
  neighborhood: text,
  city: text,
  state: text,
  condominium_name: text,
  bedrooms: numeric,
  suites: numeric,
  bathrooms: numeric,
  parking_spaces: numeric,
  living_area: numeric,
  lot_area: numeric,
  sale_price: numeric,
  rent_price: numeric,
  condo_fee: numeric,
  iptu_yearly: numeric,
})

const clientSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["pf", "pj"]).nullish(),
  document: text,
  email: text,
  phone: text,
})

const brokerSchema = z.object({
  name: text,
  creci_number: text,
  creci_state: text,
  phone: text,
  email: text,
})

const shareSchema = z.object({
  expires_at: timestamp,
  first_viewed_at: timestamp,
  last_viewed_at: timestamp,
  view_count: z.number().nullish(),
})

const documentSchema = z.object({
  proposal: proposalSchema,
  organization: organizationSchema,
  property: propertySchema.nullish(),
  client: clientSchema.nullish(),
  broker: brokerSchema.nullish(),
  share: shareSchema.nullish(),
  generated_at: z.string(),
})

export type ProposalDocumentProperty = {
  code: string
  title: string
  typeLabel: string | null
  usageLabel: string | null
  address: string | null
  postalCode: string | null
  condominiumName: string | null
  bedrooms: number | null
  suites: number | null
  bathrooms: number | null
  parkingSpaces: number | null
  livingArea: number | null
  lotArea: number | null
  listedPrice: number | null
  condoFee: number | null
  iptuYearly: number | null
}

export type ProposalDocument = {
  proposal: {
    id: string
    status: ProposalStatus
    purpose: Extract<ListingPurpose, "sale" | "rent">
    purposeLabel: string
    amount: number
    paymentTerms: string | null
    conditions: string | null
    validUntil: string | null
    decidedAt: string | null
    createdAt: string
    /** Rodada vigente; null em payload antigo, sem rodadas. */
    round: {
      number: number
      kind: ProposalRoundKind
      label: string
      createdAt: string | null
    } | null
    /** Sinal, financiamento, permuta e prazo da rodada vigente. */
    terms: ProposalRoundTerms
  }
  organization: {
    slug: string
    name: string
    legalName: string | null
    cnpj: string | null
    creci: string | null
    phone: string | null
    email: string | null
    city: string | null
    state: string | null
    brand: OrganizationBrand
  }
  property: ProposalDocumentProperty | null
  client: {
    name: string
    kind: "pf" | "pj" | null
    /** No link público vem mascarado pelo banco ("***.456.789-**"). */
    document: string | null
    email: string | null
    phone: string | null
  } | null
  broker: {
    name: string | null
    creci: string | null
    phone: string | null
    email: string | null
  } | null
  share: {
    expiresAt: string | null
    firstViewedAt: string | null
    lastViewedAt: string | null
    viewCount: number
  } | null
  generatedAt: string
}

function labelFor<T extends string>(labels: Record<T, string>, value: string | null) {
  return value && value in labels ? labels[value as T] : null
}

/**
 * CPF/CNPJ com pontuação. No link público o banco já devolve mascarado
 * ("***.456.789-**"): nesse caso o valor passa como veio.
 */
function formatDocument(kind: "pf" | "pj" | null | undefined, value: string | null) {
  if (!value) return null
  if (kind === "pf" && /^[0-9]{11}$/.test(value)) return formatCpf(value)
  if (kind === "pj" && /^[0-9A-Z]{14}$/.test(value)) return formatCnpj(value)

  return value
}

function formatPhone(value: string | null) {
  return value && isValidPhoneBr(value) ? formatPhoneBr(value) : value
}

function formatCep(value: string | null) {
  return value && /^[0-9]{8}$/.test(value) ? formatPostalCode(value) : value
}

/** "Rua das Flores, 123, apto 12 — Centro, Campinas/SP" */
function formatAddress(property: z.infer<typeof propertySchema>) {
  const line = [property.street, property.street_number, property.complement]
    .filter(Boolean)
    .join(", ")
  const place = [property.neighborhood, [property.city, property.state].filter(Boolean).join("/")]
    .filter(Boolean)
    .join(", ")

  return [line, place].filter(Boolean).join(" — ") || null
}

/** "CRECI 12345-F/SP" a partir do número e do estado do perfil. */
function formatBrokerCreci(number: string | null, state: string | null) {
  if (!number) {
    return null
  }

  const suffix = state ? `/${state}` : ""
  return /^creci/i.test(number) ? `${number}${suffix}` : `CRECI ${number}${suffix}`
}

/**
 * jsonb da RPC → documento pronto para desenhar. `null` quando o payload não
 * é uma proposta (RPC devolveu null, token errado, formato inesperado).
 */
export function parseProposalDocument(payload: unknown): ProposalDocument | null {
  const parsed = documentSchema.safeParse(payload)

  if (!parsed.success) {
    return null
  }

  const { proposal, organization, property, client, broker, share } = parsed.data

  return {
    proposal: {
      id: proposal.id,
      status: proposal.status,
      purpose: proposal.purpose,
      purposeLabel: LISTING_PURPOSE_LABELS[proposal.purpose],
      amount: proposal.amount,
      paymentTerms: proposal.payment_terms,
      conditions: proposal.conditions,
      validUntil: proposal.valid_until,
      decidedAt: proposal.decided_at,
      createdAt: proposal.created_at,
      round:
        proposal.round_number && proposal.round_kind
          ? {
              number: proposal.round_number,
              kind: proposal.round_kind,
              label: PROPOSAL_ROUND_KIND_LABELS[proposal.round_kind],
              createdAt: proposal.round_created_at,
            }
          : null,
      terms: {
        downPayment: proposal.down_payment,
        financingAmount: proposal.financing_amount,
        exchangeDescription: proposal.exchange_description,
        paymentDeadline: proposal.payment_deadline,
      },
    },
    organization: {
      slug: organization.slug,
      name: organization.name.trim(),
      legalName: organization.legal_name,
      cnpj: formatDocument("pj", organization.cnpj),
      creci: organization.creci,
      phone: formatPhone(organization.phone),
      email: organization.email,
      city: organization.city,
      state: organization.state,
      brand: readOrganizationBrand(organization.brand),
    },
    property: property
      ? {
          code: property.code,
          title: property.title,
          typeLabel: labelFor<PropertyType>(PROPERTY_TYPE_LABELS, property.type),
          usageLabel: labelFor<PropertyUsage>(PROPERTY_USAGE_LABELS, property.usage),
          address: formatAddress(property),
          postalCode: formatCep(property.postal_code),
          condominiumName: property.condominium_name,
          bedrooms: property.bedrooms,
          suites: property.suites,
          bathrooms: property.bathrooms,
          parkingSpaces: property.parking_spaces,
          livingArea: property.living_area,
          lotArea: property.lot_area,
          // Preço anunciado da mesma finalidade da proposta, para comparar com o valor ofertado.
          listedPrice: proposal.purpose === "rent" ? property.rent_price : property.sale_price,
          condoFee: property.condo_fee,
          iptuYearly: property.iptu_yearly,
        }
      : null,
    client: client
      ? {
          name: client.name.trim(),
          kind: client.kind ?? null,
          document: formatDocument(client.kind, client.document),
          email: client.email,
          phone: formatPhone(client.phone),
        }
      : null,
    broker: broker
      ? {
          name: broker.name,
          creci: formatBrokerCreci(broker.creci_number, broker.creci_state),
          phone: formatPhone(broker.phone),
          email: broker.email,
        }
      : null,
    share: share
      ? {
          expiresAt: share.expires_at,
          firstViewedAt: share.first_viewed_at,
          lastViewedAt: share.last_viewed_at,
          viewCount: typeof share.view_count === "number" ? share.view_count : 0,
        }
      : null,
    generatedAt: parsed.data.generated_at,
  }
}
