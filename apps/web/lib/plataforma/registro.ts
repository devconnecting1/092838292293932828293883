import "server-only"

import { z } from "zod"

import { PLATFORM_AUDIT_ACTION_PATTERN } from "@workspace/core/platform/audit"
import type { Json } from "@workspace/database/types"

import {
  PlatformRpcError,
  throwPlatformRpcError,
  withPlatformRpc,
  type PlatformRpcResult,
} from "@/lib/plataforma/rpc"

/**
 * Registro do console (/plataforma/registro): somente leitura. A lista vem de
 * `listPlatformAuditEvents` (lib/plataforma/audit.ts); aqui ficam os filtros da
 * URL, os rótulos das ações e o antes/depois campo a campo.
 */

export const PLATFORM_AUDIT_LOG_PATH = "/plataforma/registro"
export const PLATFORM_AUDIT_PAGE_SIZE = 50

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AuditLogFilters = {
  /** Ação exata (ex.: comunicado.criar); vazio = todas. */
  acao: string
  /** Id da imobiliária; vazio = todas. */
  imobiliaria: string
  /** Cursor: mostra eventos com id menor que este; null = mais recentes. */
  antes: number | null
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

/** Filtros da URL, descartando o que não tem formato válido. */
export function parseAuditLogFilters(
  params: Record<string, string | string[] | undefined>
): AuditLogFilters {
  const acao = first(params.acao)
  const imobiliaria = first(params.imobiliaria)
  const antes = first(params.antes)
  const cursor = /^\d{1,18}$/.test(antes) ? Number(antes) : null

  return {
    acao: acao.length <= 80 && PLATFORM_AUDIT_ACTION_PATTERN.test(acao) ? acao : "",
    imobiliaria: UUID_PATTERN.test(imobiliaria) ? imobiliaria.toLowerCase() : "",
    antes: cursor !== null && Number.isSafeInteger(cursor) && cursor > 0 ? cursor : null,
  }
}

export function buildAuditLogHref(filters: Partial<AuditLogFilters>): string {
  const params = new URLSearchParams()

  if (filters.acao) params.set("acao", filters.acao)
  if (filters.imobiliaria) params.set("imobiliaria", filters.imobiliaria)
  if (filters.antes) params.set("antes", String(filters.antes))

  const query = params.toString()
  return query ? `${PLATFORM_AUDIT_LOG_PATH}?${query}` : PLATFORM_AUDIT_LOG_PATH
}

const ACTION_LABELS: Record<string, string> = {
  "comunicado.criar": "Comunicado criado",
  "comunicado.editar": "Comunicado editado",
  "comunicado.encerrar": "Comunicado encerrado",
  "organizacao.bloquear": "Imobiliária bloqueada",
  "organizacao.desbloquear": "Imobiliária desbloqueada",
  "assinatura.prorrogar_teste": "Teste grátis prorrogado",
  "caixa.enviar_lista": "Lista da Caixa enviada",
  "equipe.convidar": "Pessoa convidada para a equipe",
  "equipe.reenviar_convite": "Convite da equipe reenviado",
  "equipe.revogar_convite": "Convite da equipe revogado",
  "equipe.aceitar_convite": "Convite da equipe aceito",
  "equipe.mudar_papel": "Papel na equipe alterado",
  "equipe.remover": "Pessoa removida da equipe",
  "incidente.criar": "Incidente publicado na página de status",
  "incidente.atualizar": "Atualização de incidente publicada",
  "incidente.resolver": "Incidente resolvido",
  "incidente.editar": "Incidente editado",
  "incidente.assumir": "Incidente automático assumido pela equipe",
  "incidente.abrir_automatico": "Incidente aberto automaticamente",
  "incidente.atualizar_automatico": "Atualização automática de incidente",
  "incidente.resolver_automatico": "Incidente resolvido automaticamente",
  "incidente.reabrir_automatico": "Incidente reaberto automaticamente",
  "incidente.pausar_automacao": "Automação do incidente pausada (limite de atualizações)",
  "manutencao.agendar": "Manutenção agendada na página de status",
  "manutencao.atualizar": "Atualização de manutenção publicada",
  "manutencao.concluir": "Manutenção concluída",
  "manutencao.editar": "Manutenção editada",
}

/** Rótulo em pt-BR; ação sem rótulo aparece como está gravada. */
export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

const TARGET_LABELS: Record<string, string> = {
  comunicado: "Comunicado",
  organizacao: "Imobiliária",
  assinatura: "Assinatura",
  catalogo_caixa: "Catálogo da Caixa",
  convite_equipe: "Convite para a equipe",
  membro_equipe: "Pessoa da equipe",
  incidente: "Incidente (página de status)",
  manutencao: "Manutenção (página de status)",
}

export function auditTargetLabel(targetType: string): string {
  return TARGET_LABELS[targetType] ?? targetType
}

export type AuditFieldChange = {
  field: string
  before: string | null
  after: string | null
  changed: boolean
}

function display(value: Json | undefined): string | null {
  if (value === undefined) {
    return null
  }

  return typeof value === "string" ? value : JSON.stringify(value)
}

function asObject(value: Json | null): Record<string, Json | undefined> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {}
}

/** Antes/depois lado a lado, na ordem em que os campos aparecem (depois, antes). */
export function diffAuditData(before: Json | null, after: Json | null): AuditFieldChange[] {
  const previous = asObject(before)
  const next = asObject(after)
  const fields = [...new Set([...Object.keys(next), ...Object.keys(previous)])]

  return fields.map((field) => {
    const beforeValue = display(previous[field])
    const afterValue = display(next[field])

    return {
      field,
      before: before === null ? null : beforeValue,
      after: after === null ? null : afterValue,
      changed: before !== null && after !== null && beforeValue !== afterValue,
    }
  })
}

export type AuditFilterOptions = {
  actions: { action: string; total: number }[]
  organizations: { organizationId: string; name: string | null; total: number }[]
}

const filtersSchema = z.object({
  actions: z.array(z.object({ action: z.string(), total: z.number().int().nonnegative() })),
  organizations: z.array(
    z.object({
      organization_id: z.string(),
      name: z.string().nullable(),
      total: z.number().int().nonnegative(),
    })
  ),
})

/** Ações e imobiliárias presentes no registro, para os filtros. */
export async function getAuditFilterOptions(): Promise<PlatformRpcResult<AuditFilterOptions>> {
  const operation = "platform_audit_event_filters"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, { p_server_key: serverKey })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    const parsed = filtersSchema.safeParse(data)

    if (!parsed.success) {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return {
      actions: parsed.data.actions,
      organizations: parsed.data.organizations.map((organization) => ({
        organizationId: organization.organization_id,
        name: organization.name,
        total: organization.total,
      })),
    }
  })
}
