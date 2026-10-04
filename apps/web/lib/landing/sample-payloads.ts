/**
 * PAYLOADS DE EXEMPLO — dados FICTÍCIOS.
 *
 * Servem só para a galeria de modelos e para a pré-visualização do editor.
 * Nomes, telefones, CRECI, depoimentos e números são inventados e nunca devem
 * ser publicados como dados reais. Sem imagens remotas: os modelos desenham
 * fundos com as cores do tema quando falta imagem.
 *
 * Contagens regressivas usam datas fixas (evita diferença entre servidor e
 * navegador). Se a data passar, o modelo mostra a mensagem de encerramento.
 */
import {
  LANDING_TEMPLATE_KEYS,
  type LandingBroker,
  type LandingContent,
  type LandingLaunch,
  type LandingOrganization,
  type LandingProperty,
  type LandingPublicPayload,
  type LandingSocialProofStat,
  type LandingTemplateKey,
  type LandingTestimonial,
  type LandingTheme,
} from "@/lib/landing/types"

/** Aviso para exibir junto das pré-visualizações com dados de exemplo. */
export const LANDING_SAMPLE_NOTICE = "Exemplo com dados fictícios para visualizar o modelo."

const SAMPLE_WHATSAPP = "19990000000"

const SAMPLE_ORGANIZATION: LandingOrganization = {
  name: "Imobiliária Exemplo",
  city: "Campinas",
  state: "SP",
  phone: "1932000000",
  email: "contato@imobiliaria.exemplo",
  creci: "00000-J",
  brand: {},
}

const SAMPLE_BROKER: LandingBroker = {
  full_name: "Marina Couto",
  creci_number: "000000-F",
  creci_state: "SP",
  avatar_url: null,
  phone: "19990000000",
}

function sampleProperty(
  data: Partial<LandingProperty> & Pick<LandingProperty, "id" | "code" | "title">
): LandingProperty {
  return {
    purpose: "sale",
    type: "apartment",
    sale_price: null,
    rent_price: null,
    condo_fee: null,
    living_area: null,
    lot_area: null,
    bedrooms: null,
    suites: null,
    bathrooms: null,
    parking_spaces: null,
    neighborhood: null,
    city: "Campinas",
    state: "SP",
    features: [],
    cover_path: null,
    media_paths: [],
    ...data,
  }
}

const APARTMENT_CAMBUI = sampleProperty({
  id: "exemplo-imovel-1",
  code: "AP-2041",
  title: "Apartamento de 3 quartos com varanda gourmet no Cambuí",
  sale_price: 1180000,
  condo_fee: 1450,
  living_area: 112,
  bedrooms: 3,
  suites: 1,
  bathrooms: 3,
  parking_spaces: 2,
  neighborhood: "Cambuí",
  features: ["Varanda gourmet", "Piscina", "Academia", "Portaria 24 horas", "Cozinha planejada"],
})

const HOUSE_SWISS_PARK = sampleProperty({
  id: "exemplo-imovel-2",
  code: "CA-1187",
  title: "Casa térrea em condomínio no Swiss Park",
  type: "condo_house",
  sale_price: 2350000,
  condo_fee: 890,
  living_area: 260,
  lot_area: 450,
  bedrooms: 4,
  suites: 3,
  bathrooms: 5,
  parking_spaces: 4,
  neighborhood: "Swiss Park",
  features: ["Área gourmet", "Piscina aquecida", "Energia solar"],
})

const APARTMENT_BARAO = sampleProperty({
  id: "exemplo-imovel-3",
  code: "AP-3310",
  title: "Apartamento de 2 quartos perto da Unicamp",
  purpose: "rent",
  rent_price: 2800,
  condo_fee: 520,
  living_area: 68,
  bedrooms: 2,
  bathrooms: 2,
  parking_spaces: 1,
  neighborhood: "Barão Geraldo",
  features: ["Mobiliado", "Aceita pet"],
})

