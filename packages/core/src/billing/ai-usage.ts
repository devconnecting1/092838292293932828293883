// Medição e corte de IA: preços do modelo, tetos de custo por plano, peso por
// tipo de uso e a decisão de liberar ou bloquear uma requisição.
//
// Regra do dono (não negociável): o produto não pode ter prejuízo com IA em
// nenhum plano, em nenhuma hipótese. Por isso a trava principal é um TETO DE
// CUSTO EM REAIS por ciclo, acima de qualquer contagem de conversa: a franquia
// de conversas é o rótulo comercial (o que o cliente compra), o teto em reais é
// o que garante a margem. Quando o teto estoura, bloqueia — mesmo que ainda
// sobrem conversas na franquia.
//
// Estas funções são puras: o app usa para projetar e explicar, mas quem aplica o
// corte de verdade é o banco (RPC reserve_ai_usage), que repete a mesma regra.
//
// FONTE ÚNICA DOS NÚMEROS: este arquivo. O banco guarda cópias — ao mudar preço,
// câmbio, desconto do lote ou teto aqui, copie para private.ai_models(),
// private.ai_pricing() e private.ai_cost_cap_cents() numa migração nova (a última
// foi plan_prices_increase_ai_caps). A tela Console → Custos de IA
// confere banco x core e marca "Diferente" quando não batem.

import type { BillingState } from "./state"
import { PLANS, type BillingPlanKey, type PlanKey } from "./plans"

// ---------------------------------------------------------------------------
// 1. Modelos e preços (US$ por milhão de tokens)
// ---------------------------------------------------------------------------

/** Data da tabela de preços consultada. Preço muda: confira antes de reajustar planos. */
export const AI_PRICING_CHECKED_AT = "2026-09-17"

/** Página oficial de onde vêm os preços abaixo. */
export const AI_PRICING_SOURCE_URL = "https://platform.claude.com/docs/en/about-claude/pricing"

/** Modelos que o produto chama. Qualquer outro é recusado na medição (nunca subcobrar). */
export const AI_MODELS = ["claude-sonnet-5", "claude-haiku-4-5"] as const

export type AiModel = (typeof AI_MODELS)[number]

export type AiModelPrice = {
  input: number
  output: number
  cacheRead: number
  /** Escrita de cache de 5 min: o único preço de escrita que o banco mede. */
  cacheWrite: number
  /** Escrita de cache de 1 h: só usada na conversão de `aiUsageFromApi`. */
  cacheWrite1h: number
}

export type AiModelDefinition = {
  label: string
  contextTokens: number
  priceUsdPerMtok: AiModelPrice
  /**
   * Aceita `output_config.effort`. O Haiku 4.5 NÃO aceita (fica fora da lista de
   * modelos suportados em platform.claude.com/docs/en/build-with-claude/effort,
   * conferida em 2026-09-17): mandar o campo para ele é erro 400.
   */
  supportsEffort: boolean
  /**
   * Aceita `thinking: {type: "adaptive"}`. O Haiku 4.5 só tem o raciocínio manual
   * (budget_tokens) e, sem o campo `thinking`, não raciocina.
   */
  adaptiveThinking: boolean
}

/**
 * Preço oficial em US$ por milhão de tokens, conferido em 2026-09-17 em
 * platform.claude.com/docs/en/about-claude/pricing:
 *  - Claude Sonnet 5: entrada 2; escrita de cache 5 min 2,50; 1 h 4; leitura 0,20; saída 10.
 *  - Claude Haiku 4.5: entrada 1; escrita de cache 5 min 1,25; 1 h 2; leitura 0,10; saída 5.
 *
 * Espelho: private.ai_models() no banco.
 */
export const AI_MODEL_CATALOG: Record<AiModel, AiModelDefinition> = {
  "claude-sonnet-5": {
    label: "Claude Sonnet 5",
    contextTokens: 1_000_000,
    priceUsdPerMtok: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite1h: 4 },
    supportsEffort: true,
    adaptiveThinking: true,
  },
  "claude-haiku-4-5": {
    label: "Claude Haiku 4.5",
    contextTokens: 200_000,
    priceUsdPerMtok: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 },
    supportsEffort: false,
    adaptiveThinking: false,
  },
}

/**
 * Modelo assumido quando a chamada não informa qual usou (chamada antiga ao
 * banco): o mais caro do catálogo, para nunca medir a menos. Espelho de
 * private.ai_default_model().
 */
export const AI_DEFAULT_MODEL: AiModel = "claude-sonnet-5"

/**
 * Batch API: 50% de desconto em entrada e saída (Sonnet 5 1/5; Haiku 4.5
 * 0,50/2,50), e os multiplicadores de cache se somam ao desconto — ou seja, o
 * lote custa metade em tudo. Resposta em até 24 h: só para trabalho que pode
 * esperar (perfil com `batchable`). Espelho de private.ai_pricing().batch_multiplier.
 */
export const AI_BATCH_PRICE_MULTIPLIER = 0.5

export function isAiModel(value: unknown): value is AiModel {
  return typeof value === "string" && (AI_MODELS as readonly string[]).includes(value)
}

/** Preço do modelo. Modelo desconhecido lança erro: sem preço não há como medir sem subcobrar. */
export function aiModelPrice(model: string): AiModelPrice {
  if (!isAiModel(model)) {
    throw new Error(`Modelo de IA desconhecido: ${String(model)}`)
  }

  return AI_MODEL_CATALOG[model].priceUsdPerMtok
}

