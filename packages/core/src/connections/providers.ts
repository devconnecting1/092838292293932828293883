// Catálogo de "Contas conectadas": os serviços de terceiros em que a imobiliária
// conecta a CONTA DELA.
//
// Regra do dono (não negociável): nós cobramos só o software. A conta é do
// cliente, o fornecedor fatura o cliente, e nós nunca entramos no meio do custo.
// Por isso toda definição aqui carrega `billing.payer` e o texto que a tela
// mostra — a cobrança direta com o fornecedor precisa estar escrita na tela, não
// escondida num tooltip.
//
// Este arquivo é puro (sem I/O). O espelho no banco é o enum
// `public.connection_provider` da migração `connections_foundation`; ao incluir
// um provedor aqui, inclua o valor no enum e vice-versa.

/**
 * Provedores previstos. Só `whatsapp` está implementado; os demais existem para
 * que o enum do banco não precise mudar a cada integração nova (ALTER TYPE ...
 * ADD VALUE não roda dentro de transação em todos os cenários).
 */
export const CONNECTION_PROVIDER_KEYS = [
  "whatsapp",
  "instagram",
  "facebook_page",
  "facebook_lead_ads",
  "email_forwarding",
  "telegram",
] as const

export type ConnectionProviderKey = (typeof CONNECTION_PROVIDER_KEYS)[number]

export function isConnectionProviderKey(value: unknown): value is ConnectionProviderKey {
  return (
    typeof value === "string" &&
    (CONNECTION_PROVIDER_KEYS as readonly string[]).includes(value as ConnectionProviderKey)
  )
}

/** Mesma convenção do catálogo de planos: "available" está pronto, "soon" não se vende. */
export type ConnectionProviderStatus = "available" | "soon"

/**
 * Quem paga o fornecedor.
 * - `client_direct`: o fornecedor fatura a imobiliária direto. É o único modo
 *   permitido para serviço com custo por uso (WhatsApp).
 * - `free`: o fornecedor não cobra nada nesse uso.
 * - `included`: está embutido na nossa mensalidade (só para custo fixo e nosso).
 */
export type ConnectionCostPayer = "client_direct" | "free" | "included"

export type ConnectionPriceItem = {
  label: string
  /**
   * Preço em MILÉSIMOS DE CENTAVO de real (mesma unidade de `cost_millicents`
   * da medição de IA). R$ 0,0350 = 3.500. `null` = sem preço fixo publicado.
   */
  millicentsBRL: number | null
  unit: string
  note?: string
}

export type ConnectionProviderTerms = {
  /** Chave estável gravada em `connection_terms_acceptances.terms_key`. */
  key: string
  /** Versão do texto. Mudou uma vírgula do texto? muda a versão e pede aceite de novo. */
  version: string
  label: string
  url: string
  /**
   * O texto EXATO exibido ao responsável no momento do aceite. É esta string
   * que vai para a prova (`displayed_text` + sha-256) — não a URL, que pode
   * mudar de conteúdo sem avisar.
   */
  text: string
}

export type ConnectionProviderDefinition = {
  key: ConnectionProviderKey
  label: string
  /** Empresa dona do serviço, como aparece na fatura do cliente. */
  vendor: string
  summary: string
  status: ConnectionProviderStatus
  billing: {
    payer: ConnectionCostPayer
    /** Frase de uma linha, exibida em destaque no cartão do provedor. */
    headline: string
    /** Quem emite a fatura para o cliente. `null` quando não há fatura. */
    invoicedBy: string | null
    items: readonly ConnectionPriceItem[]
    notes: readonly string[]
  }
  /** Termos do fornecedor que o cliente precisa aceitar ANTES de conectar. */
  terms: ConnectionProviderTerms | null
  /** Quantas contas do mesmo provedor uma imobiliária pode conectar. */
  maxAccounts: number
  helpUrl: string | null
}