const PENTHOUSE_TAQUARAL = sampleProperty({
  id: "exemplo-imovel-4",
  code: "CO-2877",
  title: "Cobertura duplex com vista para a Lagoa do Taquaral",
  type: "penthouse",
  purpose: "sale_rent",
  sale_price: 1690000,
  rent_price: 9500,
  condo_fee: 1900,
  living_area: 186,
  bedrooms: 3,
  suites: 3,
  bathrooms: 4,
  parking_spaces: 3,
  neighborhood: "Taquaral",
  features: ["Piscina privativa", "Churrasqueira", "Depósito"],
})

const LAND_SOUSAS = sampleProperty({
  id: "exemplo-imovel-5",
  code: "TE-0452",
  title: "Terreno plano de 1.000 m² em Sousas",
  type: "land",
  sale_price: 640000,
  lot_area: 1000,
  neighborhood: "Sousas",
})

const OFFICE_CENTRO = sampleProperty({
  id: "exemplo-imovel-6",
  code: "SA-0918",
  title: "Sala comercial reformada no Centro",
  type: "commercial_room",
  purpose: "rent",
  rent_price: 3200,
  condo_fee: 610,
  living_area: 54,
  bathrooms: 1,
  parking_spaces: 1,
  neighborhood: "Centro",
})

const ALL_PROPERTIES = [
  APARTMENT_CAMBUI,
  HOUSE_SWISS_PARK,
  APARTMENT_BARAO,
  PENTHOUSE_TAQUARAL,
  LAND_SOUSAS,
  OFFICE_CENTRO,
]

const TESTIMONIALS = {
  seller: {
    name: "Renata S.",
    text: "Vendemos o apartamento em sete semanas. A corretora explicou cada etapa da documentação e esteve com a gente até a assinatura.",
  },
  buyers: {
    name: "Carlos e Júlia M.",
    text: "Encontramos o apartamento certo na terceira visita. O corretor já tinha separado opções com o que a gente pediu.",
  },
  landlord: {
    name: "Paulo R.",
    text: "Aluguei meu imóvel com toda a análise do inquilino feita pela imobiliária. O repasse cai sempre na data combinada.",
  },
} satisfies Record<string, LandingTestimonial>

const AGENCY_STATS: LandingSocialProofStat[] = [
  { stat_value: "+320", stat_label: "imóveis negociados em Campinas" },
  { stat_value: "18 anos", stat_label: "de atuação na região" },
  { stat_value: "42 dias", stat_label: "prazo médio de venda em 2025" },
  { stat_value: "4,9", stat_label: "nota média dos clientes" },
]

const MIRANTE_LAUNCH: LandingLaunch = {
  name: "Mirante do Taquaral",
  developer: "Construtora Exemplo",
  delivery_date: "2028-06",
  neighborhood: "Taquaral",
  city: "Campinas",
  state: "SP",
  typologies: [
    { name: "Studio", area_min: 38, area_max: 42, price_from: 389000 },
    {
      name: "2 quartos com varanda",
      area_min: 62,
      area_max: 68,
      bedrooms: 2,
      price_from: 598000,
    },
    {
      name: "3 quartos com suíte",
      area_min: 84,
      area_max: 91,
      bedrooms: 3,
      price_from: 845000,
    },
    {
      name: "Garden 3 quartos",
      area_min: 118,
      bedrooms: 3,
      price_from: 1120000,
    },
  ],
}

type SampleSpec = {
  name: string
  brand: string
  content: LandingContent
  properties: LandingProperty[]
  broker: LandingBroker | null
}

