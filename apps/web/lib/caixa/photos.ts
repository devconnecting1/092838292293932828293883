import "server-only"

import { isCaixaPhotosEnabled } from "@workspace/core/caixa/source"

/**
 * Interruptor geral das fotos da Caixa.
 *
 * Lido no servidor, a cada requisição, e repassado às telas por prop — assim
 * **um único valor** decide tanto a lista quanto a página do imóvel. Se a Caixa
 * se opuser ao uso das imagens, basta `CAIXA_PHOTOS_ENABLED=false` nas
 * variáveis do projeto: nenhuma foto é mais pedida, sem mexer em código.
 *
 * Ausente ou vazio = fotos ligadas.
 */
export function areCaixaPhotosEnabled(): boolean {
  return isCaixaPhotosEnabled(process.env.CAIXA_PHOTOS_ENABLED)
}