/**
 * Câmbio configurável. `ptax` é a cotação oficial do dia consultado; `card` é o
 * dólar efetivo de cartão (com IOF e spread), que é o que a empresa paga de fato.
 * O padrão é o `card`: superestimar o câmbio protege a margem.
 */
export const AI_EXCHANGE_RATES = { ptax: 5.1523, card: 5.6675 } as const
/**
 * Política de câmbio: o valor usado na medição é sempre **10% acima da cotação
 * oficial do dia em que foi conferido**. Não é palpite — um pagamento
 * internacional em cartão embute IOF e spread, que juntos dão ~8,8%; os 10%
 * cobrem isso e deixam 1,2% de folga.
 *
 * Subestimar o câmbio é a forma mais silenciosa de ter prejuízo com IA: o corte
 * acontece em reais, então um dólar mais caro que o previsto significa gastar
 * mais dólares do que o teto autorizava. Ao atualizar `ptax`, recalcule `card`
 * como ptax × 1,10 e ajuste AI_PRICING_CHECKED_AT.
 */
export const AI_EXCHANGE_RATE_DEFAULT: number = AI_EXCHANGE_RATES.card

// ---------------------------------------------------------------------------
// 2. Tetos de custo por plano
// ---------------------------------------------------------------------------

/**
 * Fatia máxima do preço de tabela do plano que pode virar custo de IA num ciclo.
 *
 * Era 15%. Subiu para 20% em 16/09/2026 (decisão do dono) quando a conversa
 * típica foi recalculada com o comportamento real do Sonnet 5: com 15%, Equipe e
 * Rede batiam o teto antes de entregar a franquia anunciada. Desde 17/09/2026 é
 * só o limite de cima: o teto é o MENOR entre isto e o custo da franquia com
 * folga (`AI_COST_CAP_FRANCHISE_SLACK`).
 */
export const AI_COST_CAP_PCT = 0.2

/**
 * Folga sobre o custo da franquia inteira em conversas típicas (decisão do dono
 * em 17/09/2026). 20% do preço sobrava demais no plano Imobiliária: a franquia de
 * 50 conversas custa ~R$ 27,65 no pior caso e o teto era R$ 49,80. Com 1,25 o
 * teto cobre a franquia com 25% de margem de erro na estimativa e não autoriza
 * gasto além disso.
 */
export const AI_COST_CAP_FRANCHISE_SLACK = 1.25

/**
 * Teto do teste grátis em centavos: ZERO. Decisão do dono em 17/09/2026: o teste
 * tem os recursos do Equipe, menos a IA — a IA começa quando a imobiliária
 * assina. Antes eram 10 conversas e R$ 6,00. O banco recusa em qualquer conta
 * 'trialing' (inclusive teste criado na Stripe), não só no plano "trial".
 */
export const AI_TRIAL_COST_CAP_CENTS = 0

/** O teto do ciclo também vale por dia (1/N) e por semana (1/M): ninguém queima o mês num dia. */
export const AI_DAILY_CAP_DIVISOR = 15
export const AI_WEEKLY_CAP_DIVISOR = 4

/**
 * Piso das janelas curtas, em centavos. Sem ele, num teto de ciclo pequeno a
 * fração diária não pagaria nem uma conversa e o corte do dia viraria o corte
 * real. O piso só afrouxa o ritmo: nunca passa do teto do ciclo, que continua
 * sendo o limite de gasto (teto zero, como no teste grátis, segue zero).
 */
export const AI_MIN_DAILY_CAP_CENTS = 100
export const AI_MIN_WEEKLY_CAP_CENTS = 150

/**
 * Teto de custo de IA do ciclo mensal, por imobiliária, em centavos. É o MÁXIMO
 * que o banco deixa gastar, não o gasto esperado.
 *
 * Regra (decisão do dono em 17/09/2026): o menor valor entre
 *  - 20% do PREÇO DE TABELA MENSAL do plano, e
 *  - franquia × custo da conversa típica × 1,25, arredondado para cima.
 *
 * Resultado hoje, com os preços de 17/09/2026: Imobiliária R$ 34,56, Equipe
 * R$ 138,24 e Rede R$ 345,59. Nos três o lado menor é a FRANQUIA: depois do
 * aumento de preço (Imobiliária R$ 320, Equipe R$ 775, Rede R$ 1.930), 20% do
 * preço passou a sobrar em todo plano — quem manda no teto é o custo da
 * franquia anunciada, que não mudou. Corretor e teste grátis: zero. Copie os
 * valores para private.ai_cost_cap_cents() ao mudar qualquer entrada.
 *
 * Sempre o preço de tabela, nunca o valor cobrado:
 *  - Indique e ganhe: quem acumula 100% de desconto paga R$ 0, mas as
 *    indicações dele pagam; calcular sobre o valor com desconto deixaria esse
 *    cliente sem IA nenhuma.
 *  - No plano anual a franquia continua mensal (o ciclo de IA é mensal,
 *    ancorado no dia da assinatura), então o teto também é mensal.
 */
