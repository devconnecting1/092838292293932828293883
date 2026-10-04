/**
 * Registro dos 9 modelos de landing page.
 *
 * A estrutura de cada modelo é fixa. O cliente personaliza somente o que está
 * descrito aqui: campos de conteúdo (`fields`), imagens (`imageSlots`), cores,
 * logo e quais imóveis aparecem (`usesProperties` / `maxProperties`).
 *
 * `fields[].key` usa as chaves de `LandingContent`; os campos do objeto
 * `launch` aparecem com caminho pontuado (`launch.name`). Os limites daqui
 * são os do editor e nunca passam do teto de `LANDING_CONTENT_LIMITS`.
 */
import {
  LANDING_CONTENT_LIMITS,
  LANDING_TEMPLATE_KEYS,
  type LandingTemplateCategory,
  type LandingTemplateKey,
} from "@/lib/landing/types"

export type LandingContentFieldKey =
  | "headline"
  | "subheadline"
  | "cta_label"
  | "description"
  | "highlights"
  | "whatsapp_number"
  | "whatsapp_message"
  | "countdown_until"
  | "testimonials"
  | "social_proof"
  | "units_left"
  | "financing_note"
  | "launch.name"
  | "launch.developer"
  | "launch.delivery_date"
  | "launch.neighborhood"
  | "launch.city"
  | "launch.state"
  | "launch.typologies"

/**
 * Controle sugerido no editor:
 * - text/textarea: string (`maxLength`)
 * - list: string[] (`maxItems` itens de até `maxLength`)
 * - phone: dígitos com DDD
 * - datetime: ISO 8601 (datetime-local convertido para ISO com fuso)
 * - state: UF de 2 letras
 * - number: inteiro entre `min` e `max`
 * - typologies: LandingTypology[] (`maxItems`; nome até `maxLength`)
 * - testimonials: LandingTestimonial[] (`maxItems`; texto até `maxLength`)
 * - stats: LandingSocialProofStat[] (`maxItems`; rótulo até `maxLength`,
 *   valor até `valueMaxLength`)
 */
export type LandingFieldKind =
  | "text"
  | "textarea"
  | "list"
  | "phone"
  | "datetime"
  | "state"
  | "number"
  | "typologies"
  | "testimonials"
  | "stats"

export type LandingTemplateField = {
  key: LandingContentFieldKey
  kind: LandingFieldKind
  label: string
  required: boolean
  maxLength?: number
  /** Só `stats`: limite do valor em destaque ("+120"). */
  valueMaxLength?: number
  maxItems?: number
  /** Só `number`. */
  min?: number
  max?: number
  placeholder?: string
  help?: string
}

export type LandingPropertyUsage = "none" | "single" | "multiple"

export type LandingLeadFormSize = "short" | "full"

export type LandingTemplateDefinition = {
  key: LandingTemplateKey
  name: string
  category: LandingTemplateCategory
  description: string
  bestFor: string
  usesProperties: LandingPropertyUsage
  /** 0 para `none`, 1 para `single`. */
  maxProperties: number
  fields: readonly LandingTemplateField[]
  imageSlots: { background: boolean; banners: number }
  /** Formulário curto (nome + contato) ou completo (com mensagem). Sugestão para o L3. */
  leadFormSize: LandingLeadFormSize
  /** Textos usados quando o cliente deixa o campo vazio. */
  defaults: {
    headline: string
    subheadline: string
    cta_label: string
    formTitle: string
    formDescription: string
  }
}

export const LANDING_TEMPLATE_CATEGORY_LABELS: Record<LandingTemplateCategory, string> = {
  campanhas: "Campanhas",
  lancamentos: "Lançamentos",
  portfolio: "Portfólio",
}

// ---------------------------------------------------------------------------
// Campos reutilizáveis
// ---------------------------------------------------------------------------

const L = LANDING_CONTENT_LIMITS

type FieldOverrides = Partial<Omit<LandingTemplateField, "key" | "kind">>

function field(
  key: LandingContentFieldKey,
  kind: LandingFieldKind,
  base: Omit<LandingTemplateField, "key" | "kind">,
  overrides: FieldOverrides = {}
): LandingTemplateField {
  return { key, kind, ...base, ...overrides }
}

const headline = (o?: FieldOverrides) =>
  field("headline", "text", { label: "Título principal", required: true, maxLength: 80 }, o)

