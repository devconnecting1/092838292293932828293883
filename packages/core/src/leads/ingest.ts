/**
 * Entrada de leads das origens externas: portais do Grupo OLX (Canal Pro:
 * ZAP Imóveis, Viva Real e OLX) e formulários de anúncio da Meta (Facebook e
 * Instagram).
 *
 * Módulo puro: sem banco, sem rede e sem `Date.now()` — quem chama informa o
 * instante. Todo payload que chega aqui é DADO HOSTIL: nada é lido sem
 * conferir o tipo, tudo é aparado e cortado no limite que o banco aceita, e o
 * que não passa vira uma recusa com motivo estável (e não uma exceção).
 *
 * As regras de normalização são as mesmas da RPC `ingest_external_lead`
 * (migração `external_lead_ingest`); este arquivo é a referência legível e
 * testável delas. A gravação de verdade acontece no banco, numa transação.
 */

// -----------------------------------------------------------------------------
// Origens e provedores
// -----------------------------------------------------------------------------

/** Provedor = quem entrega o lead (uma integração por imobiliária). */
export const LEAD_INGEST_PROVIDERS = ["canal_pro", "meta_lead_ads"] as const

export type LeadIngestProvider = (typeof LEAD_INGEST_PROVIDERS)[number]

export const LEAD_INGEST_PROVIDER_LABELS: Record<LeadIngestProvider, string> = {
  canal_pro: "Canal Pro (ZAP, Viva Real e OLX)",
  meta_lead_ads: "Meta Lead Ads (Facebook e Instagram)",
}

export function isLeadIngestProvider(value: unknown): value is LeadIngestProvider {
  return typeof value === "string" && (LEAD_INGEST_PROVIDERS as readonly string[]).includes(value)
}

/** Origem = o site em que a pessoa preencheu (um provedor entrega várias). */
export const LEAD_INGEST_ORIGINS = [
  "zapimoveis",
  "vivareal",
  "olx",
  "canalpro",
  "facebook",
  "instagram",
  "outra",
] as const

export type LeadIngestOrigin = (typeof LEAD_INGEST_ORIGINS)[number]

export const LEAD_INGEST_ORIGIN_LABELS: Record<LeadIngestOrigin, string> = {
  zapimoveis: "ZAP Imóveis",
  vivareal: "Viva Real",
  olx: "OLX",
  canalpro: "Canal Pro",
  facebook: "Facebook",
  instagram: "Instagram",
  outra: "Outra origem",
}

/**
 * Nome do portal como o Grupo OLX o escreve (`zapimoveis`, `ZAP`, `VivaReal`,
 * `OLX`…) traduzido para a nossa lista. Desconhecido vira `canalpro` (é o que
 * sabemos de fato: veio pelo Canal Pro).
 */
export function toLeadIngestOrigin(
  value: unknown,
  fallback: LeadIngestOrigin = "outra"
): LeadIngestOrigin {
  if (typeof value !== "string") {
    return fallback
  }

  const key = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")

  if (key.includes("zap")) {
    return "zapimoveis"
  }

  if (key.includes("viva")) {
    return "vivareal"
  }

  if (key.includes("instagram") || key === "ig") {
    return "instagram"
  }

  if (key.includes("facebook") || key === "fb") {
    return "facebook"
  }

  // Antes do teste de "olx": "Grupo OLX" e "MCMV_OLX" são o guarda-chuva do
  // Canal Pro, não o portal OLX. Quem entrega não diz em qual dos três sites a
  // pessoa estava, então chamar de "OLX" seria inventar.
  if (key.includes("canalpro") || key.includes("grupozap") || key.includes("grupoolx")) {
    return "canalpro"
  }

  if (key.includes("mcmv")) {
    return "canalpro"
  }

  if (key.includes("olx")) {
    return "olx"
  }

  return fallback
}

// -----------------------------------------------------------------------------
// Situação de cada entrega
// -----------------------------------------------------------------------------

