// Modelos de e-mail transacional do CRM (pt-BR). Funções puras que devolvem
// { subject, html, text }. Todo dado vem de fora (formulário público, banco) e é
// tratado como não confiável: limpo e escapado em layout.ts; links só https (ou
// http em localhost) e caminhos relativos presos à origem recebida.

import { formatBRL } from "../billing/format"
import { REFERRAL_GRACE_DAYS } from "../billing/referrals"
import { APP_ROLE_LABELS, LISTING_PURPOSE_LABELS, PROPERTY_TYPE_LABELS } from "../properties/enums"
import { renderEmail, resolveBrand, type EmailBrand, type RenderedEmail } from "./layout"
import {
  cleanText,
  formatEmailDate,
  formatEmailDateTime,
  isUuid,
  maskPhoneNumber,
  normalizeEmailOrigin,
  resolveEmailLink,
} from "./sanitize"

export type { EmailBrand, RenderedEmail } from "./layout"

/** Origem ou link inválido: o e-mail não deve ser enviado. */
export class EmailTemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EmailTemplateError"
  }
}

export const LEAD_SOURCE_EMAIL_LABELS = {
  landing_page: "Landing page",
  portal: "Portal",
  website: "Site",
  social: "Redes sociais",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  referral: "Indicação",
  manual: "Cadastro manual",
  other: "Outro",
} as const

export const LEAD_INTEREST_EMAIL_LABELS = {
  buy: "Comprar",
  rent: "Alugar",
  invest: "Investir",
  sell: "Vender",
  info: "Informações",
} as const

function labelFrom(labels: Readonly<Record<string, string>>, value: unknown): string | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(labels, value)
    ? (labels[value] ?? null)
    : null
}

/** Origem normalizada para os links; lança EmailTemplateError se inválida. */
export function requireOrigin(origin: unknown) {
  const normalized = normalizeEmailOrigin(origin)

  if (!normalized) {
    throw new EmailTemplateError("Origem inválida para os links do e-mail.")
  }

  return normalized
}

/** Link preso à origem (ou https absoluto); lança EmailTemplateError se inválido. */
export function requireLink(href: unknown, origin: string) {
  const url = resolveEmailLink(href, origin)

  if (!url) {
    throw new EmailTemplateError("Link inválido para o e-mail.")
  }

  return url
}

/** "Olá, Carla!" com o primeiro nome, ou "Olá!". */
export function greetingFor(name: unknown) {
  const firstName = cleanText(name, { maxLength: 40 }).split(" ")[0]
  return firstName ? `Olá, ${firstName}!` : "Olá!"
}

// (a) Novo lead ------------------------------------------------------------------

export type NewLeadEmailParams = {
  /** Origem da imobiliária (subdomínio ou host único), ex.: https://imob.seucrm.com.br */
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  lead: {
    /** leads.id; sem ele o link abre o funil (/leads), onde o lead novo fica no topo. */
    id?: string | null
    name: string
    source?: string | null
    landingPageName?: string | null
    /** Ex.: "IMV-000123 - Apartamento 2 quartos no Centro" */
    propertyLabel?: string | null
    interest?: string | null
    /** Só os 4 últimos dígitos aparecem no e-mail. */
    phone?: string | null
    receivedAt?: Date | string | null
  }
}

export function newLeadEmail(params: NewLeadEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const brand = resolveBrand(params.brand)
  const lead = params.lead
  const leadId = isUuid(lead.id) ? lead.id.toLowerCase() : null
  const url = requireLink(leadId ? `/leads/${leadId}` : "/leads", origin)
  const name = cleanText(lead.name, { maxLength: 120 }) || "Novo contato"
  const source = labelFrom(LEAD_SOURCE_EMAIL_LABELS, lead.source)
  const landingPage = cleanText(lead.landingPageName, { maxLength: 120 })
  const property = cleanText(lead.propertyLabel, { maxLength: 160 })
  const origem = landingPage
    ? ` pela landing page “${landingPage}”`
    : source
      ? ` (origem: ${source})`
      : ""

  return renderEmail(params.brand, {
    subject: `Novo lead: ${cleanText(name, { maxLength: 60 })} — responda agora`,
    preheader:
      "Quem responde primeiro tem mais chance de atender o cliente. Entre em contato agora.",
    heading: "Você recebeu um novo lead",
    greeting: greetingFor(params.recipientName),
    paragraphs: [
      `${name} acabou de pedir contato${origem}${property ? `, com interesse em ${property}` : ""}.`,
    ],
    highlight:
      "Responda nos próximos minutos. Lead sem resposta esfria rápido e costuma procurar outra imobiliária.",
    details: [
      { label: "Nome", value: name },
      { label: "Origem", value: source },
      { label: "Landing page", value: landingPage },
      { label: "Imóvel de interesse", value: property },
      { label: "Interesse", value: labelFrom(LEAD_INTEREST_EMAIL_LABELS, lead.interest) },
      { label: "Telefone", value: maskPhoneNumber(lead.phone) },
      { label: "Recebido em", value: formatEmailDateTime(lead.receivedAt) },
    ],
    action: { label: "Abrir o lead no CRM", url },
    closing: [
      "O telefone aparece parcialmente oculto neste e-mail. Contato completo e histórico ficam no CRM.",
    ],
    footer: `Você recebeu este e-mail porque é responsável por este lead ou faz a gestão da equipe de ${brand.name} no CRM.`,
  })
}