const subheadline = (o?: FieldOverrides) =>
  field("subheadline", "textarea", { label: "Texto de apoio", required: false, maxLength: 180 }, o)

const ctaLabel = (o?: FieldOverrides) =>
  field(
    "cta_label",
    "text",
    {
      label: "Texto do botão",
      required: false,
      maxLength: 28,
      help: "Aparece no botão que leva ao formulário e no envio.",
    },
    o
  )

const description = (o?: FieldOverrides) =>
  field("description", "textarea", { label: "Descrição", required: false, maxLength: 800 }, o)

const highlights = (o?: FieldOverrides) =>
  field(
    "highlights",
    "list",
    { label: "Destaques", required: false, maxItems: 4, maxLength: 70 },
    o
  )

const whatsapp = (o?: FieldOverrides) =>
  field(
    "whatsapp_number",
    "phone",
    {
      label: "WhatsApp para contato",
      required: false,
      placeholder: "(11) 98765-4321",
      help: "Mostra o botão do WhatsApp. Sem número, a página usa só o formulário.",
    },
    o
  )

const whatsappMessage = (o?: FieldOverrides) =>
  field(
    "whatsapp_message",
    "textarea",
    {
      label: "Mensagem inicial do WhatsApp",
      required: false,
      maxLength: 200,
      placeholder: "Olá! Vi a página {pagina} e quero mais informações.",
      help: "Use {codigo} para o código do imóvel em destaque e {pagina} para o nome da página.",
    },
    o
  )

const countdown = (o?: FieldOverrides) =>
  field("countdown_until", "datetime", { label: "Contagem regressiva até", required: false }, o)

const testimonials = (o?: FieldOverrides) =>
  field(
    "testimonials",
    "testimonials",
    {
      label: "Depoimentos de clientes",
      required: false,
      maxItems: 3,
      maxLength: 280,
      help: "Use somente depoimentos reais e autorizados pelos clientes.",
    },
    o
  )

const socialProof = (o?: FieldOverrides) =>
  field(
    "social_proof",
    "stats",
    {
      label: "Números de prova social",
      required: false,
      maxItems: L.social_proof.items,
      maxLength: 40,
      valueMaxLength: 12,
      placeholder: "Imóveis vendidos na região / +120",
      help: "Um número e o que ele significa. Use só dados que a imobiliária consegue comprovar.",
    },
    o
  )

const unitsLeft = (o?: FieldOverrides) =>
  field(
    "units_left",
    "number",
    {
      label: "Unidades disponíveis",
      required: false,
      min: 0,
      max: 9999,
      help: "Mostra “Restam X unidades”. Deixe vazio ou 0 para não exibir.",
    },
    o
  )

const financingNote = (o?: FieldOverrides) =>
  field(
    "financing_note",
    "text",
    {
      label: "Condições de financiamento",
      required: false,
      maxLength: 120,
      placeholder: "Financiamento bancário em até 420 meses",
    },
    o
  )

const launchName = (o?: FieldOverrides) =>
  field(
    "launch.name",
    "text",
    { label: "Nome do empreendimento", required: true, maxLength: 60 },
    o
  )

const launchDeveloper = (o?: FieldOverrides) =>
  field(
    "launch.developer",
    "text",
    { label: "Construtora / incorporadora", required: false, maxLength: 60 },
    o
  )

const launchDelivery = (o?: FieldOverrides) =>
  field(
    "launch.delivery_date",
    "text",
    {
      label: "Previsão de entrega",
      required: false,
      maxLength: L.launch.delivery_date,
      placeholder: "Dezembro de 2027",
    },
    o
  )

const launchNeighborhood = (o?: FieldOverrides) =>
  field("launch.neighborhood", "text", { label: "Bairro", required: false, maxLength: 60 }, o)

const launchCity = (o?: FieldOverrides) =>
  field("launch.city", "text", { label: "Cidade", required: false, maxLength: 60 }, o)

const launchState = (o?: FieldOverrides) =>
  field("launch.state", "state", { label: "UF", required: false, maxLength: 2 }, o)

const typologies = (o?: FieldOverrides) =>
  field(
    "launch.typologies",
    "typologies",
    {
      label: "Tipologias",
      required: false,
      maxItems: 6,
      maxLength: 40,
      help: "Nome da planta, área, quartos e preço inicial.",
    },
    o
  )

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