const SPECS: Record<LandingTemplateKey, SampleSpec> = {
  campaign_spotlight: {
    name: "Apartamento no Cambuí",
    brand: "#0F5C6E",
    properties: [APARTMENT_CAMBUI],
    broker: SAMPLE_BROKER,
    content: {
      headline: "Apartamento de 3 quartos com varanda gourmet no Cambuí",
      subheadline:
        "Andar alto, sol da manhã e duas vagas, em rua arborizada. Agende uma visita com a corretora responsável.",
      highlights: ["Varanda gourmet integrada à sala", "Suíte com closet", "2 vagas cobertas"],
      financing_note: "Aceita financiamento bancário e uso do FGTS",
      description:
        "Apartamento reformado em 2024, com piso vinílico nos quartos, cozinha planejada e aquecimento a gás.\n\nCondomínio com piscina, academia, salão de festas e portaria 24 horas, perto de padarias, farmácias e do Parque Taquaral.",
      social_proof: AGENCY_STATS.slice(0, 2),
      testimonials: [TESTIMONIALS.buyers],
      cta_label: "Quero visitar",
      whatsapp_number: SAMPLE_WHATSAPP,
      whatsapp_message: "Olá! Quero agendar uma visita ao imóvel {codigo}.",
    },
  },

  campaign_offer: {
    name: "Entrada facilitada",
    brand: "#B4232A",
    properties: [APARTMENT_CAMBUI, PENTHOUSE_TAQUARAL, HOUSE_SWISS_PARK],
    broker: null,
    content: {
      headline: "Entrada facilitada em até 60 vezes",
      subheadline:
        "Para imóveis prontos selecionados em Campinas. Receba a simulação com parcelas que cabem no seu orçamento.",
      highlights: [
        "Entrada parcelada direto com o vendedor",
        "Uso do FGTS na entrada",
        "ITBI e registro inclusos na condição",
        "Aprovação de crédito em até 5 dias úteis",
      ],
      financing_note: "Saldo financiado pelo banco em até 420 meses",
      description:
        "Condição válida para propostas assinadas até a data indicada, nos imóveis participantes. Sujeita a análise de crédito. Parcelas da entrada corrigidas pelo IPCA.",
      countdown_until: "2027-03-31T23:59:00-03:00",
      social_proof: AGENCY_STATS.slice(0, 2),
      testimonials: [TESTIMONIALS.buyers, TESTIMONIALS.seller],
      cta_label: "Quero a simulação",
      whatsapp_number: SAMPLE_WHATSAPP,
    },
  },

  campaign_valuation: {
    name: "Avaliação gratuita",
    brand: "#2B4C7E",
    properties: [],
    broker: null,
    content: {
      headline: "Descubra quanto vale o seu imóvel em Campinas",
      subheadline:
        "Um corretor visita o imóvel e apresenta o valor de mercado com base nas vendas recentes do seu bairro. Sem custo e sem compromisso.",
      highlights: [
        "Avaliação sem custo",
        "Sem compromisso de exclusividade",
        "Relatório com imóveis comparáveis do bairro",
        "Seus dados não são compartilhados",
      ],
      description:
        "A Imobiliária Exemplo atende Campinas e região desde 2008, com equipe própria de corretores, fotografia profissional e assessoria jurídica para venda e locação.",
      social_proof: AGENCY_STATS.slice(0, 3),
      testimonials: [TESTIMONIALS.seller, TESTIMONIALS.landlord],
      cta_label: "Quero avaliar meu imóvel",
      whatsapp_number: SAMPLE_WHATSAPP,
    },
  },

  launch_showcase: {
    name: "Lançamento Mirante do Taquaral",
    brand: "#6B4E2E",
    properties: [],
    broker: null,
    content: {
      launch: MIRANTE_LAUNCH,
      headline: "Apartamentos de 1 a 3 quartos a 400 metros da Lagoa do Taquaral",
      subheadline:
        "Lazer completo no rooftop, varanda em todas as unidades e vagas com ponto para carro elétrico.",
      units_left: 18,
      financing_note: "Entrada parcelada em até 36 meses durante a obra",
      description:
        "Torre única com 22 andares e quatro apartamentos por andar. Fachada ventilada, janelas amplas e plantas flexíveis para quem trabalha em casa.\n\nNo rooftop: piscina com raia de 25 metros, academia, coworking e espaço gourmet com vista para a lagoa.",
      highlights: [
        "Rooftop com piscina de 25 metros",
        "Varanda em todas as unidades",
        "Ponto de recarga para carro elétrico",
        "Coworking e bicicletário",
        "Fechadura digital nas unidades",
      ],
      cta_label: "Quero receber o book",
      whatsapp_number: SAMPLE_WHATSAPP,
      whatsapp_message: "Olá! Quero receber o book do Mirante do Taquaral.",
    },
  },

  launch_waitlist: {
    name: "Lista VIP Vila Aurora",
    brand: "#2E2A5A",
    properties: [],
    broker: null,
    content: {
      launch: {
        name: "Vila Aurora Cambuí",
        neighborhood: "Cambuí",
        city: "Campinas",
        state: "SP",
      },
      headline: "Pré-lançamento no Cambuí: escolha sua unidade antes de todo mundo",
      subheadline:
        "Studios e apartamentos de 2 quartos perto da Avenida Júlio de Mesquita. Quem está na lista recebe a tabela antes da abertura.",
      countdown_until: "2027-04-24T10:00:00-03:00",
      units_left: 64,
      highlights: [
        "Tabela de pré-lançamento com os menores valores",
        "Escolha da unidade antes da abertura",
        "Convite para o evento de lançamento",
        "Atendimento com corretor dedicado",
      ],
      cta_label: "Entrar na lista VIP",
      whatsapp_number: SAMPLE_WHATSAPP,
    },
  },

  launch_units: {
    name: "Tabela Mirante do Taquaral",
    brand: "#1F6B4F",
    properties: [],
    broker: null,
    content: {
      launch: MIRANTE_LAUNCH,
      headline: "Plantas de 38 a 118 m², todas com varanda",
      subheadline:
        "Compare as tipologias lado a lado e peça a tabela completa com valores por andar e disponibilidade.",
      units_left: 18,
      financing_note: "Financiamento na planta pelos principais bancos",
      highlights: [
        "Rooftop com piscina de 25 metros",
        "Varanda em todas as unidades",
        "Vagas com ponto para carro elétrico",
        "Entrega prevista para junho de 2028",
      ],
      description:
        "Valores de referência para pagamento à vista, sujeitos a alteração. A tabela completa, com valores por andar e posição solar, é enviada pelo corretor.",
      cta_label: "Quero a tabela completa",
      whatsapp_number: SAMPLE_WHATSAPP,
    },
  },

  portfolio_grid: {
    name: "Vitrine Campinas",
    brand: "#0B63A5",
    properties: ALL_PROPERTIES,
    broker: null,
    content: {
      headline: "Imóveis selecionados em Campinas para morar ou investir",
      subheadline:
        "Valores e características de cada opção, atualizados pela nossa equipe. Gostou de algum? Fale com um corretor.",
      financing_note: "Imóveis à venda aceitam financiamento bancário",
      social_proof: AGENCY_STATS.slice(0, 2),
      testimonials: [TESTIMONIALS.buyers],
      cta_label: "Falar com um corretor",
      whatsapp_number: SAMPLE_WHATSAPP,
    },
  },

  portfolio_agency: {
    name: "Institucional",
    brand: "#3D5A40",
    properties: [APARTMENT_CAMBUI, HOUSE_SWISS_PARK, PENTHOUSE_TAQUARAL],
    broker: null,
    content: {
      headline: "Imóveis e atendimento de quem conhece Campinas",
      subheadline:
        "Compra, venda e locação com acompanhamento do primeiro contato à entrega das chaves.",
      description:
        "A Imobiliária Exemplo nasceu em 2008 no Cambuí e hoje atende toda a região de Campinas com corretores especialistas por bairro.\n\nCuidamos de todo o processo: fotos e anúncio do imóvel, visitas, análise de documentos, contrato e vistoria.",
      highlights: [
        "Vistoria com fotos em todas as locações",
        "Assessoria jurídica própria",
        "Corretores especialistas por bairro",
        "Fotografia profissional sem custo para o proprietário",
      ],
      social_proof: AGENCY_STATS,
      testimonials: [TESTIMONIALS.seller, TESTIMONIALS.buyers, TESTIMONIALS.landlord],
      cta_label: "Fale com a gente",
      whatsapp_number: SAMPLE_WHATSAPP,
    },
  },

  portfolio_broker: {
    name: "Marina Couto",
    brand: "#8A2F5A",
    properties: [APARTMENT_CAMBUI, PENTHOUSE_TAQUARAL, APARTMENT_BARAO],
    broker: SAMPLE_BROKER,
    content: {
      headline: "Apartamentos no Cambuí e no Taquaral com atendimento de perto",
      subheadline:
        "Ajudo você a encontrar, visitar e negociar o imóvel certo, com toda a documentação conferida.",
      description:
        "Sou corretora há 12 anos e atendo principalmente famílias que procuram apartamento no Cambuí, no Taquaral e no Guanabara.\n\nAcompanho cada etapa: visitas, proposta, análise de documentos e assinatura do contrato.",
      highlights: [
        "Cambuí e Taquaral",
        "Primeiro imóvel",
        "Financiamento bancário",
        "Locação residencial",
      ],
      social_proof: [
        { stat_value: "12 anos", stat_label: "como corretora em Campinas" },
        { stat_value: "+150", stat_label: "famílias atendidas" },
      ],
      testimonials: [TESTIMONIALS.buyers, TESTIMONIALS.seller],
      cta_label: "Quero atendimento",
    },
  },
}