/**
 * - `pending`: recebida e ainda buscando os dados na origem (Meta manda só o id);
 * - `accepted`: virou lead no funil;
 * - `duplicate`: entrega repetida ou a mesma pessoa já estava no funil;
 * - `rejected`: dados insuficientes ou inválidos (o motivo fica na entrega);
 * - `failed`: não deu para buscar os dados na origem (erro; será repetida);
 * - `ignored`: recebida e descartada de propósito (teste de conexão, evento
 *   de outro tipo).
 */
export const LEAD_DELIVERY_STATUSES = [
  "pending",
  "accepted",
  "duplicate",
  "rejected",
  "failed",
  "ignored",
] as const

export type LeadDeliveryStatus = (typeof LEAD_DELIVERY_STATUSES)[number]

export const LEAD_DELIVERY_STATUS_LABELS: Record<LeadDeliveryStatus, string> = {
  pending: "Buscando os dados",
  accepted: "Entrou no funil",
  duplicate: "Duplicado",
  rejected: "Recusado",
  failed: "Falhou",
  ignored: "Ignorado",
}

/** Motivos estáveis de recusa (o banco guarda o código; a tela mostra o texto). */
export const LEAD_INGEST_REASONS = [
  "payload_invalido",
  "evento_sem_id",
  "sem_nome",
  "sem_contato",
  "telefone_invalido",
  "email_invalido",
  "entrega_repetida",
  "mesma_pessoa",
  "anuncio_nao_informado",
  "integracao_desconectada",
  "conta_desconhecida",
  "credencial_recusada",
  "origem_indisponivel",
  "teste_de_conexao",
] as const

export type LeadIngestReason = (typeof LEAD_INGEST_REASONS)[number]

export const LEAD_INGEST_REASON_LABELS: Record<LeadIngestReason, string> = {
  payload_invalido: "A origem mandou um formato que não reconhecemos.",
  evento_sem_id: "A entrega veio sem identificador, então não dá para evitar repetição.",
  sem_nome: "O contato veio sem nome.",
  sem_contato: "O contato veio sem e-mail e sem telefone.",
  telefone_invalido: "O telefone informado não é um número brasileiro válido.",
  email_invalido: "O e-mail informado não é válido.",
  entrega_repetida: "A origem reenviou a mesma entrega; o lead já estava no funil.",
  mesma_pessoa: "Esta pessoa já tinha entrado no funil há pouco, por outra origem.",
  anuncio_nao_informado:
    "O portal não informou qual anúncio gerou o contato; pedimos o reenvio a ele.",
  integracao_desconectada: "A integração estava desconectada quando a entrega chegou.",
  conta_desconhecida: "A conta da origem não está ligada a nenhuma imobiliária aqui.",
  credencial_recusada: "A origem recusou a credencial guardada. Conecte a conta de novo.",
  origem_indisponivel: "A origem não respondeu. Vamos tentar de novo automaticamente.",
  teste_de_conexao: "Teste de conexão feito por você.",
}

export function isLeadIngestReason(value: unknown): value is LeadIngestReason {
  return typeof value === "string" && (LEAD_INGEST_REASONS as readonly string[]).includes(value)
}

export function describeLeadIngestReason(value: unknown): string | null {
  return isLeadIngestReason(value) ? LEAD_INGEST_REASON_LABELS[value] : null
}

// -----------------------------------------------------------------------------
// Limites (iguais aos CHECKs do banco)
// -----------------------------------------------------------------------------

export const LEAD_NAME_MIN_LENGTH = 2
export const LEAD_NAME_MAX_LENGTH = 120
export const LEAD_EMAIL_MAX_LENGTH = 254
export const LEAD_MESSAGE_MAX_LENGTH = 2000
/** `properties.code`, que é o ListingID publicado no feed VRSync. */
export const LISTING_CODE_MAX_LENGTH = 50
/** Id do evento na origem (idempotência). */
export const EXTERNAL_EVENT_ID_MAX_LENGTH = 200

/**
 * Janela em que a MESMA pessoa chegando por OUTRA origem não vira um segundo
 * lead: ela é anexada à entrega e o funil continua com um card só. Fora dela,
 * um contato novo é um contato novo — e o sinal de duplicado de 90 dias
 * (`lead_duplicate_flags`) continua avisando o corretor na tela.
 */
export const LEAD_INGEST_DEDUP_WINDOW_HOURS = 24