/**
 * Termos da Meta para o WhatsApp Business, aceitos pela imobiliária.
 *
 * Por que o aceite é obrigatório e precisa de prova: os "Meta Business
 * Messaging and Meta Business Agent Technology Provider Terms" (atualizados em
 * 31/07/2026, facebook.com/legal/BM-tech-provider-terms), §2.1 "Onboarding
 * Customers", dizem que a empresa provedora "will not allow any Customer to
 * access or use the Applicable Platform(s) ... until and unless such Customer
 * has accepted the WhatsApp Business Platform Terms" — e a mesma seção torna
 * provedor e cliente solidariamente responsáveis pela conduta do cliente.
 *
 * A Meta também apresenta os termos dela dentro do popup do Embedded Signup,
 * mas NÃO expõe nenhum endpoint para consultar esse aceite depois. Por isso a
 * evidência que conseguimos auditar é a nossa: o texto exibido, a versão, quem
 * aceitou, quando e de onde — mais os identificadores da sessão de signup que
 * a Meta devolve. Guardar um booleano não serve.
 */
export const META_WHATSAPP_TERMS: ConnectionProviderTerms = {
  key: "meta_whatsapp_business_terms",
  version: "2026-09-16",
  label: "Termos da Meta para o WhatsApp Business",
  url: "https://www.whatsapp.com/legal/meta-terms-whatsapp-business",
  text: [
    "Declaro que sou responsável por esta imobiliária e que:",
    "1. A conta do WhatsApp Business (WABA) e o portfólio empresarial criados neste processo pertencem à imobiliária, e não à plataforma.",
    "2. Li e aceito os Termos da Meta para o WhatsApp Business (https://www.whatsapp.com/legal/meta-terms-whatsapp-business) e as Políticas de Mensagens e de Comércio do WhatsApp, que também são apresentados pela Meta durante a conexão.",
    "3. A Meta cobra o envio de mensagens diretamente da imobiliária, no meio de pagamento cadastrado na conta da Meta. A plataforma cobra apenas o software e não revende, subsidia nem intermedeia essas mensagens.",
    "4. Só enviarei mensagens a pessoas que me forneceram o número e autorizaram o contato, e honrarei imediatamente qualquer pedido de descadastramento.",
    "5. Autorizo a plataforma a enviar e receber mensagens em nome da imobiliária, nesta conta, enquanto a conexão estiver ativa.",
  ].join("\n"),
}

/**
 * Preços da Meta para o Brasil (código 55), rate card em BRL vigente desde
 * 01/07/2026, faturado pela Facebook Brasil. Conferidos em 16/09/2026.
 *
 * Estão aqui para APARECER NA TELA do cliente — não para nos cobrar nada:
 * nenhuma linha do produto debita esses valores de nós.
 */
export const META_WHATSAPP_PRICING_CHECKED_AT = "2026-09-16"

export const META_WHATSAPP_PRICE_MILLICENTS_BRL = {
  /** Mensagem de atendimento (janela de 24 h). Passa a ser cobrada em 01/10/2026. */
  service: 3_500,
  /** Aviso transacional fora da janela (template de utilidade). */
  utility: 3_500,
  /** Divulgação (template de marketing). */
  marketing: 32_170,
  authentication: 3_500,
} as const

/** Mensagens de serviço gratuitas por número por mês, concedidas pela Meta. */
export const META_WHATSAPP_FREE_SERVICE_MESSAGES = 1_000

const WHATSAPP: ConnectionProviderDefinition = {
  key: "whatsapp",
  label: "WhatsApp Business (oficial)",
  vendor: "Meta",
  // O que está pronto é CONECTAR a conta (Embedded Signup, termos e número). A
  // caixa para atender pelo CRM ainda não existe: nenhuma tela chama
  // sendWhatsappMessage. Por isso o status é "available" (a conexão funciona) e o
  // texto não promete atendimento — ver feature_whatsapp_official_inbox, "soon".
  summary:
    "Conecte o número oficial, na conta da própria imobiliária na Meta, e deixe o canal pronto. A caixa de conversas para a equipe atender pelo CRM ainda está em construção.",
  status: "available",
  billing: {
    payer: "client_direct",
    headline: "A Meta cobra a imobiliária direto. A plataforma não cobra nada por mensagem.",
    invoicedBy: "Facebook Serviços Online do Brasil Ltda. (fatura em reais)",
    items: [
      {
        label: "Resposta dentro da janela de 24 h",
        millicentsBRL: META_WHATSAPP_PRICE_MILLICENTS_BRL.service,
        unit: "por mensagem",
        note: "As primeiras 1.000 por número, a cada mês, são gratuitas. Cobrança a partir de 01/10/2026.",
      },
      {
        label: "Aviso fora da janela (modelo de utilidade)",
        millicentsBRL: META_WHATSAPP_PRICE_MILLICENTS_BRL.utility,
        unit: "por mensagem entregue",
      },
      {
        label: "Divulgação (modelo de marketing)",
        millicentsBRL: META_WHATSAPP_PRICE_MILLICENTS_BRL.marketing,
        unit: "por mensagem entregue",
      },
      {
        label: "Mensagem recebida do cliente",
        millicentsBRL: 0,
        unit: "sempre gratuita",
      },
    ],
    notes: [
      "O meio de pagamento fica na conta da imobiliária na Meta. A plataforma não tem acesso a ele e não consegue gastar em nome da imobiliária.",
      "A Meta não oferece teto de gasto configurável por conta de WhatsApp: quem controla o volume é a imobiliária.",
      "Preços conferidos em 16/09/2026 e informados como referência. O valor que vale é o da fatura da Meta.",
    ],
  },
  terms: META_WHATSAPP_TERMS,
  // Um portfólio e uma WABA por imobiliária: é o que impede que um cliente
  // disparando lista comprada derrube o canal de todos os outros.
  maxAccounts: 1,
  helpUrl: "https://business.whatsapp.com/products/business-platform",
}