// (b) Rodízio de leads: SLA de primeiro contato ------------------------------------

/**
 * sla_warning, sla_reassigned e sla_lost vão para o corretor; sla_breached vai
 * para a gestão (dono e gerentes): o prazo estourou e o rodízio não tinha outro
 * corretor elegível, então o lead continua com o responsável.
 */
export type LeadSlaNoticeKind = "sla_warning" | "sla_reassigned" | "sla_lost" | "sla_breached"

export const LEAD_SLA_NOTICE_KINDS = [
  "sla_warning",
  "sla_reassigned",
  "sla_lost",
  "sla_breached",
] as const satisfies readonly LeadSlaNoticeKind[]

export type LeadSlaNoticeEmailParams = {
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  kind: LeadSlaNoticeKind
  lead: {
    /** leads.id; sem ele o link abre o funil (/leads). */
    id?: string | null
    name: string
    source?: string | null
    interest?: string | null
    /** Só os 4 últimos dígitos aparecem no e-mail. */
    phone?: string | null
    receivedAt?: Date | string | null
  }
  /** Prazo de primeiro contato em minutos configurado pela imobiliária. */
  slaMinutes: number
  /** Minutos que faltam para estourar (sla_warning) — pode ser 0. */
  minutesLeft?: number | null
  /** Hora limite do primeiro contato. */
  dueAt?: Date | string | null
  /** sla_breached: nome do corretor que continua com o lead (opcional). */
  assigneeName?: string | null
}

/** Um dia: prazo de primeiro contato acima disso é erro de configuração. */
const MAX_SLA_MINUTES = 24 * 60

/**
 * Minutos inteiros dentro da faixa aceita (1 a 1440; com `allowZero`, a partir
 * de 0). Qualquer outra coisa (não numérico, NaN, infinito, negativo ou fora da
 * faixa) vira null: o e-mail usa o texto de reserva em vez de anunciar um prazo
 * sem sentido para o corretor.
 */
function safeMinutes(value: unknown, options: { allowZero?: boolean } = {}): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null
  }

  const minutes = Math.floor(value)
  const min = options.allowZero === true ? 0 : 1

  return minutes >= min && minutes <= MAX_SLA_MINUTES ? minutes : null
}

