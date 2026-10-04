/**
 * Monta o `LandingPublicPayload` da pré-visualização a partir do rascunho do
 * editor e dos dados reais da imobiliária, dos imóveis e do corretor. Sem
 * `server-only`: roda no servidor (página /previa) e no cliente (editor).
 */
import {
  isHttpsUrl,
  parseLandingContent,
  parseLandingTheme,
  type LandingBroker,
  type LandingContent,
  type LandingOrganization,
  type LandingProperty,
  type LandingPublicPayload,
  type LandingSeo,
  type LandingTemplateKey,
  type LandingTheme,
  type LandingTracking,
} from "@/lib/landing/types"

import { readOrganizationBrand } from "@/lib/configuracoes/brand"

export type LandingDraft = {
  id: string
  template: LandingTemplateKey
  name: string
  slug: string
  theme: LandingTheme
  content: LandingContent
  tracking: LandingTracking
  seo: LandingSeo
  publishedAt: string | null
}

/** Dados da imobiliária no formato do payload público. */
export type LandingOrganizationSource = {
  name: string
  city: string | null
  state: string | null
  phone: string | null
  email: string | null
  creci: string | null
  brand: unknown
}

/** Imóvel exibível + status (o editor avisa quando deixa de estar ativo). */
export type LandingPropertySnapshot = LandingProperty & {
  status: string
}

/** Resultado da busca de imóveis do editor. */
export type LandingPropertyOption = {
  id: string
  label: string
  description: string | null
  property: LandingPropertySnapshot
}

/** Membro ativo que pode receber os leads. */
export type LandingMemberOption = {
  id: string
  name: string
  roleLabel: string
  broker: LandingBroker
}

export function toLandingOrganization(source: LandingOrganizationSource): LandingOrganization {
  const brand = readOrganizationBrand(source.brand)

  return {
    name: source.name,
    city: source.city,
    state: source.state,
    phone: source.phone,
    email: source.email,
    creci: source.creci,
    brand: {
      ...(brand.primaryColor ? { primary_color: brand.primaryColor } : {}),
      ...(brand.logoUrl ? { logo_url: brand.logoUrl } : {}),
    },
  }
}

export type LandingPropertyInput = {
  id: string
  code: string
  title: string
  purpose: LandingProperty["purpose"]
  type: string
  status: string
  sale_price: number | null
  rent_price: number | null
  condo_fee: number | null
  living_area: number | null
  lot_area: number | null
  bedrooms: number | null
  suites: number | null
  bathrooms: number | null
  parking_spaces: number | null
  neighborhood: string | null
  city: string | null
  state: string | null
  features: string[]
  imagePaths: string[]
}

export function toLandingPropertySnapshot(source: LandingPropertyInput): LandingPropertySnapshot {
  return {
    id: source.id,
    code: source.code,
    title: source.title,
    purpose: source.purpose,
    type: source.type as LandingProperty["type"],
    status: source.status,
    sale_price: source.sale_price,
    rent_price: source.rent_price,
    condo_fee: source.condo_fee,
    living_area: source.living_area,
    lot_area: source.lot_area,
    bedrooms: source.bedrooms,
    suites: source.suites,
    bathrooms: source.bathrooms,
    parking_spaces: source.parking_spaces,
    neighborhood: source.neighborhood,
    city: source.city,
    state: source.state,
    features: source.features ?? [],
    cover_path: source.imagePaths[0] ?? null,
    media_paths: source.imagePaths,
  }
}

export function toLandingBroker(member: {
  full_name: string | null
  email: string | null
  phone: string | null
  avatar_url: string | null
  creci_number: string | null
  creci_state: string | null
}): LandingBroker {
  return {
    full_name: member.full_name?.trim() || member.email || "Corretor",
    creci_number: member.creci_number,
    creci_state: member.creci_state,
    avatar_url: member.avatar_url && isHttpsUrl(member.avatar_url) ? member.avatar_url : null,
    phone: member.phone,
  }
}

/** Remove o status (campo só do editor) antes de mandar ao modelo. */
function stripStatus(snapshot: LandingPropertySnapshot): LandingProperty {
  const property: Partial<LandingPropertySnapshot> = { ...snapshot }
  delete property.status
  return property as LandingProperty
}

export function buildPreviewPayload({
  draft,
  organization,
  properties,
  broker,
}: {
  draft: LandingDraft
  organization: LandingOrganization
  properties: readonly LandingPropertySnapshot[]
  broker: LandingBroker | null
}): LandingPublicPayload {
  return {
    page: {
      id: draft.id,
      template: draft.template,
      slug: draft.slug,
      name: draft.name,
      theme: parseLandingTheme(draft.theme),
      content: parseLandingContent(draft.content),
      tracking: {},
      seo: draft.seo,
      published_at: draft.publishedAt,
    },
    organization,
    // A página pública só lista imóveis ativos.
    properties: properties.filter((property) => property.status === "active").map(stripStatus),
    broker,
  }
}
