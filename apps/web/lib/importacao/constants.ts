import type { ImportKind } from "@workspace/core/import/fields"

import type { Role } from "@/lib/auth/roles"

/** Importação de planilhas (clientes, leads e imóveis). */
export const IMPORT_SETTINGS_PATH = "/configuracoes/importacao"

/**
 * Dono, gerente e assistente importam (as RPCs conferem de novo no banco). A
 * assistente vê e desfaz só as próprias importações; dono e gerente, todas.
 */
export const IMPORT_ROLES: readonly Role[] = ["owner", "manager", "assistant"]

/** Quem vê e desfaz a importação de qualquer pessoa da equipe. */
export const IMPORT_ADMIN_ROLES: readonly Role[] = ["owner", "manager"]

/** Prazo para "Desfazer esta importação" (o banco confere o mesmo prazo). */
export const IMPORT_UNDO_DAYS = 7

/** Links de foto baixados por chamada ao servidor (cada um com timeout próprio). */
export const IMPORT_PHOTO_BATCH = 4

/** Registros decididos por passo do desfazer. */
export const IMPORT_UNDO_CHUNK = 200

/** Listas que mudam depois de uma importação. */
export const IMPORT_LIST_PATHS: Record<ImportKind, string> = {
  clients: "/clientes",
  leads: "/leads",
  properties: "/imoveis",
}

export const IMPORT_ACCEPT =
  ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** Base legal (LGPD) aplicada aos contatos importados. */
export const IMPORT_LEGAL_BASIS_VALUES = ["legitimate_interest", "contract"] as const

export type ImportLegalBasis = (typeof IMPORT_LEGAL_BASIS_VALUES)[number]

export const IMPORT_LEGAL_BASIS_LABELS: Record<ImportLegalBasis, { title: string; hint: string }> =
  {
    legitimate_interest: {
      title: "Legítimo interesse",
      hint: "Contatos que procuraram a imobiliária ou já são atendidos por ela.",
    },
    contract: {
      title: "Execução de contrato ou pré-contrato",
      hint: "Proprietários, inquilinos e compradores com negócio em andamento.",
    },
  }

export const IMPORT_DEFAULT_TAG = "Importado"