export function leadSlaNoticeEmail(params: LeadSlaNoticeEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const brand = resolveBrand(params.brand)
  const lead = params.lead
  const leadId = isUuid(lead.id) ? lead.id.toLowerCase() : null
  const leadUrl = requireLink(leadId ? `/leads/${leadId}` : "/leads", origin)
  const name = cleanText(lead.name, { maxLength: 120 }) || "Novo contato"
  const shortName = cleanText(name, { maxLength: 60 })
  const source = labelFrom(LEAD_SOURCE_EMAIL_LABELS, lead.source)
  const interest = labelFrom(LEAD_INTEREST_EMAIL_LABELS, lead.interest)
  const receivedAt = formatEmailDateTime(lead.receivedAt)
  const dueAt = formatEmailDateTime(params.dueAt)
  const slaMinutes = safeMinutes(params.slaMinutes)
  const minutesLeft = safeMinutes(params.minutesLeft, { allowZero: true })
  const sla = slaMinutes === null ? null : `${slaMinutes} min`
  const left =
    minutesLeft === null ? null : minutesLeft > 0 ? `${minutesLeft} min` : "menos de 1 min"
  const deadline = sla
    ? `O prazo de primeiro contato é de ${sla}${dueAt ? `, até ${dueAt}` : ""}.`
    : "Faça o primeiro contato o quanto antes."
  const common = {
    greeting: greetingFor(params.recipientName),
    details: [
      { label: "Nome", value: name },
      { label: "Origem", value: source },
      { label: "Interesse", value: interest },
      { label: "Telefone", value: maskPhoneNumber(lead.phone) },
      { label: "Recebido em", value: receivedAt },
      { label: "Prazo de primeiro contato", value: sla },
      { label: "Responder até", value: dueAt },
    ],
    action: { label: "Abrir o lead no CRM", url: leadUrl },
    closing: [
      "O telefone aparece parcialmente oculto neste e-mail. Contato completo e histórico ficam no CRM.",
    ],
  }

  switch (params.kind) {
    case "sla_warning":
      return renderEmail(params.brand, {
        ...common,
        subject: left
          ? `Faltam ${left} para responder o lead ${shortName}`
          : `O prazo de resposta do lead ${shortName} está acabando`,
        preheader: "Sem o primeiro contato no prazo, o lead passa para o próximo corretor.",
        heading: "O prazo de primeiro contato está acabando",
        paragraphs: [
          `Você é o corretor responsável pelo lead ${name} e o primeiro contato ainda não foi registrado no CRM.`,
          deadline,
        ],
        highlight: left
          ? `Faltam ${left}. Depois disso o lead volta para o rodízio e vai para o próximo corretor.`
          : "Quando o prazo acabar, o lead volta para o rodízio e vai para o próximo corretor.",
        footer: `Você recebeu este e-mail porque é o corretor responsável por este lead na equipe de ${brand.name} no CRM.`,
      })
    case "sla_reassigned":
      return renderEmail(params.brand, {
        ...common,
        subject: sla
          ? `Lead ${shortName} é seu: responda em até ${sla}`
          : `Lead ${shortName} é seu: responda agora`,
        preheader: "O lead entrou no rodízio e agora é seu. Faça o primeiro contato.",
        heading: "Você recebeu um lead do rodízio",
        paragraphs: [
          `O lead ${name} passou a ser seu: o primeiro contato não foi feito dentro do prazo e o rodízio repassou o lead para você.`,
          sla
            ? `Seu prazo de primeiro contato começa agora e é de ${sla}${dueAt ? `, até ${dueAt}` : ""}.`
            : "Faça o primeiro contato o quanto antes.",
        ],
        highlight: "O cliente já pediu contato e está esperando: fale com ele agora.",
        footer: `Você recebeu este e-mail porque passou a ser o corretor responsável por este lead na equipe de ${brand.name} no CRM.`,
      })
    case "sla_lost":
      return renderEmail(params.brand, {
        ...common,
        subject: `O lead ${shortName} foi repassado`,
        preheader: "O prazo de primeiro contato terminou e o lead seguiu no rodízio.",
        heading: "O lead foi repassado",
        paragraphs: [
          `O lead ${name} não teve o primeiro contato dentro do prazo e foi repassado para outro corretor da equipe.`,
          sla
            ? `No rodízio, o lead sem primeiro contato em ${sla}${dueAt ? ` (o prazo terminou em ${dueAt})` : ""} passa para o próximo corretor da fila.`
            : "No rodízio, o lead sem primeiro contato no prazo passa para o próximo corretor da fila.",
          "Os próximos leads da fila continuam chegando para você normalmente.",
        ],
        details: [
          { label: "Nome", value: name },
          { label: "Origem", value: source },
          { label: "Interesse", value: interest },
          { label: "Recebido em", value: receivedAt },
          { label: "Prazo de primeiro contato", value: sla },
          { label: "Prazo terminou em", value: dueAt },
        ],
        action: { label: "Ver meus leads", url: requireLink("/leads", origin) },
        closing: ["Os dados de contato deste lead ficam com quem é responsável por ele agora."],
        footer: `Você recebeu este e-mail porque era o corretor responsável por este lead na equipe de ${brand.name} no CRM.`,
      })
    case "sla_breached": {
      const assignee = cleanText(params.assigneeName, { maxLength: 60 })

      return renderEmail(params.brand, {
        ...common,
        subject: `Lead sem atendimento no prazo: ${shortName}`,
        preheader:
          "O prazo de primeiro contato acabou e não havia outro corretor disponível no rodízio.",
        heading: "Lead sem atendimento no prazo",
        paragraphs: [
          `O lead ${name} passou do prazo de primeiro contato e não havia outro corretor disponível no rodízio. Ele continua com ${assignee || "o corretor responsável"}.`,
          sla
            ? `O prazo de primeiro contato da equipe é de ${sla}${dueAt ? ` e terminou em ${dueAt}` : ""}.`
            : "O prazo de primeiro contato da equipe já terminou.",
        ],
        highlight:
          "Abra o lead para acompanhar e, se precisar, passe o atendimento para outra pessoa.",
        details: [
          { label: "Nome", value: name },
          { label: "Origem", value: source },
          { label: "Interesse", value: interest },
          { label: "Responsável", value: assignee },
          { label: "Recebido em", value: receivedAt },
          { label: "Prazo de primeiro contato", value: sla },
          { label: "Prazo terminou em", value: dueAt },
        ],
        footer: `Você recebeu este e-mail porque faz a gestão da equipe de ${brand.name} (dono ou gerente) no CRM.`,
      })
    }
    default:
      throw new EmailTemplateError("Tipo de aviso de SLA de lead inválido.")
  }
}