// -----------------------------------------------------------------------------
// Normalização de campos (dado hostil)
// -----------------------------------------------------------------------------

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

/** Remove controles e junta espaços repetidos; devolve null quando sobra nada. */
function squish(value: unknown): string | null {
  const text = asText(value)

  if (text === null) {
    return null
  }

  // \p{Cc} = caracteres de controle (o payload externo vem com eles).
  const cleaned = text
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  return cleaned.length > 0 ? cleaned : null
}

/** Nome do contato: aparado, sem controles e cortado em 120. */
export function normalizeIngestName(value: unknown): string | null {
  const text = squish(value)

  if (text === null || text.length < LEAD_NAME_MIN_LENGTH) {
    return null
  }

  return text.slice(0, LEAD_NAME_MAX_LENGTH)
}

/** Mesma regra estrita do CHECK `leads_email_format`. */
const EMAIL_PATTERN =
  /^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/

export function normalizeIngestEmail(value: unknown): string | null {
  const text = squish(value)

  if (text === null) {
    return null
  }

  const email = text.toLowerCase().replace(/\s/g, "")

  if (email.length > LEAD_EMAIL_MAX_LENGTH || email.includes("..") || !EMAIL_PATTERN.test(email)) {
    return null
  }

  return email
}

/**
 * Telefone brasileiro em dígitos (DDD + 8 ou 9). Tira o `+55`, o `0` da
 * operadora e qualquer máscara; devolve null quando não sobra um número
 * discável (quem chama transforma isso na recusa `telefone_invalido`).
 */
export function normalizeIngestPhone(value: unknown): string | null {
  const text = asText(value)

  if (text === null) {
    return null
  }

  let digits = text.replace(/\D/g, "")

  if (digits.length === 0) {
    return null
  }

  // Formato internacional: 55 + DDD + 8/9 dígitos.
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2)
  }

  // "0" de operadora antes do DDD.
  if ((digits.length === 11 || digits.length === 12) && digits.startsWith("0")) {
    digits = digits.slice(1)
  }

  if (digits.length !== 10 && digits.length !== 11) {
    return null
  }

  // DDD válido (11 a 99) e número que não começa em 0 nem em 1.
  if (Number(digits.slice(0, 2)) < 11 || /^[01]/.test(digits.slice(2))) {
    return null
  }

  return digits
}

/** Mensagem do contato: aparada e cortada em 2.000 (nunca recusa por tamanho). */
export function normalizeIngestMessage(value: unknown): string | null {
  const text = asText(value)

  if (text === null) {
    return null
  }

  // Preserva as quebras de linha e tira o resto dos caracteres de controle.
  const cleaned = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\p{Cc}/gu, " ").trimEnd())
    .join("\n")
    .trim()

  return cleaned.length > 0 ? cleaned.slice(0, LEAD_MESSAGE_MAX_LENGTH) : null
}

/** Código do anúncio (ListingID do feed VRSync = `properties.code`). */
export function normalizeListingCode(value: unknown): string | null {
  const text = squish(value)

  return text === null ? null : text.slice(0, LISTING_CODE_MAX_LENGTH)
}

/** Id do evento na origem, usado como chave de idempotência. */
export function normalizeExternalEventId(value: unknown): string | null {
  const text = squish(value)

  if (text === null) {
    return null
  }

  // Sem espaços: o id vai para uma chave única e para a URL de consulta.
  const id = text.replace(/\s/g, "")

  return id.length > 0 ? id.slice(0, EXTERNAL_EVENT_ID_MAX_LENGTH) : null
}

export const LEAD_INTERESTS = ["buy", "rent", "invest", "sell", "info"] as const

export type LeadIngestInterest = (typeof LEAD_INTERESTS)[number]

/**
 * Tipo de transação DO ANÚNCIO (`SELL`/`RENT` no Canal Pro) traduzido para o
 * interesse DA PESSOA: anúncio de venda gera lead que quer comprar (`buy`),
 * anúncio de locação gera lead que quer alugar (`rent`). Resto: null.
 */