export function aiCostCapCents(plan: BillingPlanKey): number {
  if (plan === "trial") {
    return AI_TRIAL_COST_CAP_CENTS
  }

  const franchise = PLANS[plan].limits.ai_conversations

  // Plano sem franquia de IA (Corretor) não tem teto a autorizar: nada pode ser
  // gasto. A franquia 0 já bloqueia antes, mas o teto zero fecha a segunda porta.
  if (franchise === 0) {
    return 0
  }

  const byPrice = Math.round(PLANS[plan].prices.month * AI_COST_CAP_PCT)

  // Franquia ilimitada não tem custo de franquia a calcular: vale só o limite de cima.
  if (franchise < 0) {
    return byPrice
  }

  const byFranchise = Math.ceil(
    (franchise * typicalConversationCostMillicents() * AI_COST_CAP_FRANCHISE_SLACK) /
      AI_MILLICENTS_PER_CENT
  )

  return Math.min(byPrice, byFranchise)
}

/** Teto do dia, em centavos: 1/15 do teto do ciclo (para cima), com piso e nunca acima do ciclo. */
export function aiDailyCapCents(cycleCapCents: number): number {
  const cycle = Math.max(0, Math.ceil(cycleCapCents))
  return Math.min(cycle, Math.max(Math.ceil(cycle / AI_DAILY_CAP_DIVISOR), AI_MIN_DAILY_CAP_CENTS))
}

/** Teto da semana, em centavos: 1/4 do teto do ciclo (para cima), com piso e nunca acima do ciclo. */
export function aiWeeklyCapCents(cycleCapCents: number): number {
  const cycle = Math.max(0, Math.ceil(cycleCapCents))
  return Math.min(
    cycle,
    Math.max(Math.ceil(cycle / AI_WEEKLY_CAP_DIVISOR), AI_MIN_WEEKLY_CAP_CENTS)
  )
}

// ---------------------------------------------------------------------------
// 3. Limites por requisição e rajada
// ---------------------------------------------------------------------------

/**
 * Teto de tokens por chamada. Acima disso a requisição é recusada ANTES de
 * acionar o modelo: conversa longa tem que ser resumida ou cortada pela feature,
 * nunca crescer sem teto (o modelo aceita 1M de contexto, o bolso não).
 */
export const AI_MAX_INPUT_TOKENS = 12_000
export const AI_MAX_OUTPUT_TOKENS = 1_500

/** Rajada: impede laço automatizado queimando o teto do dia em segundos. */
export const AI_RATE_LIMIT = { perOrganizationPerMinute: 10, perUserPerMinute: 4 } as const

/** Requisição idêntica (mesmo hash de entrada) dentro da janela devolve a resposta anterior. */
export const AI_DEDUPE_WINDOW_MINUTES = 10

/**
 * O excedente de IA só pode existir quando houver como COBRÁ-LO. Hoje os
 * add-ons de conversa extra estão como "em breve" (ADDONS em plans.ts) e não há
 * preço na Stripe, então autorizar excedente significaria a imobiliária
 * autorizar **a nossa empresa** a gastar por ela — dinheiro saindo sem nota
 * entrando. Enquanto esta constante for false, o teto de excedente é zero e a
 * IA para exatamente no teto do plano.
 *
 * Para ligar: crie os preços na Stripe, implemente a cobrança do excedente no
 * fechamento do ciclo e só então mude para true.
 */
export const AI_OVERAGE_BILLING_AVAILABLE = false

/**
 * Maior teto de excedente que a imobiliária pode definir por ciclo, em centavos.
 * R$ 5.000,00 é a trava contra erro de digitação, mas ela só vale quando a
 * cobrança existir — sem isso o máximo é zero.
 */
export const AI_MAX_OVERAGE_CAP_LIMIT_CENTS = 500_000
export const AI_MAX_OVERAGE_CAP_CENTS = AI_OVERAGE_BILLING_AVAILABLE
  ? AI_MAX_OVERAGE_CAP_LIMIT_CENTS
  : 0

/** "Conversa" = janela com o mesmo contato. Padrão do WhatsApp (sessão de 24 h). */
export const AI_CONVERSATION_WINDOW_HOURS = 24

// ---------------------------------------------------------------------------
// 4. Tipos de uso e peso
// ---------------------------------------------------------------------------

export const AI_USAGE_KINDS = [
  "conversation",
  "listing_copy",
  "conversation_summary",
  "reply_suggestion",
] as const

export type AiUsageKind = (typeof AI_USAGE_KINDS)[number]

export const AI_USAGE_KIND_LABELS: Record<AiUsageKind, string> = {
  conversation: "Conversa no WhatsApp",
  listing_copy: "Anúncio redigido pela IA",
  conversation_summary: "Resumo de conversa",
  reply_suggestion: "Sugestão de resposta",
}

/**
 * Quanto cada tipo consome da franquia, em unidades inteiras de "conversa".
 *
 * Regra de consumo:
 *  - `conversation`: uma janela de 24 h com o mesmo contato conta UMA vez, por
 *    mais mensagens que tenha (o cliente entende "conversa", não "requisição");
 *  - os demais são requisições avulsas e valem 1 unidade cada.
 *
 * O peso existe para o dono encarecer um tipo que saia caro (ex.: 2) sem mexer
 * na tabela de planos. O custo real de cada tipo não entra aqui: ele entra pelo
 * teto em reais, que é a trava de margem.
 */
export const AI_UNIT_WEIGHTS: Record<AiUsageKind, number> = {
  conversation: 1,
  listing_copy: 1,
  conversation_summary: 1,
  reply_suggestion: 1,
}

export type AiEffort = "low" | "medium" | "high"

