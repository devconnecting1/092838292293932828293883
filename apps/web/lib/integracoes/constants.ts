// Entrada de leads das origens externas: rótulos, caminhos e endereços.
// Módulo puro (sem env lido na importação, sem I/O): serve ao servidor e ao
// navegador.

import { LEAD_INGEST_PROVIDERS, type LeadIngestProvider } from "@workspace/core/leads/ingest"

import { WEBHOOKS_PATH_PREFIX } from "@/lib/auth/routes"
import { buildAppUrl } from "@/lib/tenant/urls"

export const INTEGRATIONS_SETTINGS_PATH = "/configuracoes/integracoes"

export { LEAD_INGEST_PROVIDERS }
export type { LeadIngestProvider }

/** Caminho do webhook do Canal Pro (o token identifica a imobiliária). */
export const CANAL_PRO_WEBHOOK_PATH = `${WEBHOOKS_PATH_PREFIX}/grupo-olx`

/** Caminho único do webhook da Meta (a página identifica a imobiliária). */
export const META_WEBHOOK_PATH = `${WEBHOOKS_PATH_PREFIX}/meta-lead-ads`

/** Formato do token do endereço (24 bytes em hex, gerado pelo banco). */
export const WEBHOOK_TOKEN_PATTERN = /^[a-f0-9]{48}$/

export function isWebhookToken(value: unknown): value is string {
  return typeof value === "string" && WEBHOOK_TOKEN_PATTERN.test(value)
}

/**
 * Endereço que a imobiliária cola no Canal Pro. Fica no domínio raiz (ou no
 * host único): o webhook é atendido em qualquer host, sem resolver tenant.
 */
export function buildCanalProWebhookUrl(token: string): string {
  return buildAppUrl(`${CANAL_PRO_WEBHOOK_PATH}/${token}`)
}

/** Endereço cadastrado no app da Meta (um só, para todos os clientes). */
export function buildMetaWebhookUrl(): string {
  return buildAppUrl(META_WEBHOOK_PATH)
}

export type ProviderCopy = {
  title: string
  /** Uma frase: o que essa integração faz pela imobiliária. */
  summary: string
  /** Como a imobiliária liga. */
  howTo: string[]
  /** Onde conferir a documentação oficial. */
  docsUrl: string
  docsLabel: string
}

export const PROVIDER_COPY: Record<LeadIngestProvider, ProviderCopy> = {
  canal_pro: {
    title: "ZAP, Viva Real e OLX (Canal Pro)",
    summary:
      "Quem chama seu anúncio no ZAP Imóveis, no Viva Real ou na OLX entra direto no funil, já com o imóvel certo e o corretor da vez.",
    howTo: [
      "Copie o endereço abaixo.",
      'No Canal Pro, abra "Integrações de anúncios", vá na aba "Leads" e escolha "Receber leads no CRM".',
      'Em "Nome do CRM" escreva o nome do seu CRM e cole o endereço no campo da URL. Salve.',
      "Pronto: o Grupo OLX passa a enviar cada contato para cá. O primeiro lead costuma aparecer no mesmo dia.",
    ],
    docsUrl: "https://ajuda.zapimoveis.com.br/s/article/como-ativar-recebimento-de-leads",
    docsLabel: "Passo a passo no site do ZAP Imóveis",
  },
  meta_lead_ads: {
    title: "Meta Lead Ads (Facebook e Instagram)",
    summary:
      "Os formulários de anúncio do Facebook e do Instagram entregam o contato aqui na hora, sem ninguém baixar planilha.",
    howTo: [
      "A conta de anúncios continua sendo sua: a Meta cobra você direto, nós não entramos no meio.",
      "Informe o ID da sua Página do Facebook e cole um token de acesso de Página de longa duração.",
      'Na sua Página, o app precisa estar inscrito no campo "leadgen" para os leads começarem a chegar.',
      'Use "Testar conexão" para conferir se o token e a inscrição estão de pé.',
    ],
    docsUrl: "https://developers.facebook.com/docs/marketing-api/guides/lead-ads/",
    docsLabel: "Documentação do Lead Ads (Meta)",
  },
}