export function toLeadInterest(value: unknown): LeadIngestInterest | null {
  const text = squish(value)

  if (text === null) {
    return null
  }

  const key = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

  if (/(sell|sale|venda|compra|buy|comprar)/.test(key)) {
    return "buy"
  }

  if (/(alug|rent|locacao|lease)/.test(key)) {
    return "rent"
  }

  return null
}

/**
 * Instante informado pela origem. Aceita ISO 8601 e epoch em segundos (Meta) ou
 * milissegundos; recusa datas absurdas (antes de 2020 ou mais de 1 dia no
 * futuro), que denunciam payload adulterado.
 */
export function toIngestInstant(value: unknown, nowMs: number): string | null {
  let ms: number | null = null

  if (typeof value === "number" && Number.isFinite(value)) {
    ms = value > 1e11 ? value : value * 1000
  } else if (typeof value === "string") {
    const text = value.trim()

    if (/^\d{9,13}$/.test(text)) {
      const numeric = Number(text)
      ms = numeric > 1e11 ? numeric : numeric * 1000
    } else if (text.length > 0) {
      const parsed = Date.parse(text)
      ms = Number.isNaN(parsed) ? null : parsed
    }
  }

  if (ms === null || !Number.isFinite(ms)) {
    return null
  }

  const MIN_MS = Date.UTC(2020, 0, 1)
  const MAX_MS = nowMs + 24 * 60 * 60 * 1000

  if (ms < MIN_MS || ms > MAX_MS) {
    return null
  }

  return new Date(ms).toISOString()
}

// -----------------------------------------------------------------------------
// Deduplicação (mesma regra de public.lead_duplicate_flags)
// -----------------------------------------------------------------------------

/**
 * Chaves de casamento de contato, iguais às de `lead_duplicate_flags`:
 * telefone pelos **últimos 11 dígitos** (pega o mesmo número com e sem o 9,
 * com e sem +55, e casa com `clients.phone` e `clients.whatsapp`) e e-mail em
 * minúsculas. Dois leads são a mesma pessoa quando UMA das chaves bate.
 */
export type LeadContactKeys = {
  phoneKey: string | null
  emailKey: string | null
}

export function leadContactKeys(contact: {
  phone?: string | null
  email?: string | null
}): LeadContactKeys {
  const digits = (contact.phone ?? "").replace(/\D/g, "")
  const email = (contact.email ?? "").trim().toLowerCase()

  return {
    phoneKey: digits.length > 0 ? digits.slice(-11) : null,
    emailKey: email.length > 0 ? email : null,
  }
}

/** true quando os dois contatos são, pela regra do CRM, a mesma pessoa. */
export function isSameContact(
  a: { phone?: string | null; email?: string | null },
  b: { phone?: string | null; email?: string | null }
): boolean {
  const left = leadContactKeys(a)
  const right = leadContactKeys(b)

  if (left.phoneKey !== null && left.phoneKey === right.phoneKey) {
    return true
  }

  return left.emailKey !== null && left.emailKey === right.emailKey
}

/**
 * Decide o que fazer com um lead que chegou: entra no funil, ou é a mesma
 * pessoa de um lead recente (e vira só uma entrega anexada).
 * `windowHours` padrão = LEAD_INGEST_DEDUP_WINDOW_HOURS.
 */
export type ExistingLead = {
  id: string
  phone?: string | null
  email?: string | null
  /** ISO 8601. */
  createdAt: string
}

export function findRecentDuplicate(
  candidate: { phone?: string | null; email?: string | null },
  existing: readonly ExistingLead[],
  nowMs: number,
  windowHours: number = LEAD_INGEST_DEDUP_WINDOW_HOURS
): ExistingLead | null {
  const floor = nowMs - windowHours * 60 * 60 * 1000
  let best: { lead: ExistingLead; at: number } | null = null

  for (const lead of existing) {
    const at = Date.parse(lead.createdAt)

    if (Number.isNaN(at) || at < floor || at > nowMs) {
      continue
    }

    if (!isSameContact(candidate, lead)) {
      continue
    }

    if (!best || at > best.at) {
      best = { lead, at }
    }
  }

  return best?.lead ?? null
}

// -----------------------------------------------------------------------------
// Lead normalizado (o que vai para a RPC)
// -----------------------------------------------------------------------------