/**
 * Effort padrão de qualquer chamada sem perfil próprio (decisão do dono em
 * 17/09/2026). Sem o campo, a API usa `high` — o nível mais caro que faz sentido
 * aqui. A documentação do Sonnet 5 descreve `medium` como o degrau de economia a
 * partir do padrão (platform.claude.com/docs/en/build-with-claude/effort).
 * Nunca omitir: `aiMessageParams` sempre manda o effort para quem aceita.
 */
export const AI_DEFAULT_EFFORT: AiEffort = "medium"

/**
 * Como cada tipo de uso chama o modelo. Conferido em 2026-09-17 nas páginas
 * oficiais de pricing, effort e thinking (platform.claude.com/docs).
 *
 * Fatos que mandam aqui:
 *  - Sonnet 5: sem o campo `thinking`, o raciocínio adaptativo LIGA sozinho, e o
 *    effort padrão é `high`. Raciocínio é cobrado como saída (US$ 10/milhão)
 *    mesmo quando não aparece. Por isso o effort é sempre explícito.
 *  - A documentação recomenda `low` para "chat and non-coding use cases" de alto
 *    volume, e `medium` como degrau de economia a partir do padrão. `low` gasta
 *    MENOS que `medium`: os perfis que já estavam em `low` continuam em `low`
 *    (o dono pediu para baratear) e o que não tem perfil cai em
 *    `AI_DEFAULT_EFFORT` (`medium`), nunca no `high` da API.
 *  - Haiku 4.5 (metade do preço do Sonnet 5; a página de preços o indica para
 *    tarefas simples) NÃO aceita `effort` (erro 400) e só raciocina se o campo
 *    `thinking` vier ligado com budget_tokens. Resumo e sugestão de resposta
 *    rodam nele SEM raciocínio: mais barato que Sonnet 5 em `low`. Por isso o
 *    effort desses perfis é `null` (não é mandado), e não `low`.
 *  - Trocar o effort ou o modelo no meio da conversa invalida o cache: o perfil
 *    é por tipo de uso e fica fixo durante a conversa inteira.
 *
 * Alavanca futura, NÃO aplicada: desligar o raciocínio da conversa no WhatsApp
 * (`thinking: {type: "disabled"}` no Sonnet 5) cortaria a parte de saída que é
 * raciocínio (~120 de ~445 tokens por turno na estimativa). Só depois de
 * avaliação de qualidade com conversas reais — atendimento ruim custa mais que
 * o token economizado.
 *
 * `maxTokens` é o teto de saída TOTAL da chamada (raciocínio + texto). Se a
 * resposta vier com `stop_reason: "max_tokens"`, o texto veio cortado: não envie
 * ao cliente; registre e devolva para o corretor.
 *
 * `temperature`, `top_p` e `top_k` não entram: no Sonnet 5 qualquer valor fora do
 * padrão devolve erro 400.
 */
export type AiRequestProfile = {
  model: AiModel
  /** null = o modelo não aceita effort (Haiku 4.5): o campo não é mandado. */
  effort: AiEffort | null
  /** `adaptive` = raciocínio adaptativo (Sonnet 5); `off` = sem o campo e sem raciocínio (Haiku 4.5). */
  thinking: "adaptive" | "off"
  maxTokens: number
  /**
   * `1h` quando o intervalo entre chamadas costuma passar de 5 minutos (cliente
   * respondendo no WhatsApp). Escrita de 1 h custa 2x a entrada e se paga a
   * partir da segunda leitura; `5m` custa 1,25x e se paga na primeira.
   */
  cacheTtl: "5m" | "1h"
  /** Pode ir pela Batch API (50% de desconto, resposta em até 24 h) quando for em lote. */
  batchable: boolean
}

export const AI_REQUEST_PROFILES: Record<AiUsageKind, AiRequestProfile> = {
  // Atendimento no WhatsApp: alto volume, resposta curta, precisa ser rápido e
  // bom. Sonnet 5 em `low`, com raciocínio adaptativo (ver alavanca futura acima).
  conversation: {
    model: "claude-sonnet-5",
    effort: "low",
    thinking: "adaptive",
    maxTokens: AI_MAX_OUTPUT_TOKENS,
    cacheTtl: "1h",
    batchable: false,
  },
  // Texto de anúncio é vitrine: Sonnet 5 em `medium`, e em lote (imóveis
  // importados) vai pela Batch API.
  listing_copy: {
    model: "claude-sonnet-5",
    effort: "medium",
    thinking: "adaptive",
    maxTokens: AI_MAX_OUTPUT_TOKENS,
    cacheTtl: "5m",
    batchable: true,
  },
  // Tarefas simples: Haiku 4.5, sem effort (não aceita) e sem raciocínio.
  conversation_summary: {
    model: "claude-haiku-4-5",
    effort: null,
    thinking: "off",
    maxTokens: AI_MAX_OUTPUT_TOKENS,
    cacheTtl: "5m",
    batchable: true,
  },
  reply_suggestion: {
    model: "claude-haiku-4-5",
    effort: null,
    thinking: "off",
    maxTokens: AI_MAX_OUTPUT_TOKENS,
    cacheTtl: "5m",
    batchable: false,
  },
}

/**
 * Perfil de qualquer chamada que ainda não tem tipo de uso próprio: Sonnet 5 em
 * `AI_DEFAULT_EFFORT` (`medium`), nunca o `high` que a API usaria sem o campo.
 */
export const AI_DEFAULT_REQUEST_PROFILE: AiRequestProfile = {
  model: AI_DEFAULT_MODEL,
  effort: AI_DEFAULT_EFFORT,
  thinking: "adaptive",
  maxTokens: AI_MAX_OUTPUT_TOKENS,
  cacheTtl: "5m",
  batchable: false,
}

