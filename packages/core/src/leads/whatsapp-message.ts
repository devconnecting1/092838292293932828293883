/**
 * Mensagem inicial do WhatsApp para o primeiro contato com o lead.
 *
 * Módulo puro: monta o texto pronto (editável na tela) e o link de conversa em
 * um clique. O formato do link segue a Central de Ajuda do WhatsApp
 * (https://faq.whatsapp.com/5913398998672934/): `https://wa.me/<número>?text=<texto>`,
 * com o número completo (DDI + DDD, só dígitos) e o texto codificado para URL.
 * Nada aqui registra telefone em log.
 */

/** Teto do texto: o link fica curto o bastante para qualquer navegador e app. */
export const LEAD_WHATSAPP_MESSAGE_MAX_LENGTH = 1000

export type LeadWhatsappMessageInput = {
  /** Nome do lead como está no CRM; só o primeiro nome entra na saudação. */
  leadName: string | null | undefined
  /** Quem vai conversar (o corretor logado). */
  senderName?: string | null
  /** Imóvel de interesse: código e título, quando o lead veio de um anúncio. */
  property?: { code?: string | null; title?: string | null } | null
}

function cleanLine(value: string | null | undefined, maxLength: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength).trim()
}

/** Primeiro nome, com a inicial maiúscula ("MARIA da silva" → "Maria", "mcKay" → "McKay"). */
export function leadFirstName(name: string | null | undefined) {
  const first = cleanLine(name, 120).split(" ")[0] ?? ""

  if (!first) {
    return ""
  }

  // Tudo em maiúsculas vira nome próprio; o resto mantém a grafia digitada.
  const base = first === first.toLocaleUpperCase("pt-BR") ? first.toLocaleLowerCase("pt-BR") : first

  return base.charAt(0).toLocaleUpperCase("pt-BR") + base.slice(1)
}

/** "Apartamento 2 quartos (código IMV-000123)", só o título ou só o código. */
export function whatsappPropertyLabel(property: LeadWhatsappMessageInput["property"]) {
  const title = cleanLine(property?.title, 120)
  const code = cleanLine(property?.code, 50)

  if (title && code) return `${title} (código ${code})`
  if (title) return title
  if (code) return `de código ${code}`

  return ""
}

/**
 * Texto pronto para o primeiro contato:
 * "Olá, Maria! Aqui é Carlos. Vi seu interesse no imóvel Apartamento 2 quartos
 * (código IMV-000123). Posso te ajudar com mais informações ou agendar uma visita?"
 */
export function buildLeadWhatsappMessage(input: LeadWhatsappMessageInput) {
  const firstName = leadFirstName(input.leadName)
  const sender = cleanLine(input.senderName, 80)
  const property = whatsappPropertyLabel(input.property)

  const greeting = firstName ? `Olá, ${firstName}!` : "Olá!"
  const intro = sender ? ` Aqui é ${sender}.` : ""
  const body = property
    ? ` Vi seu interesse no imóvel ${property}. Posso te ajudar com mais informações ou agendar uma visita?`
    : " Recebi seu contato e quero te ajudar a encontrar o imóvel certo. Podemos conversar?"

  return `${greeting}${intro}${body}`.slice(0, LEAD_WHATSAPP_MESSAGE_MAX_LENGTH)
}

/**
 * Acrescenta o texto ao link wa.me já montado (`https://wa.me/55DDDNUMERO`).
 * Texto vazio devolve o link sem mensagem.
 */
export function withWhatsappText(href: string, text: string | null | undefined) {
  const message = (text ?? "").trim().slice(0, LEAD_WHATSAPP_MESSAGE_MAX_LENGTH)

  if (!message) {
    return href
  }

  return `${href}?text=${encodeURIComponent(message)}`
}

// ---------------------------------------------------------------------------
// Modelos de mensagem da imobiliária (tabela whatsapp_message_templates)
// ---------------------------------------------------------------------------

/** Mesmos limites da tabela (checks e trigger da migração). */
export const WHATSAPP_TEMPLATE_TITLE_MAX_LENGTH = 60
export const WHATSAPP_TEMPLATE_BODY_MAX_LENGTH = LEAD_WHATSAPP_MESSAGE_MAX_LENGTH
export const WHATSAPP_TEMPLATES_MAX = 30

export const WHATSAPP_TEMPLATE_VARIABLES = ["nome", "imovel", "corretor", "link"] as const

export type WhatsappTemplateVariable = (typeof WHATSAPP_TEMPLATE_VARIABLES)[number]

export type WhatsappTemplateValues = Partial<
  Record<WhatsappTemplateVariable, string | null | undefined>
>

/** O que cada variável vira, para a tela de Configurações. */
export const WHATSAPP_TEMPLATE_VARIABLE_HINTS: Record<WhatsappTemplateVariable, string> = {
  nome: "primeiro nome do cliente",
  imovel: "título e código do imóvel",
  corretor: "nome de quem envia",
  link: "link da página pública do imóvel",
}

const TEMPLATE_VARIABLE_PATTERN = /\{\s*(\p{L}+)\s*\}/gu

/** "Imóvel", "IMOVEL" e "imovel" são a mesma variável. */
function normalizeVariableName(name: string) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
}

function isTemplateVariable(name: string): name is WhatsappTemplateVariable {
  return (WHATSAPP_TEMPLATE_VARIABLES as readonly string[]).includes(name)
}

/** Variáveis entre chaves que o modelo usa e que não existem (ex.: "{telefone}"). */
export function findUnknownTemplateVariables(body: string): string[] {
  const unknown = new Set<string>()

  for (const match of body.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
    const name = match[1] ?? ""

    if (!isTemplateVariable(normalizeVariableName(name))) {
      unknown.add(`{${name}}`)
    }
  }

  return [...unknown]
}

/**
 * Troca {nome}, {imovel}, {corretor} e {link} pelos valores do lead ou do
 * imóvel. Variável sem valor sai do texto sem deixar "Olá, !" nem espaço duplo;
 * chave desconhecida fica como está. Resultado limitado ao teto do link.
 */
export function renderWhatsappTemplate(body: string, values: WhatsappTemplateValues) {
  const filled = body.replace(TEMPLATE_VARIABLE_PATTERN, (whole, name: string) => {
    const key = normalizeVariableName(name)

    return isTemplateVariable(key) ? cleanLine(values[key], 300) : whole
  })

  return filled
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+([,.!?;:])/g, "$1")
        .replace(/,([!?.])/g, "$1")
        .trimEnd()
    )
    .join("\n")
    .trim()
    .slice(0, LEAD_WHATSAPP_MESSAGE_MAX_LENGTH)
}