export type NormalizedIngestLead = {
  /** Id do evento na origem: a repetição da entrega não cria outro lead. */
  eventId: string
  name: string
  email: string | null
  /** Só dígitos (DDD + 8/9), como o banco guarda. */
  phone: string | null
  message: string | null
  interest: LeadIngestInterest | null
  /** ListingID do feed VRSync (`properties.code`), quando a origem informa. */
  listingCode: string | null
  origin: LeadIngestOrigin
  /** ISO 8601 informado pela origem; null quando ela não informa. */
  occurredAt: string | null
  /** {source, medium, campaign, content, term} — cada um até 150. */
  utm: Record<string, string>
}

export type LeadIngestResult =
  | { ok: true; lead: NormalizedIngestLead }
  | {
      ok: false
      reason: LeadIngestReason
      eventId: string | null
      /**
       * O mesmo payload da RPC, com o que deu para aproveitar. Serve para a
       * recusa ser registrada no banco COM O MOTIVO QUE O BANCO APURAR — quem
       * decide aceitar ou recusar é ele, não este arquivo. Null quando nem o
       * id da entrega veio (aí não há o que registrar).
       */
      partial: IngestLeadPayload | null
    }

const UTM_MAX_LENGTH = 150

function utmValue(value: unknown): string | null {
  const text = squish(value)

  return text === null ? null : text.slice(0, UTM_MAX_LENGTH)
}

function buildUtm(entries: Record<string, unknown>): Record<string, string> {
  const utm: Record<string, string> = {}

  for (const key of ["source", "medium", "campaign", "content", "term"]) {
    const value = utmValue(entries[key])

    if (value !== null) {
      utm[key] = value
    }
  }

  return utm
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Última etapa comum às duas origens: confere nome, contato e telefone e monta
 * o lead normalizado. Nunca lança.
 */
function finishIngest(input: {
  eventId: string | null
  name: unknown
  email: unknown
  phone: unknown
  rawPhone: unknown
  message: unknown
  interest: LeadIngestInterest | null
  listingCode: unknown
  origin: LeadIngestOrigin
  occurredAt: string | null
  utm: Record<string, unknown>
}): LeadIngestResult {
  const eventId = normalizeExternalEventId(input.eventId)

  if (eventId === null) {
    return { ok: false, reason: "evento_sem_id", eventId: null, partial: null }
  }

  const name = normalizeIngestName(input.name)
  const email = normalizeIngestEmail(input.email)
  const phone = normalizeIngestPhone(input.phone)
  const hadRawPhone = squish(input.rawPhone) !== null

  const lead: NormalizedIngestLead = {
    eventId,
    name: name ?? "",
    email,
    phone,
    message: normalizeIngestMessage(input.message),
    interest: input.interest,
    listingCode: normalizeListingCode(input.listingCode),
    origin: input.origin,
    occurredAt: input.occurredAt,
    utm: buildUtm(input.utm),
  }

  function rejected(reason: LeadIngestReason): LeadIngestResult {
    return { ok: false, reason, eventId, partial: toIngestLeadPayload(lead) }
  }

  if (name === null) {
    return rejected("sem_nome")
  }

  if (phone === null && hadRawPhone && email === null) {
    return rejected("telefone_invalido")
  }

  if (phone === null && email === null) {
    return rejected("sem_contato")
  }

  return { ok: true, lead }
}

// -----------------------------------------------------------------------------
// Meta Lead Ads (Facebook e Instagram)
// -----------------------------------------------------------------------------

/**
 * Uma mudança `leadgen` do webhook da Meta. Os ids chegam como NÚMERO no JSON
 * e são guardados como texto (podem passar de Number.MAX_SAFE_INTEGER).
 * Fonte: developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/
 */
export type MetaLeadgenEvent = {
  leadgenId: string
  pageId: string
  formId: string | null
  adId: string | null
  adgroupId: string | null
  /** ISO 8601 (o webhook manda epoch em segundos). */
  createdAt: string | null
}

function metaId(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value)
  }

  const text = squish(value)

  return text !== null && /^[0-9]{1,32}$/.test(text) ? text : null
}