const DEFINITIONS: Record<LandingTemplateKey, LandingTemplateDefinition> = {
  campaign_spotlight: {
    key: "campaign_spotlight",
    name: "Imóvel em destaque",
    category: "campanhas",
    description:
      "Uma página inteira para um único imóvel: foto em tela cheia, preço, destaques e formulário de visita ao lado.",
    bestFor: "Tráfego pago para um imóvel",
    usesProperties: "single",
    maxProperties: 1,
    fields: [
      headline({ placeholder: "Cobertura com vista para o parque" }),
      subheadline(),
      highlights({
        label: "Três destaques do imóvel",
        maxItems: 3,
        maxLength: 60,
        help: "Sem destaques, a página mostra quartos, área e vagas do imóvel.",
      }),
      financingNote(),
      description({ label: "Sobre o imóvel", maxLength: 600 }),
      socialProof(),
      testimonials(),
      ctaLabel({ placeholder: "Quero visitar" }),
      whatsapp(),
      whatsappMessage({
        placeholder: "Olá! Quero agendar uma visita ao imóvel {codigo}.",
      }),
    ],
    imageSlots: { background: true, banners: 0 },
    leadFormSize: "full",
    defaults: {
      headline: "Agende uma visita a este imóvel",
      subheadline:
        "Fale com um corretor para tirar dúvidas sobre valores, documentação e financiamento.",
      cta_label: "Quero visitar",
      formTitle: "Agende sua visita",
      formDescription: "Deixe seu contato e um corretor combina com você o melhor horário.",
    },
  },

  campaign_offer: {
    key: "campaign_offer",
    name: "Condição especial",
    category: "campanhas",
    description:
      "Destaque uma condição comercial, como entrada facilitada ou desconto, com benefícios, prazo e prova social.",
    bestFor: "Campanhas de oferta com prazo",
    usesProperties: "multiple",
    maxProperties: 6,
    fields: [
      headline({
        label: "Condição especial",
        maxLength: 60,
        placeholder: "Entrada facilitada em até 60 vezes",
      }),
      subheadline(),
      highlights({
        label: "Benefícios da condição",
        maxItems: 5,
        maxLength: 80,
      }),
      financingNote(),
      description({
        label: "Regras da condição",
        maxLength: 400,
        help: "Validade, unidades participantes e demais condições. Aparece em letra menor.",
      }),
      countdown({
        label: "Oferta válida até",
        help: "Opcional. Mostra quanto tempo falta.",
      }),
      socialProof(),
      testimonials(),
      ctaLabel({ placeholder: "Quero a simulação" }),
      whatsapp(),
      whatsappMessage(),
    ],
    imageSlots: { background: false, banners: 1 },
    leadFormSize: "full",
    defaults: {
      headline: "Condição especial por tempo limitado",
      subheadline: "Veja se você se enquadra e receba a simulação com os valores atualizados.",
      cta_label: "Quero a simulação",
      formTitle: "Receba sua simulação",
      formDescription: "Um corretor envia os valores e as condições válidas para o seu perfil.",
    },
  },

  campaign_valuation: {
    key: "campaign_valuation",
    name: "Avaliação gratuita",
    category: "campanhas",
    description:
      "Capte proprietários oferecendo a avaliação do imóvel sem custo, com passo a passo e garantias.",
    bestFor: "Captação de imóveis para venda ou locação",
    usesProperties: "none",
    maxProperties: 0,
    fields: [
      headline({ placeholder: "Descubra quanto vale o seu imóvel" }),
      subheadline(),
      highlights({ label: "Garantias", maxItems: 4, maxLength: 70 }),
      description({ label: "Sobre a imobiliária", maxLength: 500 }),
      socialProof(),
      testimonials({ label: "Depoimentos de proprietários" }),
      ctaLabel({ placeholder: "Quero avaliar meu imóvel" }),
      whatsapp(),
      whatsappMessage({ placeholder: "Olá! Quero avaliar meu imóvel." }),
    ],
    imageSlots: { background: true, banners: 0 },
    leadFormSize: "full",
    defaults: {
      headline: "Descubra quanto vale o seu imóvel",
      subheadline:
        "Avaliação feita por corretor credenciado, com base nos negócios recentes da sua região. Sem custo e sem compromisso.",
      cta_label: "Quero avaliar meu imóvel",
      formTitle: "Peça sua avaliação",
      formDescription: "Conte onde fica o imóvel. Entramos em contato para combinar a visita.",
    },
  },

  launch_showcase: {
    key: "launch_showcase",
    name: "Lançamento completo",
    category: "lancamentos",
    description:
      "Apresente o empreendimento com galeria, tipologias, localização e dados da construtora.",
    bestFor: "Lançamentos com material de marketing pronto",
    usesProperties: "none",
    maxProperties: 0,
    fields: [
      launchName(),
      headline({ placeholder: "Viva a poucos passos do parque" }),
      subheadline(),
      launchDeveloper(),
      launchDelivery(),
      launchNeighborhood(),
      launchCity(),
      launchState(),
      unitsLeft(),
      financingNote(),
      description({ label: "Sobre o empreendimento", maxLength: 800 }),
      highlights({ label: "Diferenciais", maxItems: 6, maxLength: 70 }),
      typologies(),
      ctaLabel({ placeholder: "Quero receber o book" }),
      whatsapp(),
      whatsappMessage({
        placeholder: "Olá! Quero receber o book do lançamento.",
      }),
    ],
    imageSlots: { background: true, banners: 6 },
    leadFormSize: "full",
    defaults: {
      headline: "Conheça o novo lançamento da região",
      subheadline: "Plantas, valores e condições de pagamento direto com quem vende.",
      cta_label: "Quero receber o book",
      formTitle: "Receba o book do empreendimento",
      formDescription: "Plantas, tabela de valores e condições de pagamento no seu contato.",
    },
  },

  launch_waitlist: {
    key: "launch_waitlist",
    name: "Lista VIP",
    category: "lancamentos",
    description:
      "Pré-lançamento com contagem regressiva e formulário curto para quem quer escolher a unidade primeiro.",
    bestFor: "Pré-lançamento e captação de interessados",
    usesProperties: "none",
    maxProperties: 0,
    fields: [
      launchName(),
      headline({ placeholder: "Entre para a lista VIP do lançamento" }),
      subheadline(),
      countdown({
        label: "Abertura das vendas",
        required: true,
        help: "Data e hora em que a contagem termina.",
      }),
      unitsLeft({ label: "Unidades no pré-lançamento" }),
      highlights({
        label: "Vantagens de quem entra primeiro",
        maxItems: 4,
        maxLength: 70,
      }),
      launchNeighborhood(),
      launchCity(),
      launchState(),
      ctaLabel({ placeholder: "Entrar na lista VIP" }),
      whatsapp(),
      whatsappMessage({ placeholder: "Olá! Quero entrar na lista VIP." }),
    ],
    imageSlots: { background: true, banners: 0 },
    leadFormSize: "short",
    defaults: {
      headline: "Entre para a lista VIP do lançamento",
      subheadline:
        "Quem está na lista recebe a tabela antes da abertura das vendas e escolhe a unidade primeiro.",
      cta_label: "Entrar na lista VIP",
      formTitle: "Garanta seu lugar na lista",
      formDescription: "Só nome e contato. Avisamos assim que as vendas abrirem.",
    },
  },

  launch_units: {
    key: "launch_units",
    name: "Tabela de unidades",
    category: "lancamentos",
    description:
      "Compare as tipologias lado a lado por área, quartos e preço inicial e peça a tabela completa em um clique.",
    bestFor: "Lançamentos com várias plantas e faixas de preço",
    usesProperties: "none",
    maxProperties: 0,
    fields: [
      launchName(),
      headline({ placeholder: "Plantas de 2 e 3 quartos com varanda" }),
      subheadline(),
      typologies({ required: true, maxItems: L.launch.typologies.items }),
      unitsLeft(),
      financingNote(),
      launchDeveloper(),
      launchDelivery(),
      launchNeighborhood(),
      launchCity(),
      launchState(),
      highlights({ label: "Diferenciais", maxItems: 4, maxLength: 70 }),
      description({ label: "Observações da tabela", maxLength: 300 }),
      ctaLabel({ placeholder: "Quero a tabela completa" }),
      whatsapp(),
      whatsappMessage({
        placeholder: "Olá! Quero a tabela completa do lançamento.",
      }),
    ],
    imageSlots: { background: false, banners: 1 },
    leadFormSize: "full",
    defaults: {
      headline: "Plantas e valores do empreendimento",
      subheadline: "Compare as opções e peça a tabela completa com a disponibilidade de unidades.",
      cta_label: "Quero a tabela completa",
      formTitle: "Quero a tabela completa",
      formDescription: "Enviamos valores por unidade e andar, com as condições de pagamento.",
    },
  },

  portfolio_grid: {
    key: "portfolio_grid",
    name: "Vitrine de imóveis",
    category: "portfolio",
    description:
      "Uma seleção de imóveis em grade, com foto, preço e características, e formulário para quem não achou o ideal.",
    bestFor: "Anúncios com vários imóveis de um mesmo perfil",
    usesProperties: "multiple",
    // Mesmo limite do banco (landing_pages.property_ids aceita até 12 imóveis).
    maxProperties: 12,
    fields: [
      headline({ placeholder: "Apartamentos de 2 quartos perto do metrô" }),
      subheadline(),
      financingNote(),
      socialProof(),
      testimonials(),
      ctaLabel({ placeholder: "Falar com um corretor" }),
      whatsapp(),
      whatsappMessage(),
    ],
    imageSlots: { background: true, banners: 0 },
    leadFormSize: "full",
    defaults: {
      headline: "Imóveis selecionados para você",
      subheadline: "Valores e características de cada opção. Gostou de algum? Fale com a gente.",
      cta_label: "Falar com um corretor",
      formTitle: "Não achou? Fale com a gente",
      formDescription: "Conte o que você procura e enviamos opções parecidas com o seu perfil.",
    },
  },

  portfolio_agency: {
    key: "portfolio_agency",
    name: "Página da imobiliária",
    category: "portfolio",
    description:
      "Apresente a imobiliária com história, números, imóveis em destaque e depoimentos de clientes.",
    bestFor: "Marca da imobiliária e campanhas institucionais",
    usesProperties: "multiple",
    maxProperties: 9,
    fields: [
      headline({
        placeholder: "Imóveis e atendimento de quem conhece Campinas",
      }),
      subheadline(),
      description({ label: "Sobre a imobiliária", maxLength: 900 }),
      highlights({
        label: "Diferenciais",
        maxItems: 4,
        maxLength: 60,
        placeholder: "Vistoria com fotos em todas as locações",
      }),
      socialProof(),
      testimonials({ maxItems: 6 }),
      ctaLabel({ placeholder: "Fale com a gente" }),
      whatsapp(),
      whatsappMessage(),
    ],
    imageSlots: { background: true, banners: 3 },
    leadFormSize: "full",
    defaults: {
      headline: "Imóveis e atendimento de quem conhece a cidade",
      subheadline:
        "Compra, venda e locação com acompanhamento do primeiro contato à entrega das chaves.",
      cta_label: "Fale com a gente",
      formTitle: "Como podemos ajudar?",
      formDescription:
        "Conte se você quer comprar, vender ou alugar. Um corretor entra em contato.",
    },
  },

  portfolio_broker: {
    key: "portfolio_broker",
    name: "Página do corretor",
    category: "portfolio",
    description:
      "Página pessoal do corretor com foto, CRECI, apresentação, imóveis e contato direto pelo WhatsApp.",
    bestFor: "Corretores divulgando no Instagram e no WhatsApp",
    usesProperties: "multiple",
    maxProperties: 9,
    fields: [
      headline({
        placeholder: "Apartamentos na zona sul com atendimento de perto",
      }),
      subheadline(),
      description({ label: "Apresentação", maxLength: 700 }),
      highlights({ label: "Especialidades", maxItems: 5, maxLength: 60 }),
      socialProof(),
      testimonials({ maxItems: 4 }),
      ctaLabel({ placeholder: "Quero atendimento" }),
      whatsapp({
        help: "Sem número, a página usa o telefone do corretor, se for celular.",
      }),
      whatsappMessage(),
    ],
    imageSlots: { background: false, banners: 0 },
    leadFormSize: "full",
    defaults: {
      headline: "Seu corretor para comprar, vender ou alugar",
      subheadline: "Atendimento próximo, do primeiro contato à assinatura do contrato.",
      cta_label: "Quero atendimento",
      formTitle: "Fale comigo",
      formDescription: "Deixe seu contato e eu retorno pessoalmente.",
    },
  },
}

/** Lista na ordem de exibição da galeria. */
export const LANDING_TEMPLATES: readonly LandingTemplateDefinition[] = LANDING_TEMPLATE_KEYS.map(
  (key) => DEFINITIONS[key]
)

export function getLandingTemplate(key: LandingTemplateKey): LandingTemplateDefinition {
  return DEFINITIONS[key]
}

export function getLandingTemplatesByCategory(
  category: LandingTemplateCategory
): LandingTemplateDefinition[] {
  return LANDING_TEMPLATES.filter((template) => template.category === category)
}
