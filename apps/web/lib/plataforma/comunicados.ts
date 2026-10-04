import "server-only"

import type { AnnouncementPayload } from "@workspace/core/platform/announcements"

import {
  PlatformRpcError,
  throwPlatformRpcError,
  withPlatformRpc,
  type PlatformRpcFailure,
  type PlatformRpcResult,
} from "@/lib/plataforma/rpc"

/**
 * Comunicados globais do Console da Plataforma. Escrita só pelas RPCs com a
 * chave do servidor, que gravam o registro do console na mesma transação; quem
 * agiu vem da sessão conferida (`withPlatformRpc`), nunca do formulário.
 */

export const PLATFORM_ANNOUNCEMENTS_PATH = "/plataforma/comunicados"

export type PlatformAnnouncement = {
  id: string
  title: string
  body: string
  kind: string
  audience: string
  startsAt: string
  endsAt: string
  linkUrl: string | null
  linkLabel: string | null
  endedAt: string | null
  createdAt: string
  updatedAt: string
  /** Quantas pessoas dispensaram a faixa. */
  dismissals: number
}

/** Todos os comunicados, do mais novo para o mais antigo (até 200). */
export async function listPlatformAnnouncements(): Promise<
  PlatformRpcResult<PlatformAnnouncement[]>
> {
  const operation = "platform_list_announcements"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_limit: 200,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (!Array.isArray(data)) {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return data.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      kind: row.kind,
      audience: row.audience,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      linkUrl: row.link_url ?? null,
      linkLabel: row.link_label ?? null,
      endedAt: row.ended_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      dismissals: row.dismissals ?? 0,
    }))
  })
}

/** Cria (sem `id`) ou edita um comunicado ainda não encerrado. */
export async function savePlatformAnnouncement(
  payload: AnnouncementPayload,
  id: string | null
): Promise<PlatformRpcResult<{ id: string }>> {
  const operation = "platform_save_announcement"

  return withPlatformRpc(operation, async ({ supabase, serverKey, admin }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_actor_user_id: admin.id,
      p_actor_email: admin.email,
      p_title: payload.title,
      p_body: payload.body,
      p_kind: payload.kind,
      p_audience: payload.audience,
      p_starts_at: payload.startsAt,
      p_ends_at: payload.endsAt,
      p_link_url: payload.linkUrl ?? undefined,
      p_link_label: payload.linkLabel ?? undefined,
      p_id: id ?? undefined,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (typeof data !== "string") {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return { id: data }
  })
}

/** Tira o comunicado do ar agora (motivo opcional vai para o registro). */
export async function endPlatformAnnouncement(
  id: string,
  reason: string | null
): Promise<PlatformRpcResult<{ endedAt: string }>> {
  const operation = "platform_end_announcement"

  return withPlatformRpc(operation, async ({ supabase, serverKey, admin }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_actor_user_id: admin.id,
      p_actor_email: admin.email,
      p_id: id,
      p_reason: reason ?? undefined,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (typeof data !== "string") {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return { endedAt: data }
  })
}

/** Frase para a tela a partir do código do banco (sem o texto do erro). */
export function announcementFailureMessage(failure: PlatformRpcFailure): string {
  switch (failure.code) {
    case "22023":
      return "O comunicado já terminou, foi encerrado ou o fim ficou no passado. Atualize a página e confira as datas."
    case "P0002":
      return "Este comunicado não existe mais. Atualize a página."
    case "23514":
      return "Algum campo está fora das regras (título, texto, link ou período). Confira e tente de novo."
    default:
      return failure.message
  }
}
