import { LISTING_PHOTO_MAX_MB } from "@workspace/core/billing/plans"
import { MAX_PROPERTY_PHOTOS } from "@workspace/core/media/limits"

import { ASK_MANAGER_HINT } from "@/lib/auth/permission-messages"
import { translateBillingError } from "@/lib/billing/errors"
import { photoLimitMessage } from "@/lib/media/upload-errors"

/**
 * Tradução dos erros do Supabase/PostgREST para mensagens pt-BR. O RLS e os
 * CHECKs do banco são a garantia final; aqui só explicamos o que aconteceu.
 */

export type DbErrorLike = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  properties_price_required:
    "Para sair do rascunho, informe o preço exigido pela finalidade (venda, locação ou os dois).",
  properties_area_required:
    "Para sair do rascunho, informe a área útil (ou a área total, para terreno, galpão, fazenda e sítio).",
  properties_suites_lte_bedrooms: "O número de suítes não pode ser maior que o de quartos.",
  properties_code_format: "O código do imóvel é gerado automaticamente e não pode ser alterado.",
  properties_postal_code_format: "CEP inválido: informe os 8 dígitos.",
  properties_state_format: "UF inválida: use a sigla com 2 letras.",
  condominiums_postal_code_format: "CEP inválido: informe os 8 dígitos.",
  condominiums_state_format: "UF inválida: use a sigla com 2 letras.",
  property_media_source:
    "Fotos precisam do arquivo enviado; vídeo e tour virtual precisam de um link https.",
  property_media_storage_path_format:
    "O arquivo foi enviado para uma pasta que não pertence a este imóvel.",
  property_media_cover_is_image: "Somente fotos podem ser capa do anúncio.",
  listing_authorizations_period:
    "A data final da autorização não pode ser anterior à data de início.",
  property_owners_property_client_key:
    "Este cliente já está cadastrado como proprietário deste imóvel.",
  property_media_one_cover_per_property: "O imóvel já tem uma foto de capa. Tente novamente.",
  property_media_storage_path_key: "Este arquivo já foi registrado.",
  properties_organization_code_key: "Já existe um imóvel com este código.",
  properties_organization_external_code_key:
    "Já existe um imóvel com este código do sistema anterior nesta imobiliária.",
  properties_external_code_format:
    "Código do sistema anterior inválido: use até 60 caracteres, sem espaços nas pontas nem quebra de linha.",
  properties_condominium_fkey: "O condomínio selecionado não existe mais nesta imobiliária.",
  property_owners_client_fkey: "O cliente selecionado não existe mais nesta imobiliária.",
  listing_authorizations_owner_client_fkey:
    "O proprietário selecionado não existe mais nesta imobiliária.",
  properties_restricted_not_published:
    "Imóvel restrito não vai para os portais. Tire o sigilo antes de publicar.",
  properties_registry_number_format:
    "Número da matrícula inválido: use até 40 caracteres, sem espaços nas pontas nem quebra de linha.",
  property_documents_description_format:
    "A descrição do documento pode ter no máximo 120 caracteres, sem quebra de linha.",
  property_documents_storage_path_format:
    "O arquivo foi enviado para uma pasta que não pertence a este imóvel.",
  property_documents_size_bytes: "O documento passa de 10 MB.",
  property_documents_mime_type: "Formato não aceito. Envie PDF, JPG, PNG ou WebP.",
  property_documents_storage_path_key: "Este arquivo já foi registrado.",
  property_shares_pkey: "Esta pessoa já pode ver o imóvel.",
  property_shares_property_fkey: "O imóvel não existe mais nesta imobiliária.",
}

/** CHECKs inline ganham o nome "<tabela>_<coluna>_check". */
const COLUMN_CHECK_MESSAGES: Record<string, string> = {
  title: "O título precisa ter entre 1 e 200 caracteres.",
  name: "O nome precisa ter entre 1 e 200 caracteres.",
  description: "A descrição pode ter no máximo 10.000 caracteres.",
  notes: "As observações passaram do tamanho permitido.",
  sale_price: "O preço de venda precisa ser maior que zero.",
  rent_price: "O preço de locação precisa ser maior que zero.",
  condo_fee: "O valor do condomínio não pode ser negativo.",
  avg_condo_fee: "A taxa média de condomínio não pode ser negativa.",
  iptu_yearly: "O IPTU não pode ser negativo.",
  living_area: "A área útil precisa ser maior que zero.",
  lot_area: "A área total precisa ser maior que zero.",
  bedrooms: "O número de quartos não pode ser negativo.",
  suites: "O número de suítes não pode ser negativo.",
  bathrooms: "O número de banheiros não pode ser negativo.",
  parking_spaces: "O número de vagas não pode ser negativo.",
  total_floors: "O total de andares não pode ser negativo.",
  year_built: "O ano de construção precisa estar entre 1500 e 2200.",
  latitude: "A latitude precisa estar entre -90 e 90.",
  longitude: "A longitude precisa estar entre -180 e 180.",
  street: "A rua pode ter no máximo 200 caracteres.",
  street_number: "O número pode ter no máximo 20 caracteres.",
  complement: "O complemento pode ter no máximo 120 caracteres.",
  neighborhood: "O bairro pode ter no máximo 120 caracteres.",
  city: "A cidade pode ter no máximo 120 caracteres.",
  share_percent: "A participação precisa ser maior que 0% e no máximo 100%.",
  commission_percent: "A comissão precisa estar entre 0% e 100%.",
  caption: "A legenda pode ter no máximo 300 caracteres.",
  external_url: "O link pode ter no máximo 2.048 caracteres.",
  position: "A posição da foto é inválida.",
}