export function isAiUsageKind(value: unknown): value is AiUsageKind {
  return typeof value === "string" && (AI_USAGE_KINDS as readonly string[]).includes(value)
}

/** Perfil do tipo de uso; tipo desconhecido ou ausente cai no perfil padrão (`medium`). */
export function aiRequestProfile(kind: unknown): AiRequestProfile {
  return isAiUsageKind(kind) ? AI_REQUEST_PROFILES[kind] : AI_DEFAULT_REQUEST_PROFILE
}

/**
 * Campos da Messages API que o perfil controla, no formato do corpo da
 * requisição (sem depender do SDK). Quem chamar o modelo espalha isto no corpo:
 *  - `output_config.effort` vai SEMPRE para o modelo que aceita (sem ele a API
 *    usaria `high`); perfil sem effort num modelo que aceita recebe o padrão;
 *  - `thinking` adaptativo só vai para o modelo que o aceita; `off` omite o campo.
 */
export type AiMessageParams = {
  model: AiModel
  max_tokens: number
  thinking?: { type: "adaptive" }
  output_config?: { effort: AiEffort }
}

export function aiMessageParams(profile: AiRequestProfile): AiMessageParams {
  const definition = AI_MODEL_CATALOG[profile.model]
  const params: AiMessageParams = { model: profile.model, max_tokens: profile.maxTokens }

  if (definition.adaptiveThinking && profile.thinking === "adaptive") {
    params.thinking = { type: "adaptive" }
  }

  if (definition.supportsEffort) {
    params.output_config = { effort: profile.effort ?? AI_DEFAULT_EFFORT }
  }

  return params
}

/** Unidades da franquia consumidas por `units` requisições do tipo. */
export function aiUnitsFor(kind: AiUsageKind, units = 1): number {
  const safe = Number.isFinite(units) ? Math.max(0, Math.floor(units)) : 0
  return safe * AI_UNIT_WEIGHTS[kind]
}

// ---------------------------------------------------------------------------
// 5. Custo
// ---------------------------------------------------------------------------

export type AiTokenUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/**
 * Custo é guardado em MILÉSIMOS DE CENTAVO (millicents). Uma requisição avulsa
 * custa fração de centavo; arredondar cada uma para o centavo inflaria a conta
 * do cliente em até ~20%. A UI e as RPCs expõem centavos.
 */
export const AI_MILLICENTS_PER_CENT = 1000

function tokens(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : 0
}

/**
 * Como a chamada foi (ou vai ser) cobrada. Mesmo contrato do banco
 * (private.ai_cost_millicents): sem modelo = `AI_DEFAULT_MODEL` (o mais caro),
 * sem `batch` = preço cheio; modelo desconhecido lança erro.
 */
export type AiCostOptions = {
  model?: AiModel
  /** Chamada pela Batch API: metade do preço em tudo. */
  batch?: boolean
  /** Câmbio US$ → R$; inválido ou ausente cai no padrão. */
  rate?: number
}

/** Custo em dólares dos tokens informados, pelo preço do modelo e com o desconto do lote. */
export function aiCostUsd(usage: AiTokenUsage, options: AiCostOptions = {}): number {
  const price = aiModelPrice(options.model ?? AI_DEFAULT_MODEL)
  const multiplier = options.batch ? AI_BATCH_PRICE_MULTIPLIER : 1

  return (
    ((tokens(usage.inputTokens) * price.input +
      tokens(usage.outputTokens) * price.output +
      tokens(usage.cacheReadTokens) * price.cacheRead +
      tokens(usage.cacheWriteTokens) * price.cacheWrite) /
      1_000_000) *
    multiplier
  )
}

/** Custo em millicents, arredondado para cima (nunca contar menos do que custou). */
export function aiCostMillicents(usage: AiTokenUsage, options: AiCostOptions = {}): number {
  const rate = options.rate ?? AI_EXCHANGE_RATE_DEFAULT
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : AI_EXCHANGE_RATE_DEFAULT
  return Math.ceil(aiCostUsd(usage, options) * safeRate * 100 * AI_MILLICENTS_PER_CENT)
}

/**
 * Campo `usage` da resposta da Messages API, só com o que a medição lê.
 * `output_tokens` já inclui os tokens de raciocínio (thinking), que são cobrados
 * como saída mesmo quando não aparecem na resposta.
 */
export type AnthropicUsage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null
    ephemeral_1h_input_tokens?: number | null
  } | null
}

/**
 * Converte o `usage` da API para o formato que o banco mede.
 *
 * O banco tem um preço só de escrita de cache (5 min). A escrita de 1 hora custa
 * 1,6x isso (nos dois modelos do catálogo: 4/2,50 no Sonnet 5 e 2/1,25 no Haiku
 * 4.5), então ela entra convertida em tokens equivalentes de 5 min, arredondando
 * para cima. Quando a API não detalha a escrita por duração, tudo é tratado como
 * 1 hora: na dúvida, medir a mais, nunca a menos.
 */