// (c) Nova solicitação de captação ------------------------------------------------

export type CaptureRequestEmailParams = {
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  request: {
    propertyType?: string | null
    purpose?: string | null
    neighborhood?: string | null
    city?: string | null
    state?: string | null
    receivedAt?: Date | string | null
  }
}

export function captureRequestEmail(params: CaptureRequestEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const brand = resolveBrand(params.brand)
  const request = params.request
  const url = requireLink("/captacao", origin)
  const type = labelFrom(PROPERTY_TYPE_LABELS, request.propertyType)
  const neighborhood = cleanText(request.neighborhood, { maxLength: 80 })
  const city = cleanText(request.city, { maxLength: 80 })
  const stateRaw = cleanText(request.state, { maxLength: 2 }).toUpperCase()
  const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : ""
  const cityState = city && state ? `${city}/${state}` : city || state
  const location = [neighborhood, cityState].filter(Boolean).join(", ")

  return renderEmail(params.brand, {
    subject: `Nova solicitação de captação: ${type ?? "imóvel"}${location ? ` em ${location}` : ""}`,
    preheader: "Um proprietário quer anunciar com a sua imobiliária. Retorne enquanto ele decide.",
    heading: "Nova solicitação de captação",
    greeting: greetingFor(params.recipientName),
    paragraphs: [
      "Um proprietário pediu, pelo formulário de captação, para anunciar um imóvel com a sua imobiliária.",
    ],
    highlight: "Retorne o contato enquanto o proprietário ainda está escolhendo com quem anunciar.",
    details: [
      { label: "Tipo de imóvel", value: type },
      { label: "Finalidade", value: labelFrom(LISTING_PURPOSE_LABELS, request.purpose) },
      { label: "Bairro", value: neighborhood },
      { label: "Cidade", value: cityState },
      { label: "Recebida em", value: formatEmailDateTime(request.receivedAt) },
    ],
    action: { label: "Ver solicitações de captação", url },
    closing: ["Nome e contato do proprietário ficam só no CRM."],
    footer: `Você recebeu este e-mail porque participa da captação de imóveis (dono, gerente ou captador) da equipe de ${brand.name} no CRM.`,
  })
}

// (d) Convite para a equipe -------------------------------------------------------

export type TeamInvitationEmailParams = {
  origin: string
  brand?: EmailBrand | null
  organizationName: string
  inviterName?: string | null
  role: string
  /** Link do convite (absoluto https, ou caminho relativo à origem). */
  invitationUrl: string
  expiresAt: Date | string
}

export function teamInvitationEmail(params: TeamInvitationEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const url = requireLink(params.invitationUrl, origin)
  const organization = cleanText(params.organizationName, { maxLength: 80 }) || "sua imobiliária"
  const inviter = cleanText(params.inviterName, { maxLength: 60 })
  const role = labelFrom(APP_ROLE_LABELS, params.role)
  const validUntil = formatEmailDateTime(params.expiresAt)
  const brand = { name: organization, primaryColor: params.brand?.primaryColor ?? null }

  return renderEmail(brand, {
    subject: inviter
      ? `${inviter} convidou você para o CRM de ${organization}`
      : `Convite para a equipe de ${organization} no CRM`,
    preheader: validUntil
      ? `Aceite o convite até ${validUntil}.`
      : "Aceite o convite para entrar na equipe.",
    heading: `Convite para a equipe de ${organization}`,
    greeting: "Olá!",
    paragraphs: [
      `${inviter || "A equipe"} convidou você para entrar no CRM de ${organization}${role ? ` com o papel ${role}` : ""}.`,
    ],
    details: [
      { label: "Imobiliária", value: organization },
      { label: "Papel", value: role },
      { label: "Convidado por", value: inviter },
      { label: "Válido até", value: validUntil },
    ],
    action: { label: "Aceitar convite", url },
    closing: [
      "Para aceitar, entre ou crie sua conta com este mesmo e-mail e confirme o endereço. O link é pessoal: não o compartilhe.",
    ],
    footer: `Você recebeu este e-mail porque ${inviter || "alguém da equipe"} convidou este endereço para o CRM de ${organization}. Se não esperava o convite, ignore a mensagem: nenhum acesso é liberado sem a sua confirmação.`,
  })
}

