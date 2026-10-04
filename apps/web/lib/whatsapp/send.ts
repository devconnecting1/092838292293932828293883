import "server-only"

// Envio de uma mensagem de texto dentro da janela de atendimento.
//
// A ordem importa e não pode ser trocada:
//
//   1. `queue_whatsapp_message` (COM SESSÃO) decide se pode enviar. Ela roda no
//      banco e confere conexão desligada, número suspenso por qualidade,
//      supressão, consentimento de divulgação e janela de 24 h. Não existe
//      política de INSERT em `whatsapp_messages`, então este é o único caminho
//      — nenhuma tela consegue passar por fora.
//   2. Só se ela liberar, a credencial é lida (com a chave do servidor) e a
//      mensagem vai para a Meta.
//   3. O que a Meta responder vira `accepted` ou `held` — NUNCA `delivered`.
//      Entrega é o que chega depois, pelo webhook.
//
// Se o passo 2 ou 3 falhar, a linha já está gravada como `queued` e recebe
// `failed` com o código da Meta: a mensagem não some da tela nem fica mentindo
// que saiu.

import {
  whatsappBlockReasonMessage,
  whatsappError,
  type WhatsappMessageStatus,
} from "@workspace/core/whatsapp"

import {
  ConnectionRpcError,
  getConnectionCredential,
  markWhatsappMessageSent,
  recordConnectionError,
} from "@/lib/conexoes/rpc"
import { createClient } from "@/lib/supabase/server"
import { sendWhatsappText } from "@/lib/whatsapp/graph"

export type SendWhatsappResult =
  | { ok: true; messageId: string; status: Extract<WhatsappMessageStatus, "accepted" | "held"> }
  | { ok: false; error: string; messageId?: string }

const GENERIC_ERROR = "Não foi possível enviar agora. Tente de novo."

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Envia texto livre numa conversa aberta. Devolve o motivo em português quando
 * o banco recusa — e o motivo é o real, nunca um "erro ao enviar" genérico.
 */
export async function sendWhatsappMessage(
  conversationId: string,
  body: string
): Promise<SendWhatsappResult> {
  const supabase = await createClient()

  // 1. A trava. Com a sessão do usuário: papel e imobiliária vêm da RLS.
  const { data: queued, error: queueError } = await supabase.rpc("queue_whatsapp_message", {
    p_conversation_id: conversationId,
    p_body: body,
    p_marketing: false,
  })

  if (queueError) {
    console.error(`[whatsapp] queue_whatsapp_message falhou (${queueError.code ?? "erro"})`)
    return { ok: false, error: GENERIC_ERROR }
  }

  const result = isRecord(queued) ? queued : {}

  if (result.ok !== true) {
    return { ok: false, error: whatsappBlockReasonMessage(result.reason) }
  }

  const messageId = typeof result.message_id === "string" ? result.message_id : ""

  if (!messageId) {
    return { ok: false, error: GENERIC_ERROR }
  }

  // 2. Dados do canal, ainda com a sessão (a RLS confirma que é desta imobiliária).
  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("contact_wa_id, whatsapp_channels!inner(phone_number_id, connected_account_id)")
    .eq("id", conversationId)
    .maybeSingle()

  if (conversationError || !conversation) {
    await failMessage(messageId, null, "conversa_indisponivel")
    return { ok: false, error: GENERIC_ERROR, messageId }
  }

  const channel = Array.isArray(conversation.whatsapp_channels)
    ? conversation.whatsapp_channels[0]
    : conversation.whatsapp_channels

  if (!channel) {
    await failMessage(messageId, null, "numero_indisponivel")
    return { ok: false, error: GENERIC_ERROR, messageId }
  }

  // 3. Credencial e envio.
  try {
    const credential = await getConnectionCredential(channel.connected_account_id)
    const sent = await sendWhatsappText({
      phoneNumberId: channel.phone_number_id,
      token: credential.token,
      to: conversation.contact_wa_id,
      body,
    })

    if (!sent.ok) {
      await markWhatsappMessageSent({
        messageId,
        wamid: null,
        messageStatus: null,
        errorCode: sent.code,
        errorTitle: sent.title,
      })

      if (sent.reason === "unauthorized") {
        // Credencial recusada: a conexão precisa ser refeita, e a tela de
        // Conexões passa a dizer isso.
        await recordConnectionError(
          channel.connected_account_id,
          String(sent.code ?? "unauthorized"),
          sent.title ?? "A Meta recusou a credencial."
        )
      }

      const known = whatsappError(sent.code)

      return {
        ok: false,
        error: known?.message ?? "A Meta recusou o envio. A mensagem ficou marcada como falha.",
        messageId,
      }
    }

    await markWhatsappMessageSent({
      messageId,
      wamid: sent.wamid,
      messageStatus: sent.messageStatus,
      errorCode: null,
      errorTitle: null,
    })

    return {
      ok: true,
      messageId,
      // `held_for_quality_assessment` pode acabar DESCARTADO (erro 132015): a
      // tela não pode dizer "enviada" enquanto isso não se resolve.
      status: sent.messageStatus === "held_for_quality_assessment" ? "held" : "accepted",
    }
  } catch (error) {
    const code = error instanceof ConnectionRpcError ? (error.code ?? "erro") : "erro"
    console.error(`[whatsapp] envio falhou (${code})`)
    await failMessage(messageId, null, code)
    return { ok: false, error: GENERIC_ERROR, messageId }
  }
}

async function failMessage(messageId: string, wamid: string | null, detail: string) {
  try {
    await markWhatsappMessageSent({
      messageId,
      wamid,
      messageStatus: null,
      errorCode: null,
      errorTitle: detail,
    })
  } catch {
    // A mensagem fica `queued`: preferimos isso a mascarar a falha original.
  }
}