const EMPTY_THEME: LandingTheme = {
  background_image_path: null,
  banner_image_paths: [],
  logo_path: null,
}

function buildSample(key: LandingTemplateKey): LandingPublicPayload {
  const spec = SPECS[key]
  const slug = `exemplo-${key.replace(/_/g, "-")}`

  return {
    page: {
      id: slug,
      template: key,
      slug,
      name: `Exemplo: ${spec.name}`,
      theme: { ...EMPTY_THEME, primary_color: spec.brand },
      content: spec.content,
      tracking: {},
      seo: {
        title: `${spec.name} | Imobiliária Exemplo`,
        description: spec.content.subheadline,
      },
      published_at: null,
    },
    organization: {
      ...SAMPLE_ORGANIZATION,
      brand: { primary_color: spec.brand },
    },
    properties: spec.properties,
    broker: spec.broker,
  }
}

/** Um payload de exemplo por modelo (galeria de modelos). */
export const LANDING_SAMPLE_PAYLOADS = Object.fromEntries(
  LANDING_TEMPLATE_KEYS.map((key) => [key, buildSample(key)])
) as Record<LandingTemplateKey, LandingPublicPayload>

export function getLandingSamplePayload(key: LandingTemplateKey): LandingPublicPayload {
  return LANDING_SAMPLE_PAYLOADS[key]
}

export type LandingPreviewOverrides = {
  name?: string
  theme?: LandingTheme
  content?: LandingContent
  organization?: LandingOrganization
  properties?: LandingProperty[]
  broker?: LandingBroker | null
}

/**
 * Payload da pré-visualização do editor: parte do exemplo do modelo e troca
 * POR INTEIRO cada parte informada (o conteúdo do cliente não se mistura com
 * o texto de exemplo; campos vazios usam os textos padrão do modelo).
 */
export function buildLandingPreviewPayload(
  key: LandingTemplateKey,
  overrides: LandingPreviewOverrides = {}
): LandingPublicPayload {
  const sample = LANDING_SAMPLE_PAYLOADS[key]

  return {
    page: {
      ...sample.page,
      name: overrides.name ?? sample.page.name,
      theme: overrides.theme ?? sample.page.theme,
      content: overrides.content ?? sample.page.content,
    },
    organization: overrides.organization ?? sample.organization,
    properties: overrides.properties ?? sample.properties,
    broker: overrides.broker === undefined ? sample.broker : overrides.broker,
  }
}
