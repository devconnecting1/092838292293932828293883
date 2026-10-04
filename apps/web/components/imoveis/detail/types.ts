import type { PropertyDocumentKind } from "@workspace/core/properties/documents"
import type {
  ClientKind,
  KeyStatus,
  ListingPurpose,
  ProposalStatus,
} from "@workspace/core/properties/enums"

/**
 * Dados serializáveis da ficha do imóvel, montados no servidor
 * (lib/imoveis/detail-queries) e usados pelos componentes da ficha.
 * Nomes de clientes vêm null quando o RLS esconde o cliente do papel atual.
 */

export type OwnerItem = {
  id: string
  clientId: string
  clientName: string | null
  clientKind: ClientKind | null
  sharePercent: number | null
}

export type AuthorizationItem = {
  id: string
  ownerClientId: string
  ownerName: string | null
  exclusive: boolean
  startsOn: string
  endsOn: string | null
  commissionPercent: number | null
  signedAt: string | null
  hasDocument: boolean
}

export type CaptureOwnerInfo = {
  ownerName: string
  ownerEmail: string | null
  ownerPhone: string | null
  createdAt: string
}

export type CondominiumSummary = {
  id: string
  name: string
}

export type MatchItem = {
  clientId: string
  clientName: string | null
  interestPurpose: ListingPurpose
  score: number
  reasons: string[]
}

export type KeyItem = {
  id: string
  label: string
  location: string | null
  status: KeyStatus
}

export type ProposalItem = {
  id: string
  clientId: string
  clientName: string | null
  purpose: ListingPurpose
  amount: number
  status: ProposalStatus
  validUntil: string | null
  createdAt: string
}

/** Documento do dossiê (property_documents). */
export type PropertyDocumentItem = {
  id: string
  kind: PropertyDocumentKind
  description: string | null
  /** AAAA-MM-DD. */
  validUntil: string | null
  mimeType: string
  sizeBytes: number
  uploadedByName: string
  createdAt: string
}

/** Pessoa da equipe com acesso ao imóvel restrito. */
export type PropertyAccessPerson = {
  userId: string
  name: string
  roleLabel: string
  /** Por que vê: papel (dono/gerente), captador, corretor responsável ou escolhida. */
  reason: string
  /** Só quem foi escolhida pode ser removida da lista. */
  removable: boolean
}

/** Membro ativo que ainda não vê o imóvel restrito (opções para compartilhar). */
export type PropertyShareCandidate = {
  userId: string
  name: string
  roleLabel: string
}

export type OwnerClientOption = {
  id: string
  label: string
  description: string
}