/**
 * Lê o envelope `{object:"page", entry:[{changes:[{field, value}]}]}`. `entry` e
 * `changes` são arrays e a Meta manda mais de um item no mesmo POST. Eventos de
 * outros campos (ou malformados) são descartados em silêncio.
 */
export function parseMetaLeadgenEvents(body: unknown, nowMs: number): MetaLeadgenEvent[] {
  if (!isRecord(body) || body.object !== "page" || !Array.isArray(body.entry)) {
    return []
  }

  const events: MetaLeadgenEvent[] = []

  for (const entry of body.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) {
      continue
    }

    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== "leadgen" || !isRecord(change.value)) {
        continue
      }

      const value = change.value
      const leadgenId = metaId(value.leadgen_id)
      const pageId = metaId(value.page_id) ?? metaId(entry.id)

      if (leadgenId === null || pageId === null) {
        continue
      }

      events.push({
        leadgenId,
        pageId,
        formId: metaId(value.form_id),
        adId: metaId(value.ad_id),
        adgroupId: metaId(value.adgroup_id),
        createdAt: toIngestInstant(value.created_time, nowMs),
      })
    }
  }

  return events
}

/**
 * Campos padrão do formulário da Meta. Perguntas personalizadas ficam de fora
 * desta lista e viram a mensagem do lead ("Pergunta: resposta").
 * Fonte: developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving
 */
const META_NAME_FIELDS = ["full_name", "name"]
const META_EMAIL_FIELDS = ["email", "work_email"]
const META_PHONE_FIELDS = ["phone_number", "work_phone_number", "phone"]
const META_IGNORED_FIELDS = new Set([
  ...META_NAME_FIELDS,
  ...META_EMAIL_FIELDS,
  ...META_PHONE_FIELDS,
  "first_name",
  "last_name",
])

export type MetaFieldDatum = { name?: unknown; values?: unknown }

function readMetaField(fields: readonly MetaFieldDatum[], names: readonly string[]) {
  for (const name of names) {
    for (const field of fields) {
      if (squish(field?.name)?.toLowerCase() !== name) {
        continue
      }

      const values = Array.isArray(field.values) ? field.values : []
      const first = values.map(squish).find((item) => item !== null)

      if (first !== undefined && first !== null) {
        return first
      }
    }
  }

  return null
}

/** Perguntas personalizadas do formulário, em "Pergunta: resposta". */
function readMetaExtras(fields: readonly MetaFieldDatum[]) {
  const lines: string[] = []

  for (const field of fields) {
    const name = squish(field?.name)

    if (name === null || META_IGNORED_FIELDS.has(name.toLowerCase())) {
      continue
    }

    const values = Array.isArray(field.values) ? field.values : []
    const answer = values
      .map(squish)
      .filter((item): item is string => item !== null)
      .join(", ")

    if (answer.length > 0) {
      lines.push(`${name}: ${answer}`)
    }
  }

  return lines.length > 0 ? lines.join("\n") : null
}

/**
 * Resposta de `GET /{leadgen_id}` do Graph API somada ao evento do webhook.
 * `platform` ("ig"/"fb") só vem em alguns formulários; sem ele, Facebook.
 */
export type MetaLeadInput = {
  event: MetaLeadgenEvent
  fieldData: readonly MetaFieldDatum[]
  createdTime?: unknown
  platform?: unknown
  /** Nome do formulário, quando buscado (entra na atribuição). */
  formName?: unknown
}

export function normalizeMetaLead(input: MetaLeadInput, nowMs: number): LeadIngestResult {
  const fields = Array.isArray(input.fieldData) ? input.fieldData : []
  const fullName = readMetaField(fields, META_NAME_FIELDS)
  const firstName = readMetaField(fields, ["first_name"])
  const lastName = readMetaField(fields, ["last_name"])
  const rawPhone = readMetaField(fields, META_PHONE_FIELDS)

  return finishIngest({
    eventId: input.event.leadgenId,
    name: fullName ?? [firstName, lastName].filter(Boolean).join(" "),
    email: readMetaField(fields, META_EMAIL_FIELDS),
    phone: rawPhone,
    rawPhone,
    message: readMetaExtras(fields),
    interest: null,
    listingCode: null,
    origin: toLeadIngestOrigin(input.platform, "facebook"),
    occurredAt: toIngestInstant(input.createdTime, nowMs) ?? input.event.createdAt,
    utm: {
      source: toLeadIngestOrigin(input.platform, "facebook"),
      medium: "lead_ads",
      campaign: squish(input.formName) ?? input.event.formId,
      content: input.event.adId,
    },
  })
}

