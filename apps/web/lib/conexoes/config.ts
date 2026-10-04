// Configuração das contas conectadas. Sem `server-only`: a página precisa saber
// se o WhatsApp está configurado para mostrar "configuração pendente" em vez de
// um botão que quebra — e o id do app e o id da configuração do Embedded Signup
// são públicos por natureza (viajam para o navegador no FB.login).
//
// O que NUNCA sai daqui para o navegador: META_APP_SECRET,
// META_WEBHOOK_VERIFY_TOKEN e CONNECTIONS_SERVER_KEY. As três só são lidas em
// módulos com "server-only".

import { WHATSAPP_GRAPH_VERSION } from "@workspace/core/whatsapp"

export type MetaPublicConfig = {
  appId: string
  /** Configuration ID do Embedded Signup (App Dashboard > WhatsApp). */
  configId: string
  graphVersion: string
}

/**
 * Valores públicos do Embedded Signup. `null` quando falta alguma coisa: nesse
 * caso a tela mostra "configuração pendente" e não oferece o botão de conectar.
 *
 * As referências a process.env precisam ser literais para o Next.js inlinar.
 */
export function getMetaPublicConfig(): MetaPublicConfig | null {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim() ?? ""
  const configId = process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID?.trim() ?? ""

  if (!/^[0-9]{5,30}$/.test(appId) || !/^[0-9]{5,30}$/.test(configId)) {
    return null
  }

  return { appId, configId, graphVersion: WHATSAPP_GRAPH_VERSION }
}

export function isWhatsappConfigured() {
  return getMetaPublicConfig() !== null
}