// (e) Aviso de assinatura ---------------------------------------------------------

export type SubscriptionNoticeKind = "trial_ending" | "payment_failed" | "canceled" | "read_only"

export const SUBSCRIPTION_NOTICE_KINDS: readonly SubscriptionNoticeKind[] = [
  "trial_ending",
  "payment_failed",
  "canceled",
  "read_only",
]

export type SubscriptionNoticeEmailParams = {
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  kind: SubscriptionNoticeKind
  organizationName: string
  planName?: string | null
  /**
   * trial_ending: fim do teste; payment_failed: prazo para regularizar;
   * canceled: acesso disponível até; read_only: início do modo somente leitura.
   */
  date?: Date | string | null
}

export function subscriptionNoticeEmail(params: SubscriptionNoticeEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const url = requireLink("/configuracoes/assinatura", origin)
  const organization = cleanText(params.organizationName, { maxLength: 80 }) || "sua imobiliária"
  const plan = cleanText(params.planName, { maxLength: 60 })
  const date = formatEmailDate(params.date)
  const footer = `Você recebeu este e-mail porque é responsável pela assinatura de ${organization} no CRM.`
  const common = {
    greeting: greetingFor(params.recipientName),
    footer,
  }

  switch (params.kind) {
    case "trial_ending":
      return renderEmail(params.brand, {
        ...common,
        subject: date
          ? `O teste gratuito de ${organization} termina em ${date}`
          : `O teste gratuito de ${organization} está acabando`,
        preheader: "Escolha um plano para continuar usando o CRM sem interrupção.",
        heading: "Seu teste gratuito está acabando",
        paragraphs: [
          `O período de teste do CRM para ${organization}${date ? ` termina em ${date}` : " está chegando ao fim"}.`,
          "Para continuar sem interrupção, escolha um plano e cadastre a forma de pagamento.",
        ],
        details: [
          { label: "Imobiliária", value: organization },
          { label: "Plano", value: plan },
          { label: "Fim do teste", value: date },
        ],
        action: { label: "Escolher um plano", url },
      })
    case "payment_failed":
      return renderEmail(params.brand, {
        ...common,
        subject: `Não conseguimos cobrar a assinatura de ${organization}`,
        preheader: "Atualize a forma de pagamento para evitar a suspensão do acesso.",
        heading: "Pagamento não aprovado",
        paragraphs: [
          `Não conseguimos processar o último pagamento da assinatura de ${organization}.`,
          "Atualize a forma de pagamento para evitar a suspensão do acesso da equipe.",
        ],
        highlight: date ? `Regularize até ${date}.` : null,
        details: [
          { label: "Imobiliária", value: organization },
          { label: "Plano", value: plan },
          { label: "Prazo", value: date },
        ],
        action: { label: "Atualizar pagamento", url },
      })
    case "canceled":
      return renderEmail(params.brand, {
        ...common,
        subject: `A assinatura de ${organization} foi cancelada`,
        preheader: "Você pode reativar a assinatura na página de assinatura do CRM.",
        heading: "Assinatura cancelada",
        paragraphs: [
          `A assinatura do CRM para ${organization} foi cancelada${date ? `. O acesso fica disponível até ${date}` : ""}.`,
          "Para voltar a usar o CRM, reative a assinatura quando quiser.",
        ],
        details: [
          { label: "Imobiliária", value: organization },
          { label: "Plano", value: plan },
          { label: "Acesso até", value: date },
        ],
        action: { label: "Ver assinatura", url },
      })
    case "read_only":
      return renderEmail(params.brand, {
        ...common,
        subject: "Sua conta está em modo somente leitura",
        preheader: "Nenhum dado foi apagado. Regularize a assinatura para voltar a criar e editar.",
        heading: "Conta em modo somente leitura",
        paragraphs: [
          `A conta de ${organization} no CRM está em modo somente leitura${date ? ` desde ${date}` : ""}.`,
          "Você ainda pode ver e exportar tudo, e as landing pages e os formulários continuam recebendo leads.",
          "Não é possível criar nem editar registros até regularizar a assinatura.",
        ],
        highlight: "Nenhum dado foi apagado.",
        details: [
          { label: "Imobiliária", value: organization },
          { label: "Plano", value: plan },
          { label: "Somente leitura desde", value: date },
        ],
        action: { label: "Regularizar assinatura", url },
      })
    default:
      throw new EmailTemplateError("Tipo de aviso de assinatura inválido.")
  }
}

