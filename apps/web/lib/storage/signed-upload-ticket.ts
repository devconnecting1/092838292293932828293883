/**
 * Autorização de envio de um arquivo gerada por Server Action: o caminho é
 * decidido no servidor e o token só vale para ele.
 */
export type SignedUploadTicket = {
  path: string
  token: string
}

/** Resultado das Server Actions que autorizam envios. */
export type SignedUploadActionResult<T = SignedUploadTicket> =
  | { ok: true; data: T }
  | {
      ok: false
      error: string
      /** Assinatura em modo leitura (ou sem permissão): os próximos envios também falhariam. */
      blocked?: boolean
    }
