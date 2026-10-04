/**
 * Página de status — o que a medição automática olha em cada parte, em pt-BR,
 * para o Console (/plataforma/status). Nada daqui vai para o público: a página
 * pública só recebe o nível.
 *
 * Os códigos de `detail` são gravados pelo banco
 * (`private.status_collect_measurements`); mudou lá, mude aqui.
 */

import type { StatusComponentKey } from "./public"

/** Regra automática de cada parte (texto do console). */
export const STATUS_COMPONENT_RULES: Record<StatusComponentKey, string> = {
  crm: "Sonda HTTP a cada minuto em /api/status/ping (app + banco). Sem resposta, erro 5xx ou tempo esgotado (5 s) = fora do ar; resposta acima de 3 s = lentidão.",
  login:
    "Mesma sonda do CRM, que também consulta o health do Auth do Supabase. App fora = fora do ar; Auth sem responder = fora do ar.",
  leads_capture:
    "Mesma sonda do CRM: as páginas públicas e formulários rodam no mesmo app e banco.",
  lead_routing:
    "Últimas 5 execuções da rotina rodizio-de-leads (a cada minuto): 1–2 falhas = lentidão, 3–4 = instabilidade parcial, 5 = fora do ar; nenhuma execução em 10 min = fora do ar.",
  notifications:
    "Idade do aviso pendente mais antigo: avisos de lead acima de 60 min e lembretes de visita acima de 30 min = lentidão; acima do triplo = instabilidade parcial. Nunca fora do ar.",
  integrations:
    "Entregas de portais na última hora: 10% ou mais com falha = lentidão; 50% ou mais = instabilidade parcial; entrega pendente há mais de 60 min = lentidão. Nunca fora do ar.",
  caixa_catalog:
    "Última carga do catálogo da Caixa há mais de 48 h = lentidão (dado desatualizado). Nunca fora do ar.",
  billing:
    "Entregas do webhook da Stripe nas últimas 2 h: segredo ausente ou assinatura que não confere, sem entrega ok depois = instabilidade parcial; mais da metade das entregas processadas com erro (mínimo 3) = lentidão. Sem entrega na janela = sem medição. Nunca fora do ar.",
}

const DETAIL_LABELS: Record<string, string> = {
  ok: "Tudo certo",
  lento: "App respondeu devagar",
  tempo_esgotado: "App não respondeu a tempo",
  erro_conexao: "Não conectou no app",
  banco_fora: "App de pé, mas o banco não respondeu",
  auth_fora: "Auth do Supabase não respondeu",
  falhas_recentes: "Execuções recentes com falha",
  sem_execucao: "Rotina sem executar nos últimos 10 min",
  fila_atrasada: "Fila de avisos atrasada",
  fila_muito_atrasada: "Fila de avisos muito atrasada",
  falhas_em_proporcao: "Parte das entregas falhou",
  muitas_falhas: "Metade ou mais das entregas falhou",
  entregas_paradas: "Entrega pendente há mais de 60 min",
  catalogo_desatualizado: "Catálogo sem carga há mais de 48 h",
  webhook_config_ausente: "Webhook da Stripe sem chave ou segredo no servidor",
  webhook_assinatura_invalida: "Assinatura do webhook da Stripe não confere com o segredo",
  webhook_erros_processamento: "Mais da metade das entregas do webhook falhou ao processar",
}

/** Rótulo do código curto gravado com a medição (http_503 → "Resposta HTTP 503"). */
export function describeMeasurementDetail(detail: string | null | undefined): string | null {
  if (!detail) {
    return null
  }

  const http = /^http_(\d{3})$/.exec(detail)

  if (http) {
    return `Resposta HTTP ${http[1]}`
  }

  return DETAIL_LABELS[detail] ?? detail
}

export const STATUS_PROBE_RESULT_LABELS: Record<string, string> = {
  ok: "App respondeu normalmente",
  lento: "App respondeu devagar (acima de 3 s)",
  http_erro: "App respondeu com erro (5xx)",
  http_configuracao:
    "Resposta inesperada (4xx ou página errada): confira o endereço em status_probe_url. Não conta como fora do ar.",
  tempo_esgotado: "App não respondeu em 5 s",
  erro_conexao: "Não foi possível conectar no app",
  resposta_invalida:
    "O endereço respondeu 200 mas não é a sonda: confira status_probe_url. Não conta como fora do ar.",
  sem_resposta: "A resposta da sonda não chegou (pg_net). Não conta como fora do ar.",
  sem_url: "Segredo status_probe_url ausente no Vault: a sonda não roda.",
  falha_ao_enviar: "O banco não conseguiu disparar a sonda (pg_net).",
}

export function describeProbeResult(result: string | null | undefined): string {
  if (!result) {
    return "Nenhuma sonda enviada ainda."
  }

  return STATUS_PROBE_RESULT_LABELS[result] ?? result
}

/** SQL de exemplo para configurar a sonda (valor ilustrativo; nunca um segredo real). */
export const STATUS_PROBE_SETUP_SQL =
  "select vault.create_secret('https://<seu-dominio>/api/status/ping', 'status_probe_url');"