function planned(
  key: ConnectionProviderKey,
  label: string,
  vendor: string,
  summary: string
): ConnectionProviderDefinition {
  return {
    key,
    label,
    vendor,
    summary,
    status: "soon",
    billing: {
      payer: "free",
      headline: "Conta da imobiliária. Quando houver custo, a cobrança é direta com o fornecedor.",
      invoicedBy: null,
      items: [],
      notes: [],
    },
    terms: null,
    maxAccounts: 1,
    helpUrl: null,
  }
}

export const CONNECTION_PROVIDERS: Record<ConnectionProviderKey, ConnectionProviderDefinition> = {
  whatsapp: WHATSAPP,
  instagram: planned(
    "instagram",
    "Instagram",
    "Meta",
    "Responder direct e comentários do perfil da imobiliária dentro do CRM."
  ),
  facebook_page: planned(
    "facebook_page",
    "Página do Facebook",
    "Meta",
    "Publicar imóveis e responder mensagens da página da imobiliária."
  ),
  // Os leads de formulário já entram por Configurações > Integrações (ID e token
  // da Página). O que está "em breve" aqui é conectar pelo login da Meta.
  facebook_lead_ads: planned(
    "facebook_lead_ads",
    "Lead Ads (Meta)",
    "Meta",
    "Os leads dos formulários de anúncio já entram no funil pela tela Integrações, com o ID e o token da Página. Conectar por aqui, com o login da Meta, chega em breve."
  ),
  email_forwarding: planned(
    "email_forwarding",
    "Documentos por e-mail",
    "Cloudflare",
    "Encaminhar e-mails com anexos para uma caixa de documentos da imobiliária."
  ),
  telegram: planned(
    "telegram",
    "Telegram",
    "Telegram",
    "Avisos internos da equipe (novo lead, prazo estourando) num grupo do Telegram."
  ),
}

/** Ordem de exibição na tela de Conexões: o que está pronto primeiro. */
export const CONNECTION_PROVIDER_ORDER: readonly ConnectionProviderKey[] = [
  "whatsapp",
  "instagram",
  "facebook_page",
  "facebook_lead_ads",
  "email_forwarding",
  "telegram",
]

export function connectionProvider(key: ConnectionProviderKey): ConnectionProviderDefinition {
  return CONNECTION_PROVIDERS[key]
}

/**
 * Milésimos de centavo → texto em reais com as casas necessárias.
 * R$ 0,0350 não cabe em duas casas: formatBRL (que trabalha em centavos
 * inteiros) mostraria "R$ 0,04" e a tela mentiria o preço do fornecedor.
 */
export function formatProviderPrice(millicentsBRL: number | null): string {
  if (millicentsBRL === null || !Number.isFinite(millicentsBRL)) {
    return "—"
  }

  if (millicentsBRL === 0) {
    return "R$ 0,00"
  }

  const reais = millicentsBRL / 100_000
  // Duas casas quando o valor é redondo em centavos; quatro quando não é.
  const fractionDigits = millicentsBRL % 1_000 === 0 ? 2 : 4

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
    .format(reais)
    .replace(/\s/g, " ")
}