export function aiUsageFromApi(
  usage: AnthropicUsage | null | undefined,
  model: AiModel = AI_DEFAULT_MODEL
): Required<AiTokenUsage> {
  const price = aiModelPrice(model)
  const written = tokens(usage?.cache_creation_input_tokens ?? undefined)
  const detail = usage?.cache_creation
  const fiveMinutes = detail ? tokens(detail.ephemeral_5m_input_tokens ?? undefined) : 0
  // Sem detalhe, ou detalhe que não fecha com o total: o que sobra conta como 1 h.
  const oneHour = Math.max(
    detail ? tokens(detail.ephemeral_1h_input_tokens ?? undefined) : 0,
    written - fiveMinutes
  )
  const oneHourAsFiveMinutes = Math.ceil((oneHour * price.cacheWrite1h) / price.cacheWrite)

  return {
    inputTokens: tokens(usage?.input_tokens ?? undefined),
    outputTokens: tokens(usage?.output_tokens ?? undefined),
    cacheReadTokens: tokens(usage?.cache_read_input_tokens ?? undefined),
    cacheWriteTokens: fiveMinutes + oneHourAsFiveMinutes,
  }
}

/** Millicents → centavos, para exibir. */
export function millicentsToCents(millicents: number): number {
  return Number.isFinite(millicents) ? Math.round(millicents / AI_MILLICENTS_PER_CENT) : 0
}

export function centsToMillicents(cents: number): number {
  return Number.isFinite(cents) ? Math.round(cents) * AI_MILLICENTS_PER_CENT : 0
}

/**
 * Conversa típica assumida para projeção e para a tabela de planos (ESTIMATIVA
 * conservadora, recalculada em 16/09/2026 — troque por média medida assim que
 * houver tráfego real em `ai_usage_periods`). 8 idas e vindas no perfil
 * `AI_REQUEST_PROFILES.conversation`, em tokens já convertidos para a régua do
 * banco (escrita de 1 h vira equivalente de 5 min, ver `aiUsageFromApi`):
 *
 *  - 1ª mensagem grava em cache de 1 h ferramentas, instruções e ficha do imóvel
 *    (~3.400 tokens reais → 5.400 equivalentes);
 *  - a cada mensagem seguinte o HISTÓRICO inteiro é reenviado: o que já estava
 *    em cache é lido (10% do preço) e o que entrou de novo é gravado. Uma em cada
 *    dez respostas do cliente chega depois de 1 h e regrava tudo;
 *  - saída = texto (~325) + raciocínio em effort `low` (~120). Raciocínio é
 *    cobrado como saída mesmo sem aparecer.
 *
 * Os números antigos (600 de entrada, 250 de saída, R$ 0,21) ignoravam três
 * coisas documentadas do Sonnet 5: raciocínio ligado por padrão, tokenizador que
 * gera ~30% mais tokens e o histórico que cresce a cada turno.
 */
export const AI_TYPICAL_CONVERSATION = {
  turns: 8,
  cacheWriteTokens: 5_400,
  cacheWriteTokensPerTurn: 2_200,
  cacheReadTokensPerTurn: 5_400,
  inputTokensPerTurn: 150,
  outputTokensPerTurn: 445,
} as const

/**
 * Requisição avulsa típica (redigir anúncio, resumir conversa, sugerir resposta),
 * com o tokenizador do Sonnet 5 e o raciocínio do perfil incluídos. ESTIMATIVA.
 * Vale também para o Haiku 4.5 sem descontar o raciocínio que ele não faz:
 * conservador de propósito até haver média medida.
 */
export const AI_TYPICAL_REQUEST = { inputTokens: 2_000, outputTokens: 900 } as const

export function typicalConversationTokens(): Required<AiTokenUsage> {
  const t = AI_TYPICAL_CONVERSATION
  const laterTurns = Math.max(0, t.turns - 1)

  return {
    inputTokens: t.inputTokensPerTurn * t.turns,
    outputTokens: t.outputTokensPerTurn * t.turns,
    // O primeiro turno grava o prefixo fixo; os seguintes leem o que já está em
    // cache e gravam o que entrou de novo.
    cacheWriteTokens: t.cacheWriteTokens + t.cacheWriteTokensPerTurn * laterTurns,
    cacheReadTokens: t.cacheReadTokensPerTurn * laterTurns,
  }
}

/** Custo da conversa típica, em millicents, no modelo do perfil de conversa (Sonnet 5). */
export function typicalConversationCostMillicents(rate = AI_EXCHANGE_RATE_DEFAULT): number {
  return aiCostMillicents(typicalConversationTokens(), {
    model: AI_REQUEST_PROFILES.conversation.model,
    rate,
  })
}

/**
 * Custo da requisição avulsa típica, em millicents, no modelo mais caro e sem
 * lote: a projeção de pior caso para pedidos avulsos.
 */
export function typicalRequestCostMillicents(rate = AI_EXCHANGE_RATE_DEFAULT): number {
  return aiCostMillicents(AI_TYPICAL_REQUEST, { model: AI_DEFAULT_MODEL, rate })
}

export type AiTypicalUsageCost = {
  kind: AiUsageKind
  model: AiModel
  effort: AiEffort | null
  /** Custo típico de uma unidade do tipo (conversa inteira ou pedido avulso), em millicents. */
  costMillicents: number
  /** O mesmo pela Batch API; null quando o tipo não vai em lote. */
  batchCostMillicents: number | null
}

