import type { Role } from "@/lib/auth/roles"

/**
 * Lixeira de leads, clientes e imóveis (migração
 * 20260917122657_trash_bin_and_subject_erasure). Arquivo puro: serve no
 * servidor e no navegador.
 */

export const TRASH_SETTINGS_PATH = "/configuracoes/lixeira"

/** Mover, restaurar, excluir de vez e atender pedido do titular: dono e gerente. */
export const TRASH_ROLES: readonly Role[] = ["owner", "manager"]

/** Dias na lixeira até a rotina diária (lixeira-expurgo-diario) apagar de vez. */
export const TRASH_RETENTION_DAYS = 30

export const TRASH_ENTITIES = ["lead", "client", "property"] as const
export type TrashEntity = (typeof TRASH_ENTITIES)[number]

export function isTrashEntity(value: unknown): value is TrashEntity {
  return typeof value === "string" && (TRASH_ENTITIES as readonly string[]).includes(value)
}

export const TRASH_ENTITY_LABELS: Record<TrashEntity, string> = {
  lead: "Lead",
  client: "Cliente",
  property: "Imóvel",
}

/** "2031-09-17" → "17/09/2031" (data pura, sem fuso). */
export function formatPlainDate(value: string | null) {
  if (!value) return "—"
  const [year, month, day] = value.slice(0, 10).split("-")
  return year && month && day ? `${day}/${month}/${year}` : "—"
}

/** Guardas legais devolvidas por private.record_legal_holds. */
export const LEGAL_HOLD_LABELS: Record<string, string> = {
  proposta_aceita: "proposta aceita",
  comissao: "comissão lançada",
  negocio_do_imovel: "negócio de um imóvel do qual é proprietário",
  autorizacao_assinada: "autorização assinada",
  documento_dossie: "documento no dossiê do imóvel",
}

export function describeLegalHolds(holds: readonly string[]) {
  const labels = holds.map((hold) => LEGAL_HOLD_LABELS[hold] ?? hold)
  if (labels.length <= 1) return labels[0] ?? ""
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`
}

/**
 * Por que o registro com guarda não é apagado por inteiro. Fontes: LGPD (Lei
 * 13.709/2018) art. 16, I, e art. 18, VI; Lei 9.613/1998 art. 10, § 2º.
 */
export const LEGAL_HOLD_EXPLANATION =
  "A LGPD permite guardar dados para cumprir obrigação legal (art. 16, I). Quem intermedeia compra e venda de imóveis precisa manter o cadastro dos clientes e o registro das transações por no mínimo 5 anos após a conclusão (Lei 9.613/1998, art. 10, § 2º). Por isso, em vez de apagar tudo, os dados pessoais que não são obrigatórios são anonimizados."

/** O que a anonimização faz, por tipo (texto de tela). */
export const ANONYMIZATION_SUMMARY: Record<"client" | "property", string> = {
  client:
    "Saem telefone, WhatsApp, e-mail, RG, data de nascimento, endereço, observações, etiquetas, perfis de busca e o histórico. Se houve negócio fechado (proposta aceita ou comissão), o nome, o CPF/CNPJ e os documentos ficam guardados até 5 anos após a conclusão e depois saem automaticamente; sem negócio fechado, saem na hora. Propostas, comissões e autorizações continuam.",
  property:
    "Saem fotos, vídeo, tour e descrição e, se não houve negócio fechado, rua, número, complemento e localização no mapa. Dossiê, propostas, comissões e autorizações continuam.",
}