// (f) Indique e ganhe --------------------------------------------------------------

export type ReferralNoticeKind = "confirmed" | "lost"

export const REFERRAL_NOTICE_KINDS: readonly ReferralNoticeKind[] = ["confirmed", "lost"]

export type ReferralNoticeEmailParams = {
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  kind: ReferralNoticeKind
  organizationName: string
  /** Nome já mascarado da imobiliária indicada (ex.: "Imobiliária J."). */
  referredName?: string | null
  /** Desconto acumulado depois da mudança (0 a 100). */
  discountPercent: number
  /** A assinatura da indicadora está ativa (senão o desconto fica "a aplicar"). */
  discountApplied: boolean
}

function percentLabel(value: unknown) {
  const percent =
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(100, Math.max(0, Math.floor(value)))
      : 0
  return `${percent}%`
}

export function referralNoticeEmail(params: ReferralNoticeEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const url = requireLink("/configuracoes/indicacoes", origin)
  const organization = cleanText(params.organizationName, { maxLength: 80 }) || "sua imobiliária"
  const referred = cleanText(params.referredName, { maxLength: 60 }) || "Uma imobiliária indicada"
  const discount = percentLabel(params.discountPercent)
  const discountLine = params.discountApplied
    ? `Seu desconto por indicações agora é de ${discount} na mensalidade do plano.`
    : `Seu desconto acumulado agora é de ${discount}; ele passa a valer quando a assinatura de ${organization} estiver ativa.`
  const common = {
    greeting: greetingFor(params.recipientName),
    details: [
      { label: "Imobiliária indicada", value: referred },
      { label: "Desconto acumulado", value: discount },
      { label: "Situação do desconto", value: params.discountApplied ? "Aplicado" : "A aplicar" },
    ],
    action: { label: "Ver minhas indicações", url },
    footer: `Você recebeu este e-mail porque é responsável pela assinatura de ${organization} no CRM e participa do programa Indique e ganhe.`,
  }

  switch (params.kind) {
    case "confirmed":
      return renderEmail(params.brand, {
        ...common,
        subject: `Indicação confirmada: seu desconto agora é de ${discount}`,
        preheader: `Uma imobiliária que você indicou completou ${REFERRAL_GRACE_DAYS} dias de assinatura paga.`,
        heading: "Indicação confirmada",
        paragraphs: [
          `${referred} completou ${REFERRAL_GRACE_DAYS} dias de assinatura paga e passou a contar como indicação ativa.`,
          discountLine,
        ],
        highlight: "Cada indicação ativa soma desconto até a mensalidade sair de graça.",
      })
    case "lost":
      return renderEmail(params.brand, {
        ...common,
        subject: `Uma indicação deixou de contar: seu desconto agora é de ${discount}`,
        preheader: "Uma imobiliária que você indicou não está mais com a assinatura ativa.",
        heading: "Uma indicação deixou de contar",
        paragraphs: [
          `${referred} não está mais com a assinatura ativa, então deixou de contar no seu desconto.`,
          discountLine,
          "Se a assinatura dela voltar a ficar ativa, a indicação volta a contar.",
        ],
      })
    default:
      throw new EmailTemplateError("Tipo de aviso de indicação inválido.")
  }
}

// (g) Franquia de IA ---------------------------------------------------------------

export type AiQuotaNoticeKind = "ai_quota_80" | "ai_quota_100"

export const AI_QUOTA_NOTICE_KINDS: readonly AiQuotaNoticeKind[] = ["ai_quota_80", "ai_quota_100"]

export type AiQuotaNoticeEmailParams = {
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  kind: AiQuotaNoticeKind
  organizationName: string
  /** Unidades consumidas e franquia do ciclo (-1 = ilimitada). */
  conversationsUsed: number
  conversationsLimit: number
  /** Custo do ciclo e teto efetivo (plano + excedente), em centavos. */
  costCents: number
  capCents: number
  /** Teto de excedente ligado pela imobiliária, em centavos (0 = desligado). */
  overageCapCents: number
  /** Quando a franquia vira (fim do ciclo de IA). */
  periodEnd?: Date | string | null
}

function safeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