// -----------------------------------------------------------------------------
// Canal Pro (Grupo OLX: ZAP Imóveis, Viva Real e OLX)
// -----------------------------------------------------------------------------

/**
 * O Grupo OLX entrega lead por WEBHOOK, um lead por requisição. Contrato:
 * developers.grupozap.com/webhooks/integration_leads.html
 *
 * {
 *   leadOrigin: "Grupo OLX" | "MCMV_OLX",
 *   timestamp, originLeadId, originListingId, clientListingId,
 *   name, email, ddd, phone, phoneNumber (depreciado), message,
 *   temperature: "Baixa" | "Média" | "Alta",
 *   transactionType: "SELL" | "RENT",
 *   extraData: { leadCerto, izi, feedback, leadType, mcmv }
 * }
 *
 * `clientListingId` é o `<ListingID>` que NÓS publicamos no feed VRSync, ou
 * seja, `properties.code`: é o elo entre o lead e o imóvel.
 */

/** Lead de simulação do Minha Casa Minha Vida: não tem anúncio. */
export const CANAL_PRO_MCMV_ORIGIN = "MCMV_OLX"

/** Canal em que a pessoa falou com o anúncio (extraData.leadType). */
export const CANAL_PRO_LEAD_TYPE_LABELS: Record<string, string> = {
  CLICK_SCHEDULE: "Pediu agendamento",
  CLICK_WHATSAPP: "Clicou no WhatsApp",
  CONTACT_CHAT: "Chat do portal",
  CONTACT_FORM: "Formulário do anúncio",
  PHONE_VIEW: "Viu o telefone",
  VISIT_REQUEST: "Pediu visita",
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
}

/**
 * true quando o lead veio de um ANÚNCIO (e não da simulação do Minha Casa
 * Minha Vida). A doc do Grupo OLX manda responder 4xx quando um lead de
 * anúncio chega sem `clientListingId` — para eles revisarem e reenviarem — e
 * manda NÃO responder 4xx por esse motivo nos leads `MCMV_OLX`.
 */
export function isCanalProListingLead(raw: unknown): boolean {
  if (!isRecord(raw)) {
    return false
  }

  const origin = squish(raw.leadOrigin)
    ?.toUpperCase()
    .replace(/[^A-Z]/g, "")

  return origin !== "MCMVOLX"
}

/** Junta o telefone do jeito que o Grupo OLX manda: `ddd` + `phone`. */
function canalProPhone(raw: Record<string, unknown>): string | null {
  const ddd = squish(raw.ddd)?.replace(/\D/g, "") ?? ""
  const phone = squish(raw.phone)?.replace(/\D/g, "") ?? ""
  const joined = `${ddd}${phone}`

  if (joined.length >= 10) {
    return joined
  }

  // `phoneNumber` está depreciado, mas é o que sobra quando ddd/phone faltam.
  return squish(raw.phoneNumber) ?? (joined.length > 0 ? joined : null)
}

/**
 * Monta a mensagem do lead: o texto da pessoa mais as pistas do portal que o
 * corretor usa para decidir como abordar (canal, temperatura e, no MCMV, o
 * resumo da simulação). Tudo já vem cortado em 2.000 pelo normalizador.
 */
