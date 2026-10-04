// Só roda no navegador (chamado no clique em "Sair").

import { disablePushOnDevice } from "@/app/(app)/perfil/push-actions"
import { unsubscribeThisDevice } from "@/lib/push/client"

/** Espera máxima pelo cancelamento; depois disso a saída segue mesmo assim. */
const CANCEL_TIMEOUT_MS = 3000

/**
 * Antes de sair da conta: cancela os avisos no celular deste aparelho, para um
 * aparelho compartilhado não continuar recebendo os leads de quem saiu.
 * Primeiro o navegador (o aparelho para de receber mesmo se o servidor falhar),
 * depois o servidor, ainda com a sessão, apaga o registro deste aparelho.
 * Nunca rejeita e não espera mais que alguns segundos: sair sempre funciona.
 */
export async function cancelPushBeforeSignOut(): Promise<void> {
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      expired = true
      resolve(null)
    }, CANCEL_TIMEOUT_MS)
  })

  try {
    const endpoint = await Promise.race([unsubscribeThisDevice().catch(() => null), deadline])

    // Sem inscrição neste navegador não há o que desligar no servidor. Se o prazo
    // acabou, a ação não é disparada depois da saída.
    if (endpoint && !expired) {
      await Promise.race([disablePushOnDevice(endpoint).catch(() => null), deadline])
    }
  } catch {
    // Falha no cancelamento não impede sair.
  } finally {
    clearTimeout(timer)
  }
}
