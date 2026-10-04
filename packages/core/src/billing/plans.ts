// Catálogo da assinatura: fonte única de preços, limites, recursos e textos de
// venda (contrato de Pagamentos, §1 e §9). O servidor grava `limits` e `features`
// em billing_accounts a partir daqui; o SQL não duplica a tabela de planos.
//
// - Valores em CENTAVOS de real.
// - Limites: -1 = ilimitado; 0 = não incluso.
// - Preços são proposta [E]: confirmar com o usuário antes do modo live da Stripe.
// - Não citar concorrentes nos textos (risco de publicidade comparativa).

import { PROPERTY_STATUS_LABELS, type PropertyStatus } from "../properties/enums"
import { FEATURE_KEYS, FEATURES, type FeatureKey, type FeatureStatus } from "./features"
import { formatBRL } from "./format"
import type { LimitKey } from "./limits"

export type PlanKey = "corretor" | "imobiliaria" | "equipe" | "rede"
export type BillingPlanKey = PlanKey | "trial"
export type BillingInterval = "month" | "year"

export const PLAN_KEYS: readonly PlanKey[] = ["corretor", "imobiliaria", "equipe", "rede"]
export const BILLING_INTERVALS: readonly BillingInterval[] = ["month", "year"]

export const TRIAL_DAYS = 14
export const GRACE_DAYS = 7
/** O teste grátis usa os limites e recursos deste plano, menos a IA. */
export const TRIAL_BASE_PLAN: PlanKey = "equipe"
/**
 * Teste grátis SEM IA (decisão do dono em 17/09/2026): a IA é o único custo
 * variável relevante e quem ainda não assinou não paga nada. Antes eram 10
 * conversas. O banco recusa em qualquer conta 'trialing' (private.ai_quota_context).
 */
export const TRIAL_AI_CONVERSATIONS = 0

export const BILLING_INTERVAL_LABELS: Record<BillingInterval, { label: string; suffix: string }> = {
  month: { label: "Mensal", suffix: "/mês" },
  year: { label: "Anual", suffix: "/ano" },
}

export type PlanBenefit = { text: string; status: FeatureStatus }

export type PlanDefinition = {
  key: PlanKey
  name: string
  audience: string
  description: string
  highlight?: boolean
  /** Centavos. O anual equivale a 10 mensalidades (2 meses grátis). */
  prices: { month: number; year: number }
  /** Centavos por usuário extra, no mesmo intervalo do plano. */
  seatPrice: { month: number; year: number }
  usersIncluded: number
  /** -1 = sem teto de usuários extras. */
  usersMax: number
  limits: Record<LimitKey, number>
  features: FeatureKey[]
  /** Bullets do cartão de preço, com "em breve" marcado por item. */
  benefits: PlanBenefit[]
  /** Nível de suporte humano (chat e WhatsApp). */
  support: string
}

type PlanSeed = Omit<PlanDefinition, "limits" | "features" | "benefits"> & {
  limits: Omit<Record<LimitKey, number>, "users">
}

const available = (text: string): PlanBenefit => ({ text, status: "available" })
const soon = (text: string): PlanBenefit => ({ text, status: "soon" })
const perMonth = (cents: number) => `${formatBRL(cents, { omitZeroCents: true })}/mês`

// ---------------------------------------------------------------------------
// Imóveis próprios: a régua que substitui "imóveis ilimitados"
//
// A régua de fotos é "imóveis próprios", não GB: GB não significa nada para um
// corretor, e imóvel com N fotos é exatamente o que custa para nós. Conta no
// limite (gatilho a0_billing_owned_listings, contagem private.owned_listing_count):
//   · imóvel com pelo menos uma foto no nosso bucket, e
//   · que ainda está na carteira (decisão do dono em 16/09/2026: vendido,
//     alugado ou inativo libera a vaga).
// Imóvel sem foto, e imóvel cujas fotos são só links para o site de origem
// (nada no nosso bucket), não entram na conta. Foto trazida por link na
// importação de planilhas é BAIXADA para o bucket e conta como qualquer outra.
// Nenhum texto pode chamar imóvel com foto de "ilimitado".
//
// O limite cresce com o adicional "+10 imóveis" (OWNED_LISTINGS_PACK_SIZE por
// pacote): computeLimits soma os pacotes em `owned_listings`, e os gatilhos do
// banco leem esse total (private.billing_limit).