export function aiQuotaNoticeEmail(params: AiQuotaNoticeEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const url = requireLink("/configuracoes/assinatura", origin)
  const organization = cleanText(params.organizationName, { maxLength: 80 }) || "sua imobiliária"
  const used = safeCount(params.conversationsUsed)
  const limit = params.conversationsLimit
  const usage = limit > 0 ? `${used} de ${limit}` : String(used)
  const renewal = formatEmailDate(params.periodEnd)
  const overageOn = safeCount(params.overageCapCents) > 0
  const common = {
    greeting: greetingFor(params.recipientName),
    details: [
      { label: "Imobiliária", value: organization },
      { label: "Conversas de IA no ciclo", value: usage },
      {
        label: "Custo de IA no ciclo",
        value: `${formatBRL(safeCount(params.costCents))} de ${formatBRL(safeCount(params.capCents))}`,
      },
      { label: "A franquia vira em", value: renewal },
      {
        label: "Excedente",
        value: overageOn
          ? `Liberado até ${formatBRL(safeCount(params.overageCapCents))} por ciclo`
          : "Desligado",
      },
    ],
    action: { label: "Ver uso de IA", url },
    footer: `Você recebeu este e-mail porque é responsável pela assinatura de ${organization} no CRM.`,
  }

  switch (params.kind) {
    case "ai_quota_80":
      return renderEmail(params.brand, {
        ...common,
        subject: `A franquia de IA de ${organization} chegou a 80%`,
        preheader: "Ainda dá tempo de ajustar o teto de excedente antes de a IA parar.",
        heading: "Sua franquia de IA está em 80%",
        paragraphs: [
          `A imobiliária ${organization} já usou 80% da franquia de IA deste ciclo (${usage}).`,
          overageOn
            ? "Quando a franquia acabar, a IA continua até o teto de excedente que você definiu, e depois para."
            : "Quando a franquia acabar, a IA para até o próximo ciclo. Para não parar, defina um teto de excedente em reais na página de assinatura.",
        ],
        highlight: renewal ? `A franquia vira em ${renewal}.` : null,
      })
    case "ai_quota_100":
      return renderEmail(params.brand, {
        ...common,
        subject: `A franquia de IA de ${organization} acabou`,
        preheader: overageOn
          ? "A IA segue no excedente que você autorizou."
          : "A IA fica pausada até o próximo ciclo ou até você liberar um excedente.",
        heading: "A franquia de IA acabou",
        paragraphs: [
          `A imobiliária ${organization} usou toda a franquia de IA deste ciclo (${usage}).`,
          overageOn
            ? `A IA continua funcionando dentro do teto de excedente de ${formatBRL(safeCount(params.overageCapCents))} que você autorizou. Quando esse teto acabar, ela para até o próximo ciclo.`
            : "A IA fica pausada até o próximo ciclo. Para voltar a usar agora, defina um teto de excedente em reais na página de assinatura ou mude de plano.",
          "O restante do CRM continua funcionando normalmente.",
        ],
        highlight: renewal ? `A franquia volta em ${renewal}.` : null,
      })
    default:
      throw new EmailTemplateError("Tipo de aviso de IA inválido.")
  }
}

// (h) Autorização de venda/locação vencendo ----------------------------------------

export type AuthorizationExpiringItem = {
  /** properties.id; sem ele o link abre a lista filtrada. */
  propertyId?: string | null
  code: string
  title: string
  neighborhood?: string | null
  city?: string | null
  /** Último dia coberto pela autorização (AAAA-MM-DD). */
  endsOn: string
  /** Dias de hoje até endsOn (0 = vence hoje). Fora de 0 a 30, o imóvel não entra. */
  daysLeft: number
  exclusive?: boolean | null
}

export type AuthorizationExpiringEmailParams = {
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  /** Dono ou gerente: muda só o motivo no rodapé. */
  isManager?: boolean
  /** Um e-mail por pessoa, com todos os imóveis do dia (economiza a cota diária). */
  items: readonly AuthorizationExpiringItem[]
}

/** Imóveis listados no e-mail; os demais ficam na lista filtrada do CRM. */
export const AUTHORIZATION_EMAIL_MAX_ITEMS = 20

const AUTHORIZATION_EXPIRING_LIST_PATH = "/imoveis?autorizacao=vencendo"

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** "30 de setembro de 2026" para uma data sem hora (sem conversão de fuso). */
function formatDateOnly(value: string): string | null {
  const match = DATE_ONLY_PATTERN.exec(value)

  if (!match) {
    return null
  }

  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))

  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null
  }

  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(date)
}

function deadlineLabel(daysLeft: number) {
  if (daysLeft === 0) return "vence hoje"
  if (daysLeft === 1) return "vence amanhã"
  return `vence em ${daysLeft} dias`
}

