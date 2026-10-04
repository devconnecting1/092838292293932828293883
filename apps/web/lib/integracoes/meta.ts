import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { parseMetaSignatureHeader } from "@workspace/core/leads/ingest"
import { WHATSAPP_GRAPH_BASE_URL, WHATSAPP_GRAPH_VERSION } from "@workspace/core/whatsapp"

/**
 * Conversa com a Meta (Facebook e Instagram) para o Lead Ads.
 *
 * Dois segredos, com donos diferentes:
 * - do NOSSO app: META_APP_SECRET (assina os webhooks) e
 *   META_WEBHOOK_VERIFY_TOKEN (o handshake do endpoint). Um só, para todos os
 *   clientes;
 * - do CLIENTE: o token de acesso da Página dele, guardado cifrado no Vault e
 *   lido por read_lead_integration_secret. A conta de anúncios é dele, a Meta
 *   cobra ele, e nós nunca entramos no meio do custo.
 *
 * Nenhuma função daqui coloca token em URL, em log ou em resposta HTTP.
 */

/**
 * Versão do Graph API: a mesma do WhatsApp, definida uma vez só no core. A Meta
 * mantém cada versão por pelo menos 2 anos. Sem versão no caminho, a chamada
 * usaria a versão do painel do app — e mudaria sozinha.
 */
export const GRAPH_API_VERSION = WHATSAPP_GRAPH_VERSION
const GRAPH_API_BASE = `${WHATSAPP_GRAPH_BASE_URL}/${GRAPH_API_VERSION}`

/** Orçamento por chamada: o webhook precisa responder rápido. */
const REQUEST_TIMEOUT_MS = 8000

export function readAppSecret(): string | null {
  return process.env.META_APP_SECRET?.trim() || null
}

export function readVerifyToken(): string | null {
  return process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || null
}

/** Compara dois textos sem vazar o segredo pelo tempo de resposta. */
function equalsInConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")

  // timingSafeEqual exige o mesmo tamanho; o hash iguala os comprimentos.
  const leftHash = createHmac("sha256", "compare").update(left).digest()
  const rightHash = createHmac("sha256", "compare").update(right).digest()

  return timingSafeEqual(leftHash, rightHash)
}

/** Handshake do endpoint: confere hub.verify_token. */
export function isVerifyTokenValid(candidate: string | null): boolean {
  const expected = readVerifyToken()

  if (!expected || !candidate) {
    return false
  }

  return equalsInConstantTime(candidate, expected)
}

/**
 * Confere `X-Hub-Signature-256` sobre o CORPO CRU. Qualquer parse antes do
 * cálculo invalida a assinatura: a Meta assina o JSON dela com escapes unicode,
 * então `JSON.parse` + `JSON.stringify` mudaria os bytes.
 */
export function isSignatureValid(rawBody: string, header: string | null): boolean {
  const appSecret = readAppSecret()
  const received = parseMetaSignatureHeader(header)

  if (!appSecret || !received) {
    return false
  }

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")

  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"))
}

export type GraphFailure = {
  /** Motivo estável para a entrega. */
  kind: "credencial_recusada" | "origem_indisponivel"
  /** Texto curto e sem segredo, para a tela e para o log. */
  detail: string
}

export type GraphResult<T> = { ok: true; data: T } | ({ ok: false } & GraphFailure)

/** Códigos em que insistir não adianta: o token caiu ou perdeu permissão. */
const PERMANENT_ERROR_CODES = new Set([102, 190, 200, 210, 803])

async function graphGet<T>(
  path: string,
  accessToken: string,
  searchParams: Record<string, string> = {}
): Promise<GraphResult<T>> {
  const url = new URL(`${GRAPH_API_BASE}/${path}`)

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value)
  }

  let response: Response

  try {
    response = await fetch(url, {
      method: "GET",
      // O token vai no header, nunca na URL: URL entra em log de proxy.
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (cause) {
    return {
      ok: false,
      kind: "origem_indisponivel",
      detail:
        cause instanceof Error && cause.name === "TimeoutError" ? "tempo esgotado" : "sem resposta",
    }
  }

  let body: unknown

  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (response.ok) {
    return { ok: true, data: body as T }
  }

  const error =
    typeof body === "object" && body !== null && "error" in body
      ? ((body as { error: unknown }).error as Record<string, unknown>)
      : null
  const code = typeof error?.code === "number" ? error.code : null
  const permanent =
    response.status === 401 ||
    response.status === 403 ||
    (code !== null && PERMANENT_ERROR_CODES.has(code))

  return {
    ok: false,
    kind: permanent ? "credencial_recusada" : "origem_indisponivel",
    // Só status e código: a mensagem da Meta pode repetir o token.
    detail: `HTTP ${response.status}${code === null ? "" : ` (código ${code})`}`,
  }
}

export type MetaLeadData = {
  id: string
  createdTime: unknown
  formId: string | null
  adId: string | null
  platform: unknown
  fieldData: { name?: unknown; values?: unknown }[]
}

/** `GET /{leadgen_id}`: os dados que a pessoa preencheu no formulário. */
export async function fetchLead(
  leadgenId: string,
  accessToken: string
): Promise<GraphResult<MetaLeadData>> {
  const result = await graphGet<Record<string, unknown>>(
    encodeURIComponent(leadgenId),
    accessToken,
    { fields: "id,created_time,ad_id,form_id,platform,field_data" }
  )

  if (!result.ok) {
    return result
  }

  const data = result.data

  return {
    ok: true,
    data: {
      id: typeof data.id === "string" ? data.id : leadgenId,
      createdTime: data.created_time,
      formId: typeof data.form_id === "string" ? data.form_id : null,
      adId: typeof data.ad_id === "string" ? data.ad_id : null,
      platform: data.platform,
      fieldData: Array.isArray(data.field_data)
        ? (data.field_data as { name?: unknown; values?: unknown }[])
        : [],
    },
  }
}

export type MetaConnectionCheck = {
  pageName: string | null
  /** Se o nosso app está inscrito no campo `leadgen` da Página. */
  subscribedToLeadgen: boolean
}

/**
 * Teste de conexão de verdade: pergunta o nome da Página (valida o token) e
 * confere se o app está inscrito em `leadgen` (sem isso, nenhum lead chega).
 */
export async function checkPageConnection(
  pageId: string,
  accessToken: string
): Promise<GraphResult<MetaConnectionCheck>> {
  const page = await graphGet<Record<string, unknown>>(encodeURIComponent(pageId), accessToken, {
    fields: "id,name",
  })

  if (!page.ok) {
    return page
  }

  const subscriptions = await graphGet<Record<string, unknown>>(
    `${encodeURIComponent(pageId)}/subscribed_apps`,
    accessToken
  )

  let subscribedToLeadgen = false

  if (subscriptions.ok) {
    const rows = Array.isArray(subscriptions.data.data) ? subscriptions.data.data : []

    subscribedToLeadgen = rows.some((row) => {
      if (typeof row !== "object" || row === null) {
        return false
      }

      const fields = (row as { subscribed_fields?: unknown }).subscribed_fields

      return Array.isArray(fields) && fields.includes("leadgen")
    })
  }

  return {
    ok: true,
    data: {
      pageName: typeof page.data.name === "string" ? page.data.name : null,
      subscribedToLeadgen,
    },
  }
}