/** Status que tiram o imóvel da carteira e liberam a vaga de imóvel próprio. */
export const OWNED_LISTING_RELEASED_STATUSES: readonly PropertyStatus[] = [
  "sold",
  "rented",
  "inactive",
]

function joinList(items: readonly string[], conjunction: "e" | "ou"): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`
}

const releasedStatusLabels = OWNED_LISTING_RELEASED_STATUSES.map((status) =>
  PROPERTY_STATUS_LABELS[status].toLowerCase()
)

/** "vendido, alugado ou inativo", com os rótulos de status da tela de imóveis. */
export const OWNED_LISTING_RELEASED_STATUS_TEXT = joinList(releasedStatusLabels, "ou")

/** "vendidos, alugados e inativos" (os rótulos são adjetivos com plural em -s). */
export const OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT = joinList(
  releasedStatusLabels.map((label) => `${label}s`),
  "e"
)

/** Nome curto do que o limite `owned_listings` conta, para medidores e avisos. */
export const OWNED_LISTINGS_SHORT_LABEL = "Imóveis com foto"

// Uma landing page no ar por assinatura, igual em todos os planos: os 9 modelos
// ficam disponíveis para qualquer plano e o cliente troca de modelo quando quiser,
// mas só uma fica publicada. Não vendemos página extra.
const landingPageBenefit = (plan: Pick<PlanDefinition, "limits">) =>
  available(`${plan.limits.landing_pages} landing page no ar, com todos os modelos disponíveis`)
const ownedListingsBenefit = (plan: Pick<PlanDefinition, "limits">) =>
  available(
    `${plan.limits.owned_listings} imóveis à venda ou para alugar com fotos hospedadas por nós, até ${plan.limits.photos_per_listing} fotos cada`
  )

function definePlan(
  seed: PlanSeed,
  benefits: (plan: Omit<PlanDefinition, "benefits">) => PlanBenefit[]
): PlanDefinition {
  const plan: Omit<PlanDefinition, "benefits"> = {
    ...seed,
    limits: { users: seed.usersIncluded, ...seed.limits },
    features: FEATURE_KEYS.filter((feature) => FEATURES[feature].plans.includes(seed.key)),
  }

  return { ...plan, benefits: benefits(plan) }
}

// O assento fica MAIS caro quanto maior o plano, ao contrário do desconto por
// volume que a maioria pratica. É deliberado: com poucos usuários inclusos, o
// preço do plano é a entrada e o assento é onde a operação grande paga pelo
// tamanho dela — que também é a que mais consome suporte humano.
/**
 * O que todo plano entrega, e já está no ar. Ficava invisível: os cartões
 * mostravam 8 itens enquanto o catálogo tinha 17 recursos prontos, o que fazia
 * o produto parecer mais magro do que é. Cada plano acrescenta os itens dele
 * depois destes.
 *
 * O limite de imóveis com foto vem PRIMEIRO: é a única régua de cadastro que o
 * banco aplica, e o cartão compacto da assinatura mostra só os 3 primeiros.
 */
function coreBenefits(plan: Omit<PlanDefinition, "benefits">): PlanBenefit[] {
  return [
    ownedListingsBenefit(plan),
    available("Sem limite para clientes, condomínios e imóveis sem foto"),
    available("Funil de leads em kanban, com propostas em PDF e link para o cliente"),
    available("Imóveis compatíveis com cada cliente: quem se interessa por cada imóvel"),
    available("Agenda, tarefas e controle de chaves"),
    available("Captação com formulário público e Nota do Anúncio"),
    available("Feed XML para ZAP, Viva Real e OLX"),
    landingPageBenefit(plan),
  ]
}

export const PLANS: Record<PlanKey, PlanDefinition> = {
  corretor: definePlan(
    {
      key: "corretor",
      name: "Corretor",
      audience: "Corretor autônomo",
      description:
        "Para o corretor que trabalha sozinho e quer imóveis, clientes e leads organizados num só lugar.",
      prices: { month: 11500, year: 115000 },
      seatPrice: { month: 4900, year: 49000 },
      usersIncluded: 1,
      usersMax: 2,
      limits: {
        landing_pages: 1,
        owned_listings: 5,
        photos_per_listing: 10,
        pipelines: 1,
        // Sem IA no plano de entrada (decisão do dono): a IA é o único custo
        // variável relevante do produto e R$ 115 não a comporta com folga. Zero
        // aqui bloqueia no primeiro corte, no core e no banco (feature_unavailable).
        ai_conversations: 0,
        whatsapp_numbers: 1,
        rental_contracts: 0,
        esign_docs: 5,
        branches: 1,
      },
      support: "Resposta em até 4h úteis",
    },
    (plan) => [
      ...coreBenefits(plan),
      available(`1 usuário, com até 1 extra por ${perMonth(plan.seatPrice.month)}`),
      soon(`${plan.limits.esign_docs} documentos com assinatura eletrônica por mês`),
      available(`Suporte humano com ${plan.support.toLowerCase()}`),
    ]
  ),
  imobiliaria: definePlan(
    {
      key: "imobiliaria",
      name: "Imobiliária",
      audience: "Imobiliária pequena, de 2 a 5 pessoas",
      description:
        "Para a imobiliária que quer a equipe atendendo no mesmo funil e a carteira sempre com a empresa.",
      highlight: true,
      prices: { month: 32000, year: 320000 },
      seatPrice: { month: 5900, year: 59000 },
      usersIncluded: 3,
      usersMax: -1,
      limits: {
        landing_pages: 1,
        owned_listings: 20,
        photos_per_listing: 10,
        pipelines: 3,
        ai_conversations: 50,
        whatsapp_numbers: 1,
        rental_contracts: 20,
        esign_docs: 15,
        branches: 1,
      },
      support: "Resposta em até 1h útil",
    },
    (plan) => [
      ...coreBenefits(plan),
      available(
        `${plan.usersIncluded} usuários incluídos, extra por ${perMonth(plan.seatPrice.month)}`
      ),
      available("Equipe com papéis, convites e histórico de alterações"),
      available("Rodízio de leads com prazo de resposta e redistribuição automática"),
      soon(`${plan.limits.pipelines} funis de leads`),
      soon(`${plan.limits.ai_conversations} conversas de IA no WhatsApp por mês`),
      soon(`${plan.limits.rental_contracts} contratos de locação com boleto e Pix`),
      available(`Suporte humano com ${plan.support.toLowerCase()}`),
    ]
  ),
  equipe: definePlan(
    {
      key: "equipe",
      name: "Equipe",
      audience: "Imobiliária média, de 6 a 15 pessoas",
      description:
        "Para equipes com mais volume de leads, que precisam de vários funis, metas e locação em escala.",
      prices: { month: 77500, year: 775000 },
      seatPrice: { month: 6900, year: 69000 },
      usersIncluded: 5,
      usersMax: -1,
      limits: {
        landing_pages: 1,
        owned_listings: 50,
        photos_per_listing: 10,
        pipelines: 10,
        ai_conversations: 200,
        whatsapp_numbers: 3,
        rental_contracts: 100,
        esign_docs: 40,
        branches: 1,
      },
      support: "Resposta em até 30 min, com onboarding ao vivo",
    },
    (plan) => [
      ...coreBenefits(plan),
      available(
        `${plan.usersIncluded} usuários incluídos, extra por ${perMonth(plan.seatPrice.month)}`
      ),
      available("Equipe com papéis, convites e histórico de alterações"),
      available("Relatórios por corretor, funil, origem dos leads e motivos de perda"),
      soon(`${plan.limits.pipelines} funis de leads e metas por corretor`),
      soon(
        `${plan.limits.ai_conversations} conversas de IA e ${plan.limits.whatsapp_numbers} números de WhatsApp`
      ),
      soon(`${plan.limits.rental_contracts} contratos de locação com repasse e DIMOB`),
      available("Migração assistida com validação lado a lado"),
      available(`Suporte humano com ${plan.support.toLowerCase()}`),
    ]
  ),
  rede: definePlan(
    {
      key: "rede",
      name: "Rede",
      audience: "Imobiliária grande, com várias lojas ou rede, a partir de 16 pessoas",
      description:
        "Para operações com várias lojas ou marcas, que precisam de filiais, API e acompanhamento dedicado.",
      prices: { month: 193000, year: 1930000 },
      seatPrice: { month: 7900, year: 79000 },
      usersIncluded: 10,
      usersMax: -1,
      limits: {
        landing_pages: 1,
        owned_listings: 150,
        photos_per_listing: 10,
        pipelines: -1,
        ai_conversations: 500,
        whatsapp_numbers: 10,
        rental_contracts: 300,
        esign_docs: 100,
        branches: 5,
      },
      support: "Resposta em até 15 min, com gerente de sucesso",
    },
    (plan) => [
      ...coreBenefits(plan),
      available(
        `${plan.usersIncluded} usuários incluídos, extra por ${perMonth(plan.seatPrice.month)}`
      ),
      available("Equipe com papéis, convites e histórico de alterações"),
      soon(`Funis ilimitados e até ${plan.limits.branches} lojas ou imobiliárias`),
      soon(
        `${plan.limits.ai_conversations} conversas de IA e ${plan.limits.whatsapp_numbers} números de WhatsApp`
      ),
      soon(`${plan.limits.rental_contracts} contratos de locação, Lançamentos, API e webhooks`),
      soon("SLA de 99,9% com crédito na fatura"),
      available(`Suporte humano com ${plan.support.toLowerCase()}`),
    ]
  ),
}

/** Limites do teste grátis: os do plano Equipe, sem franquia de IA. */
export const TRIAL_LIMITS: Record<LimitKey, number> = {
  ...PLANS[TRIAL_BASE_PLAN].limits,
  ai_conversations: TRIAL_AI_CONVERSATIONS,
}

// Regras das franquias exibidas em /planos (sem números: estes vêm de PLANS e ADDONS).
/**
 * O limite de fotos é por imóvel próprio, não por GB. Só fica fora do limite o
 * imóvel cujas fotos continuam hospedadas no site de origem (a mídia guarda só o
 * link e não consome nada nosso). A importação de planilhas BAIXA as fotos dos
 * links para o nosso bucket: esses imóveis contam, como os de upload.
 * Imóvel com foto hospedada por nós NUNCA é "ilimitado": tem o limite do plano.
 */
/**
 * Tamanho máximo de cada foto GUARDADA, igual em TODOS os planos — por isso é
 * constante e não uma chave de `limits`. É o mesmo limite do bucket
 * `property-media` no Storage (2 MB, migração storage_savings). Foto maior que
 * isso não é recusada: o navegador otimiza antes de enviar (preset propertyPhoto,
 * alvo de 1,5 MB), e só o arquivo otimizado chega ao Storage.
 */
export const LISTING_PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const LISTING_PHOTO_MAX_MB = LISTING_PHOTO_MAX_BYTES / (1024 * 1024)
export const LISTING_PHOTO_SIZE_NOTE = `Cada foto fica com no máximo ${LISTING_PHOTO_MAX_MB} MB, em qualquer plano: fotos maiores são otimizadas automaticamente ao enviar`

export const IMPORTED_LISTINGS_NOTE =
  "Imóvel com fotos só em link para o site de origem não conta no limite; fotos trazidas por link na importação de planilhas são copiadas para cá e contam"
export const OWNED_LISTINGS_NOTE = `O limite de imóveis do plano vale só para imóveis à venda ou para alugar com fotos hospedadas por nós: imóvel sem foto ou marcado como ${OWNED_LISTING_RELEASED_STATUS_TEXT} não conta`
export const AI_OVERAGE_NOTE = "O excedente de conversas de IA tem sempre um teto definido por você"
/** Primeiro plano com franquia de IA (o Corretor não tem: ai_conversations = 0). */
export const AI_FIRST_PLAN: PlanKey = "imobiliaria"
export const AI_PLAN_NOTE = `O agente de IA no WhatsApp começa no plano ${PLANS[AI_FIRST_PLAN].name}`
/** O teste grátis tem tudo do plano base, menos a IA (TRIAL_AI_CONVERSATIONS = 0). */
export const AI_TRIAL_NOTE = `O teste grátis tem os recursos do plano ${PLANS[TRIAL_BASE_PLAN].name}, menos a IA: a IA começa quando você assina`
/**
 * Decisão do dono em 2026-09-16: nós cobramos só o software. O WhatsApp oficial
 * é contratado pela própria imobiliária na Meta, que fatura o envio direto dela.
 * Isso mantém o nosso custo por mensagem em zero em qualquer volume — e precisa
 * estar escrito na página de preços, senão o cliente descobre na fatura.
 */
/**
 * Regra do dono, 2026-09-16, que vale para o produto inteiro: **toda conta de
 * terceiro que cobra por uso fica no nome do cliente**. WhatsApp na conta Meta
 * da imobiliária, assinatura eletrônica na conta dela, boleto e Pix da locação
 * no adquirente dela (o dinheiro é dela), NFS-e no certificado dela, anúncio no
 * Meta Ads dela. Nós orquestramos e cobramos pelo software.
 *
 * Três consequências, e as três são o motivo da regra:
 *  - nenhum custo por uso do cliente entra na nossa margem;
 *  - não entramos na relação contratual dele com o fornecedor, então o mau uso
 *    de um cliente não nos responsabiliza nem contamina os outros;
 *  - o cliente mantém a conta, o número e o histórico se um dia sair daqui — o
 *    que é argumento de venda, não ressalva.
 */
export const THIRD_PARTY_ACCOUNTS_NOTE =
  "Serviços cobrados por uso (WhatsApp oficial, assinatura eletrônica, boleto e Pix, NFS-e) ficam na conta da própria imobiliária: você paga o fornecedor direto, sem intermediário nosso"

export const WHATSAPP_BILLING_NOTE =
  "O WhatsApp oficial fica na conta da própria imobiliária: quem cobra o envio das mensagens é a Meta, direto de você"
/**
 * No anual de TODOS os planos o boleto é a forma sugerida, e a razão é
 * aritmética: a Stripe cobra 3,99% + R$ 0,39 no cartão e **R$ 3,45 fixos** no
 * boleto (tabela Brasil conferida em 2026-09-16). Como o boleto não é
 * percentual, a economia cresce com o valor da cobrança — de R$ 43/ano no
 * Corretor a R$ 767/ano no Rede, por cliente (com os preços de 17/09/2026).
 *
 * Só no anual: no mensal o boleto obrigaria o cliente a pagar todo mês, o que
 * gera atrito e inadimplência. O cartão continua disponível em tudo.
 *
 * Pix ficou de fora de propósito: conta brasileira da Stripe faz Pix avulso mas
 * **não** faz Pix Automático (recorrente), e mesmo no anual o Pix sai mais caro
 * que o boleto (1,19% contra taxa fixa).
 */
export const ANNUAL_BOLETO_PLANS: readonly PlanKey[] = PLAN_KEYS
export const ANNUAL_BOLETO_NOTE =
  "No plano anual, o boleto é a forma sugerida e sai mais barato para os dois lados; o cartão continua disponível"

// ---------------------------------------------------------------------------
// Adicional "+10 imóveis com foto": pacotes com quantidade na assinatura

/** Chave do adicional em ADDONS, em billing_accounts.addon_keys e no lookup_key. */
export const OWNED_LISTINGS_ADDON_KEY = "owned_listings"
/** Imóveis com foto a mais por pacote. */
export const OWNED_LISTINGS_PACK_SIZE = 10
/**
 * Centavos por pacote, no mesmo intervalo do plano (a Stripe não mistura
 * intervalos numa assinatura). O anual vale 10 mensalidades, como plano e assento.
 */
export const OWNED_LISTINGS_PACK_PRICE: Record<BillingInterval, number> = {
  month: 1900,
  year: 19000,
}
/** Teto de pacotes por assinatura (2.000 imóveis a mais); o banco aceita até 1.000. */
export const MAX_OWNED_LISTING_PACKS = 200

/** Normaliza a quantidade de pacotes: inteiro ≥ 0 (inválido → 0), capado pelo teto. */
export function clampOwnedListingPacks(packs: number): number {
  const requested = Number.isFinite(packs) ? Math.max(0, Math.floor(packs)) : 0
  return Math.min(requested, MAX_OWNED_LISTING_PACKS)
}

export type AddonDefinition = {
  key: string
  name: string
  description: string
  priceLabel: string
  /** "available": contratável na assinatura; "soon": só o preço anunciado. */
  status: FeatureStatus
  plans: PlanKey[]
}

/** Adicionais exibidos em /planos. Os "em breve" não têm compra; o de imóveis já tem. */
export const ADDONS: ReadonlyArray<AddonDefinition> = [
  {
    key: "ai_conversations",
    name: "Conversas de IA extras",
    description: `Mais conversas do agente de IA no WhatsApp quando a franquia do plano acabar. ${AI_OVERAGE_NOTE}.`,
    priceLabel: `+100 por ${perMonth(11900)} · +500 por ${perMonth(49000)} · +2.000 por ${perMonth(199000)}`,
    status: "soon",
    // Sem Corretor: quem não tem franquia de IA não compra excedente de IA — sobe de plano.
    plans: ["imobiliaria", "equipe", "rede"],
  },
  {
    key: "rental",
    name: "Locação por contrato ativo",
    description:
      "Contratos de locação além da franquia do plano. No Corretor, a locação vem só por este adicional.",
    priceLabel: `${formatBRL(190)} por contrato ativo/mês (mínimo de ${perMonth(1900)} no Corretor)`,
    status: "soon",
    plans: ["corretor", "imobiliaria", "equipe", "rede"],
  },
  {
    key: "esign",
    name: "Assinatura eletrônica extra",
    description: "Documentos com assinatura eletrônica além da franquia mensal do plano.",
    priceLabel: `20 documentos por ${perMonth(2900)} · 100 por ${perMonth(14900)}`,
    status: "soon",
    plans: ["corretor", "imobiliaria", "equipe", "rede"],
  },
  {
    key: OWNED_LISTINGS_ADDON_KEY,
    name: "Imóveis próprios extras",
    description: `Mais imóveis à venda ou para alugar com fotos hospedadas por nós, com o mesmo limite de fotos do plano. Contrate quantos pacotes precisar na assinatura; no plano anual, cada pacote custa ${formatBRL(OWNED_LISTINGS_PACK_PRICE.year, { omitZeroCents: true })}/ano. ${IMPORTED_LISTINGS_NOTE}.`,
    priceLabel: `+${OWNED_LISTINGS_PACK_SIZE} imóveis por ${perMonth(OWNED_LISTINGS_PACK_PRICE.month)}`,
    status: "available",
    plans: ["corretor", "imobiliaria", "equipe", "rede"],
  },
  {
    key: "branch",
    name: "Loja ou filial extra",
    description: "Mais uma loja ou imobiliária com subdomínio próprio, além das incluídas no Rede.",
    priceLabel: `${perMonth(19000)} por loja`,
    status: "soon",
    plans: ["rede"],
  },
  {
    key: "launches",
    name: "Lançamentos",
    description: "Espelho de vendas para empreendimentos na planta. Já vem incluso no plano Rede.",
    priceLabel: perMonth(19000),
    status: "soon",
    plans: ["imobiliaria", "equipe"],
  },
]

/** Condições exibidas em /planos e na assinatura (contrato, §9). */
export const PLAN_CONDITIONS: readonly string[] = [
  `${TRIAL_DAYS} dias de teste grátis, sem cartão`,
  "Sem fidelidade e sem taxa de implantação",
  "Migração assistida grátis",
  "Cancelamento no próprio app, com efeito no fim do ciclo pago",
  "Plano anual cancelável a qualquer momento: você perde só o desconto",
  "Garantia de 30 dias no primeiro pagamento",
  "Upgrade na hora, com cobrança proporcional; downgrade no próximo ciclo, sem apagar nada",
  "Reajuste só pelo IPCA, no máximo 1 vez por ano, com 45 dias de aviso",
  "Exportação de leads, imóveis, clientes e propostas em planilha por 90 dias após o cancelamento",
  IMPORTED_LISTINGS_NOTE,
  OWNED_LISTINGS_NOTE,
  LISTING_PHOTO_SIZE_NOTE,
  AI_PLAN_NOTE,
  AI_TRIAL_NOTE,
  AI_OVERAGE_NOTE,
  WHATSAPP_BILLING_NOTE,
  THIRD_PARTY_ACCOUNTS_NOTE,
  ANNUAL_BOLETO_NOTE,
]

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value)
}

export function isBillingPlanKey(value: unknown): value is BillingPlanKey {
  return value === "trial" || isPlanKey(value)
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === "month" || value === "year"
}

// ---------------------------------------------------------------------------
// lookup_key dos Prices na Stripe: plan_{plano}_{monthly|yearly},
// seat_{plano}_{monthly|yearly} e addon_{adicional}_{monthly|yearly}. Assento e
// adicional seguem o intervalo do plano.

const INTERVAL_SUFFIX: Record<BillingInterval, "monthly" | "yearly"> = {
  month: "monthly",
  year: "yearly",
}

const LOOKUP_KEY_PATTERN = /^(plan|seat)_([a-z]+)_(monthly|yearly)$/

export function priceLookupKey(plan: PlanKey, interval: BillingInterval): string {
  return `plan_${plan}_${INTERVAL_SUFFIX[interval]}`
}

export function seatLookupKey(plan: PlanKey, interval: BillingInterval): string {
  return `seat_${plan}_${INTERVAL_SUFFIX[interval]}`
}

/** Adicionais que já têm compra (Price na Stripe). */
export type PurchasableAddonKey = typeof OWNED_LISTINGS_ADDON_KEY

export function addonLookupKey(addon: PurchasableAddonKey, interval: BillingInterval): string {
  return `addon_${addon}_${INTERVAL_SUFFIX[interval]}`
}

const ADDON_LOOKUP_KEY_PATTERN = /^addon_([a-z_]+)_(monthly|yearly)$/

/** Inverso de addonLookupKey; adicional sem compra ou chave fora do padrão → null. */
export function parseAddonLookupKey(
  key: string
): { addon: PurchasableAddonKey; interval: BillingInterval } | null {
  if (typeof key !== "string") {
    return null
  }

  const match = ADDON_LOOKUP_KEY_PATTERN.exec(key)

  if (match?.[1] !== OWNED_LISTINGS_ADDON_KEY) {
    return null
  }

  return { addon: OWNED_LISTINGS_ADDON_KEY, interval: match[2] === "monthly" ? "month" : "year" }
}

/** Inverso de priceLookupKey/seatLookupKey. Qualquer outra chave (inclusive add-ons) → null. */
export function parseLookupKey(
  key: string
): { kind: "plan" | "seat"; plan: PlanKey; interval: BillingInterval } | null {
  if (typeof key !== "string") {
    return null
  }

  const match = LOOKUP_KEY_PATTERN.exec(key)
  const kind = match?.[1]
  const plan = match?.[2]

  if ((kind !== "plan" && kind !== "seat") || !isPlanKey(plan)) {
    return null
  }

  return { kind, plan, interval: match?.[3] === "monthly" ? "month" : "year" }
}

// ---------------------------------------------------------------------------
// Assentos e totais

/** Quantos usuários extras o plano aceita (Infinity quando não há teto). */
export function maxExtraSeats(plan: PlanKey): number {
  const { usersIncluded, usersMax } = PLANS[plan]
  return usersMax < 0 ? Number.POSITIVE_INFINITY : Math.max(0, usersMax - usersIncluded)
}

/** Normaliza a quantidade de extras: inteiro ≥ 0 (valor inválido → 0), capado pelo teto do plano. */
export function clampExtraSeats(plan: PlanKey, extraSeats: number): number {
  const requested = Number.isFinite(extraSeats) ? Math.max(0, Math.floor(extraSeats)) : 0
  return Math.min(requested, maxExtraSeats(plan))
}

/** Total do ciclo em centavos: plano + usuários extras (capados) + pacotes de imóveis. */
export function planTotal(
  plan: PlanKey,
  interval: BillingInterval,
  extraSeats = 0,
  ownedListingPacks = 0
): number {
  const definition = PLANS[plan]
  return (
    definition.prices[interval] +
    clampExtraSeats(plan, extraSeats) * definition.seatPrice[interval] +
    clampOwnedListingPacks(ownedListingPacks) * OWNED_LISTINGS_PACK_PRICE[interval]
  )
}