type AuthorizationEmailRow = {
  propertyId: string | null
  code: string
  title: string
  place: string
  date: string
  daysLeft: number
  deadline: string
  exclusive: boolean
}

function toAuthorizationRow(item: AuthorizationExpiringItem): AuthorizationEmailRow | null {
  const date = typeof item.endsOn === "string" ? formatDateOnly(item.endsOn) : null
  const daysLeft =
    typeof item.daysLeft === "number" && Number.isFinite(item.daysLeft)
      ? Math.floor(item.daysLeft)
      : -1

  if (!date || daysLeft < 0 || daysLeft > 30) {
    return null
  }

  const code = cleanText(item.code, { maxLength: 30 })
  const title = cleanText(item.title, { maxLength: 120 })

  return {
    propertyId: isUuid(item.propertyId) ? item.propertyId.toLowerCase() : null,
    code: code || "Imóvel",
    title,
    place: [
      cleanText(item.neighborhood, { maxLength: 60 }),
      cleanText(item.city, { maxLength: 60 }),
    ]
      .filter(Boolean)
      .join(", "),
    date,
    daysLeft,
    deadline: deadlineLabel(daysLeft),
    exclusive: item.exclusive === true,
  }
}

export function authorizationExpiringEmail(
  params: AuthorizationExpiringEmailParams
): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const brand = resolveBrand(params.brand)
  const rows = (Array.isArray(params.items) ? params.items : [])
    .map(toAuthorizationRow)
    .filter((row): row is AuthorizationEmailRow => row !== null)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.code.localeCompare(b.code, "pt-BR"))

  const first = rows[0]

  if (!first) {
    throw new EmailTemplateError("Nenhum imóvel válido para o aviso de autorização.")
  }

  const listed = rows.slice(0, AUTHORIZATION_EMAIL_MAX_ITEMS)
  const hidden = rows.length - listed.length
  const single = rows.length === 1
  const why =
    "Sem autorização vigente, o imóvel fica anunciado sem contrato escrito com o proprietário e a sua comissão fica desprotegida."
  const footer = params.isManager
    ? `Você recebeu este e-mail porque faz a gestão da equipe de ${brand.name} (dono ou gerente) no CRM.`
    : `Você recebeu este e-mail porque é captador ou corretor responsável por ${single ? "este imóvel" : "estes imóveis"} em ${brand.name} no CRM.`
  const common = {
    greeting: greetingFor(params.recipientName),
    highlight:
      "Fale com o proprietário para renovar e registre a nova data na aba Autorização do imóvel.",
    footer,
  }

  if (single) {
    const url = requireLink(
      first.propertyId
        ? `/imoveis/${first.propertyId}?aba=autorizacao`
        : AUTHORIZATION_EXPIRING_LIST_PATH,
      origin
    )
    const label = first.title ? `${first.code} (${first.title})` : first.code

    return renderEmail(params.brand, {
      ...common,
      subject: `Autorização do imóvel ${first.code} ${first.deadline}`,
      preheader: `Renove com o proprietário antes de ${first.date} para continuar anunciando.`,
      heading: "Autorização vencendo",
      paragraphs: [
        `A autorização de venda ou locação do imóvel ${label} ${first.deadline}, em ${first.date}.`,
        why,
      ],
      details: [
        { label: "Imóvel", value: first.code },
        { label: "Título", value: first.title },
        { label: "Localização", value: first.place },
        { label: "Vence em", value: first.date },
        { label: "Prazo", value: first.deadline },
        { label: "Exclusividade", value: first.exclusive ? "Sim" : "Não" },
      ],
      action: { label: "Abrir a autorização no CRM", url },
    })
  }

  return renderEmail(params.brand, {
    ...common,
    subject: `${rows.length} autorizações de imóveis vencendo: a primeira ${first.deadline}`,
    preheader: "Renove com os proprietários antes do fim do prazo para continuar anunciando.",
    heading: "Autorizações vencendo",
    paragraphs: [
      `${rows.length} imóveis estão com a autorização de venda ou locação perto do fim.`,
      why,
    ],
    details: listed.map((row) => ({
      label: row.code,
      value: [
        row.title,
        row.place,
        `${row.deadline} (${row.date})`,
        row.exclusive ? "com exclusividade" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    action: {
      label: "Ver imóveis com autorização vencendo",
      url: requireLink(AUTHORIZATION_EXPIRING_LIST_PATH, origin),
    },
    closing:
      hidden > 0
        ? [`E mais ${hidden} ${hidden === 1 ? "imóvel" : "imóveis"} na lista do CRM.`]
        : [],
  })
}