function findConstraint(error: DbErrorLike) {
  const text = `${error.message ?? ""} ${error.details ?? ""}`
  return /constraint "([^"]+)"/.exec(text)?.[1] ?? null
}

/**
 * Tabelas do módulo cujos CHECKs inline têm mensagem em COLUMN_CHECK_MESSAGES.
 * Mais longas primeiro: "property_media" precisa ganhar de um prefixo mais curto.
 */
const CHECKED_TABLES = [
  "listing_authorizations",
  "property_owners",
  "property_media",
  "condominiums",
  "properties",
].sort((a, b) => b.length - a.length)

function messageForConstraint(constraint: string) {
  const direct = CONSTRAINT_MESSAGES[constraint]
  if (direct) return direct

  if (!constraint.endsWith("_check")) return null

  // "<tabela>_<coluna>_check": separa a tabela conhecida e compara a coluna
  // por igualdade (sufixo casaria "avg_condo_fee" com "condo_fee").
  const table = CHECKED_TABLES.find((name) => constraint.startsWith(`${name}_`))
  if (!table) return null

  const column = constraint.slice(table.length + 1, -"_check".length)
  return COLUMN_CHECK_MESSAGES[column] ?? null
}

/** Mensagens levantadas pelos próprios triggers/funções já vêm em pt-BR. */
function isPortugueseAppMessage(message: string) {
  return (
    /[áàâãéêíóôõúç]|imóvel|imobiliária|precisa|não pode/i.test(message) &&
    !/row-level security|permission denied|violates/i.test(message)
  )
}

/** `{limit, usage}` que o trigger do limite de fotos manda em `details` (texto JSON). */
function readPhotoLimitDetail(error: DbErrorLike): { limit: number; usage: number } | null {
  const details = error.details ?? ""

  if (!details) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(details)

    if (typeof parsed !== "object" || parsed === null) {
      return null
    }

    const { limit, usage } = parsed as { limit?: unknown; usage?: unknown }

    return typeof limit === "number" && typeof usage === "number" ? { limit, usage } : null
  } catch {
    return null
  }
}

/** Trigger `limite_fotos_imovel`: a 21ª foto (padrão) é recusada com P0001. */
function translatePhotoLimitError(error: DbErrorLike): string | null {
  const context = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`

  if (!/\blimite_fotos_imovel\b/.test(context)) {
    return null
  }

  const detail = readPhotoLimitDetail(error)
  return photoLimitMessage(detail?.limit ?? MAX_PROPERTY_PHOTOS)
}

/**
 * @param action complemento de "Não foi possível ..." e "Você não tem
 *   permissão para ...", ex.: "salvar o imóvel".
 */
export function translateDbError(error: DbErrorLike, action: string) {
  const billingMessage = translateBillingError(error)

  if (billingMessage) {
    return billingMessage
  }

  const photoLimit = translatePhotoLimitError(error)

  if (photoLimit) {
    return photoLimit
  }

  const message = error.message ?? ""
  const constraint = findConstraint(error)

  switch (error.code) {
    case "42501":
      if (isPortugueseAppMessage(message)) return message
      return `Você não tem permissão para ${action}. ${ASK_MANAGER_HINT}`
    case "23514": {
      if (constraint) {
        const translated = messageForConstraint(constraint)
        if (translated) return translated
      }
      if (isPortugueseAppMessage(message)) return message
      return "Algum campo tem um valor que o banco não aceita. Confira os dados e tente de novo."
    }
    case "23505":
      return (constraint && CONSTRAINT_MESSAGES[constraint]) ?? "Este registro já existe."
    case "23503":
      return (
        (constraint && CONSTRAINT_MESSAGES[constraint]) ??
        "Um registro relacionado (condomínio, cliente ou imóvel) não existe mais nesta imobiliária."
      )
    case "22P02":
      return "Algum valor está em formato inválido."
    case "22001":
      return "Algum texto passou do tamanho permitido."
    case "22003":
      return "Algum número está fora do limite permitido."
    case "PGRST116":
      return `Registro não encontrado. Ele pode ter sido removido, ou seu papel não dá acesso a ele. ${ASK_MANAGER_HINT}`
    case "22023":
    case "P0001":
    case "P0002":
      return message || `Não foi possível ${action} agora. Tente novamente.`
    default:
      return `Não foi possível ${action} agora. Tente novamente.`
  }
}

/** Erro de Storage (upload/remoção) em pt-BR. */
export function translateStorageError(
  error: { message?: string; statusCode?: string | number } | null,
  action: string
) {
  const text = `${error?.message ?? ""}`.toLowerCase()
  const status = String(error?.statusCode ?? "")

  if (status === "403" || text.includes("row-level security") || text.includes("unauthorized")) {
    return `Você não tem permissão para ${action}. ${ASK_MANAGER_HINT}`
  }
  if (status === "413" || text.includes("maximum allowed size") || text.includes("too large")) {
    return `Mesmo otimizada, a foto passou de ${LISTING_PHOTO_MAX_MB} MB. Tente outra foto.`
  }
  if (status === "415" || text.includes("mime type") || text.includes("not supported")) {
    return "Formato não aceito. Envie JPG, PNG ou WebP."
  }
  if (status === "409" || text.includes("already exists")) {
    return "Já existe um arquivo com este nome. Tente enviar de novo."
  }
  return `Não foi possível ${action} agora. Tente novamente.`
}