/** Custo típico de cada tipo de uso no modelo do seu perfil (ESTIMATIVA, para projeção e para o Console). */
export function aiTypicalUsageCosts(rate = AI_EXCHANGE_RATE_DEFAULT): AiTypicalUsageCost[] {
  return AI_USAGE_KINDS.map((kind) => {
    const profile = AI_REQUEST_PROFILES[kind]
    const usage = kind === "conversation" ? typicalConversationTokens() : AI_TYPICAL_REQUEST

    return {
      kind,
      model: profile.model,
      effort: profile.effort,
      costMillicents: aiCostMillicents(usage, { model: profile.model, rate }),
      batchCostMillicents: profile.batchable
        ? aiCostMillicents(usage, { model: profile.model, batch: true, rate })
        : null,
    }
  })
}

/** Projeção de custo do ciclo, em millicents, para N conversas e M requisições avulsas. */
export function projectAiCostMillicents(
  volume: { conversations?: number; requests?: number },
  rate = AI_EXCHANGE_RATE_DEFAULT
): number {
  const conversations = Math.max(0, Math.floor(volume.conversations ?? 0))
  const requests = Math.max(0, Math.floor(volume.requests ?? 0))

  return (
    conversations * typicalConversationCostMillicents(rate) +
    requests * typicalRequestCostMillicents(rate)
  )
}

/** Quantas conversas típicas cabem num teto (em centavos). */
export function conversationsWithinCapCents(
  capCents: number,
  rate = AI_EXCHANGE_RATE_DEFAULT
): number {
  const cost = typicalConversationCostMillicents(rate)
  return cost > 0 ? Math.floor(centsToMillicents(Math.max(0, capCents)) / cost) : 0
}

// ---------------------------------------------------------------------------
// 6. Decisão: liberar ou bloquear
// ---------------------------------------------------------------------------

export type AiBlockReason =
  | "billing_blocked"
  | "feature_unavailable"
  | "request_too_large"
  | "rate_limited_organization"
  | "rate_limited_user"
  | "daily_cost_cap"
  | "weekly_cost_cap"
  | "cycle_cost_cap"
  | "quota_exhausted"
  | "overage_cap"

/**
 * Estados em que a assinatura não bloqueia a IA. Carência e modo leitura
 * bloqueiam (`billing_blocked`): IA é dinheiro saindo. O teste grátis passa por
 * aqui, mas não tem IA: cai em `feature_unavailable` logo depois (franquia e
 * teto zero), com a mesma razão que o banco devolve.
 */
export const AI_ALLOWED_BILLING_STATES: readonly BillingState[] = ["trialing", "active"]

/** Teste grátis (qualquer conta 'trialing' ou o plano "trial"): sem IA até assinar. */
export function isAiTrial(state: Pick<AiQuotaState, "planKey" | "billingState">): boolean {
  return state.billingState === "trialing" || state.planKey === "trial"
}

export type AiQuotaState = {
  planKey: BillingPlanKey
  billingState: BillingState
  /** Franquia de conversas do ciclo (-1 = ilimitada, 0 = não inclusa). */
  conversationsLimit: number
  conversationsUsed: number
  costMillicents: number
  dayCostMillicents: number
  weekCostMillicents: number
  /** Teto de excedente em centavos, definido pela imobiliária (0 = sem excedente). */
  overageCapCents: number
}

export type AiQuotaRequest = {
  kind: AiUsageKind
  units?: number
  /** Custo estimado da chamada, cobrado antes de acionar o modelo. */
  estimatedCostMillicents: number
}

export type AiQuotaDecision = {
  allowed: boolean
  reason: AiBlockReason | null
  /** true quando esta chamada já está além da franquia ou do teto do plano. */
  inOverage: boolean
  conversationsLimit: number
  conversationsUsed: number
  /** null quando a franquia é ilimitada. */
  conversationsRemaining: number | null
  costMillicents: number
  planCapMillicents: number
  overageCapMillicents: number
  /** Teto efetivo do ciclo: plano + excedente autorizado pela imobiliária. */
  effectiveCapMillicents: number
  remainingMillicents: number
  dayCapMillicents: number
  weekCapMillicents: number
}

/** Tokens acima do teto por requisição: recusar antes de chamar o modelo. */
export function isAiRequestTooLarge(usage: AiTokenUsage): boolean {
  return (
    tokens(usage.inputTokens) > AI_MAX_INPUT_TOKENS ||
    tokens(usage.outputTokens) > AI_MAX_OUTPUT_TOKENS
  )
}

/**
 * Mesma regra de `reserve_ai_usage` no banco (o banco é quem bloqueia; aqui é
 * para projetar, explicar e testar). Ordem dos cortes:
 *  1. assinatura fora de trialing/active;
 *  2. teste grátis ou plano sem franquia (`feature_unavailable`);
 *  3. teto do dia; 4. teto da semana (calculados sobre o teto efetivo do ciclo);
 *  5. teto do ciclo (plano + excedente);
 *  6. franquia de conversas.
 * Rajada e tamanho da requisição são checados antes, fora daqui.
 */