function canalProMessage(raw: Record<string, unknown>): string | null {
  const lines: string[] = []
  const message = squish(raw.message)

  if (message) {
    lines.push(message)
  }

  const extra = isRecordValue(raw.extraData) ? raw.extraData : {}
  const leadType = squish(extra.leadType)?.toUpperCase()
  const context: string[] = []

  if (leadType) {
    context.push(CANAL_PRO_LEAD_TYPE_LABELS[leadType] ?? leadType)
  }

  const temperature = squish(raw.temperature)

  if (temperature) {
    context.push(`interesse ${temperature.toLowerCase()}`)
  }

  if (context.length > 0) {
    lines.push(`[Portal: ${context.join(" · ")}]`)
  }

  const mcmv = isRecordValue(extra.mcmv) ? extra.mcmv : null

  if (mcmv) {
    const location = isRecordValue(mcmv.propertyLocation) ? mcmv.propertyLocation : {}
    const parts = [
      squish(mcmv.unitType) ? `Tipo: ${squish(mcmv.unitType)}` : null,
      squish(location.city)
        ? `Cidade: ${squish(location.city)}/${squish(location.state) ?? ""}`
        : null,
      squish(mcmv.propertyValue) ? `Valor do imóvel: ${squish(mcmv.propertyValue)}` : null,
      squish(mcmv.downPayment) ? `Entrada: ${squish(mcmv.downPayment)}` : null,
      squish(mcmv.urgencyToBuy) ? `Urgência: ${squish(mcmv.urgencyToBuy)}` : null,
    ].filter((part): part is string => part !== null)

    if (parts.length > 0) {
      lines.push(`[Simulação Minha Casa Minha Vida] ${parts.join(" · ")}`)
    }
  }

  return lines.length > 0 ? lines.join("\n") : null
}

export function normalizeCanalProLead(raw: unknown, nowMs: number): LeadIngestResult {
  if (!isRecord(raw)) {
    return { ok: false, reason: "payload_invalido", eventId: null, partial: null }
  }

  const extra = isRecordValue(raw.extraData) ? raw.extraData : {}
  const rawPhone = canalProPhone(raw)
  // `leadOrigin` é sempre "Grupo OLX" nos leads de anúncio: o portal exato
  // (ZAP, Viva Real, OLX) não vem no payload.
  const origin = toLeadIngestOrigin(raw.leadOrigin, "canalpro")
  const listingCode = normalizeListingCode(raw.clientListingId)

  return finishIngest({
    eventId: normalizeExternalEventId(raw.originLeadId),
    name: raw.name,
    email: raw.email,
    phone: rawPhone,
    rawPhone,
    message: canalProMessage(raw),
    interest: toLeadInterest(raw.transactionType),
    listingCode,
    origin,
    occurredAt: toIngestInstant(raw.timestamp, nowMs),
    utm: {
      source: origin,
      medium: "portal",
      campaign: extra.leadType,
      content: raw.originListingId,
    },
  })
}

// -----------------------------------------------------------------------------
// Payload da RPC
// -----------------------------------------------------------------------------

/** Corpo de `p_payload` em `public.ingest_external_lead`. */
export type IngestLeadPayload = {
  event_id: string
  name: string
  email?: string
  phone?: string
  message?: string
  interest?: LeadIngestInterest
  listing_code?: string
  origin: LeadIngestOrigin
  occurred_at?: string
  utm: Record<string, string>
}

export function toIngestLeadPayload(lead: NormalizedIngestLead): IngestLeadPayload {
  return {
    event_id: lead.eventId,
    name: lead.name,
    ...(lead.email ? { email: lead.email } : {}),
    ...(lead.phone ? { phone: lead.phone } : {}),
    ...(lead.message ? { message: lead.message } : {}),
    ...(lead.interest ? { interest: lead.interest } : {}),
    ...(lead.listingCode ? { listing_code: lead.listingCode } : {}),
    origin: lead.origin,
    ...(lead.occurredAt ? { occurred_at: lead.occurredAt } : {}),
    utm: lead.utm,
  }
}

// -----------------------------------------------------------------------------
// Assinatura do webhook da Meta (parte pura)
// -----------------------------------------------------------------------------

/**
 * Lê o header `X-Hub-Signature-256` (`sha256=<hex>`) e devolve só o hex em
 * minúsculas. Header ausente, com outro algoritmo ou fora do formato: null —
 * e quem chama responde 401 sem fazer trabalho nenhum.
 * Fonte: developers.facebook.com/docs/graph-api/webhooks/getting-started/
 */
export function parseMetaSignatureHeader(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(value.trim())

  return match ? match[1]!.toLowerCase() : null
}