export function resolveAiQuota(state: AiQuotaState, request: AiQuotaRequest): AiQuotaDecision {
  // Teste grátis sem IA: franquia e tetos zerados, como private.ai_quota_context.
  const trial = isAiTrial(state)
  const planCap = trial ? 0 : centsToMillicents(aiCostCapCents(state.planKey))
  // Excedente gravado antes de a cobrança existir não vale: sem preço na Stripe
  // ele seria gasto nosso sem receita. A trava é aqui e também no banco.
  const overageCap =
    AI_OVERAGE_BILLING_AVAILABLE && !trial
      ? centsToMillicents(Math.max(0, state.overageCapCents))
      : 0
  const effectiveCap = planCap + overageCap
  const dayCap = centsToMillicents(aiDailyCapCents(millicentsToCents(effectiveCap)))
  const weekCap = centsToMillicents(aiWeeklyCapCents(millicentsToCents(effectiveCap)))

  const cost = Math.max(0, state.costMillicents)
  const requestCost = Math.max(0, request.estimatedCostMillicents)
  const units = aiUnitsFor(request.kind, request.units ?? 1)
  const limit = trial ? 0 : state.conversationsLimit
  const unlimited = limit < 0
  const used = Math.max(0, state.conversationsUsed)
  const remaining = unlimited ? null : Math.max(0, limit - used)

  const base: Omit<AiQuotaDecision, "allowed" | "reason" | "inOverage"> = {
    conversationsLimit: limit,
    conversationsUsed: used,
    conversationsRemaining: remaining,
    costMillicents: cost,
    planCapMillicents: planCap,
    overageCapMillicents: overageCap,
    effectiveCapMillicents: effectiveCap,
    remainingMillicents: Math.max(0, effectiveCap - cost),
    dayCapMillicents: dayCap,
    weekCapMillicents: weekCap,
  }

  // Além da franquia comercial ou além do teto do plano: só com excedente ligado.
  const beyondFranchise = !unlimited && used + units > limit
  const beyondPlanCap = cost + requestCost > planCap
  const inOverage = beyondFranchise || beyondPlanCap

  const deny = (reason: AiBlockReason): AiQuotaDecision => ({
    ...base,
    allowed: false,
    reason,
    inOverage,
  })

  if (!AI_ALLOWED_BILLING_STATES.includes(state.billingState)) {
    return deny("billing_blocked")
  }

  if (limit === 0) {
    return deny("feature_unavailable")
  }

  if (Math.max(0, state.dayCostMillicents) + requestCost > dayCap) {
    return deny("daily_cost_cap")
  }

  if (Math.max(0, state.weekCostMillicents) + requestCost > weekCap) {
    return deny("weekly_cost_cap")
  }

  if (cost + requestCost > effectiveCap) {
    // Sem excedente ligado, o corte é o teto do plano; com excedente, é o teto somado.
    return deny(overageCap > 0 ? "overage_cap" : "cycle_cost_cap")
  }

  if (beyondFranchise && overageCap === 0) {
    return deny("quota_exhausted")
  }

  return { ...base, allowed: true, reason: null, inOverage }
}

// ---------------------------------------------------------------------------
// 7. Avisos de franquia
// ---------------------------------------------------------------------------

/** A partir desta fração do consumo do ciclo sai o aviso por e-mail. */
export const AI_USAGE_WARNING_RATIO = 0.8

/**
 * Fração consumida do ciclo: a maior entre franquia de conversas e teto em reais
 * (o que estiver mais perto de bloquear é o que interessa avisar). Franquia
 * ilimitada e teto zero não contam.
 */
export function aiUsageRatio(state: {
  conversationsLimit: number
  conversationsUsed: number
  costMillicents: number
  capMillicents: number
}): number {
  const byUnits =
    state.conversationsLimit > 0
      ? Math.max(0, state.conversationsUsed) / state.conversationsLimit
      : 0
  const byCost =
    state.capMillicents > 0 ? Math.max(0, state.costMillicents) / state.capMillicents : 0

  return Math.max(byUnits, byCost)
}

export type AiUsageNoticeLevel = "80" | "100"

/** Nível do aviso a enviar (um de cada por ciclo), ou null se ainda não chegou lá. */
export function aiUsageNoticeLevel(ratio: number): AiUsageNoticeLevel | null {
  if (!Number.isFinite(ratio)) {
    return null
  }

  if (ratio >= 1) {
    return "100"
  }

  return ratio >= AI_USAGE_WARNING_RATIO ? "80" : null
}

// ---------------------------------------------------------------------------
// 8. Tabela de referência por plano (usada na tela de planos e no relatório)
// ---------------------------------------------------------------------------

export type AiPlanAllowance = {
  plan: BillingPlanKey
  /** Franquia de conversas do plano (limits.ai_conversations). */
  conversations: number
  cycleCapCents: number
  dailyCapCents: number
  weeklyCapCents: number
  /** Quantas conversas típicas o teto em reais comporta. */
  conversationsWithinCap: number
  /** Custo do ciclo se a franquia inteira for usada em conversas típicas. */
  franchiseCostCents: number
}

export function aiPlanAllowance(
  plan: BillingPlanKey,
  conversations: number,
  rate = AI_EXCHANGE_RATE_DEFAULT
): AiPlanAllowance {
  const cycleCapCents = aiCostCapCents(plan)

  return {
    plan,
    conversations,
    cycleCapCents,
    dailyCapCents: aiDailyCapCents(cycleCapCents),
    weeklyCapCents: aiWeeklyCapCents(cycleCapCents),
    conversationsWithinCap: conversationsWithinCapCents(cycleCapCents, rate),
    franchiseCostCents: millicentsToCents(
      projectAiCostMillicents({ conversations: Math.max(0, conversations) }, rate)
    ),
  }
}

/** Franquia e tetos dos 4 planos pagos (o teste grátis vem de TRIAL_LIMITS). */
export function aiPlanAllowances(rate = AI_EXCHANGE_RATE_DEFAULT): AiPlanAllowance[] {
  return (Object.keys(PLANS) as PlanKey[]).map((plan) =>
    aiPlanAllowance(plan, PLANS[plan].limits.ai_conversations, rate)
  )
}
