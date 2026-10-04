import "server-only"

import { NextResponse, type NextRequest } from "next/server"

import type { createClient } from "@/lib/supabase/server"
import { HOME_PATH, INVITATION_PATH_PREFIX, LOGIN_PATH, ONBOARDING_PATH } from "@/lib/auth/routes"
import { getCurrentOrigin } from "@/lib/tenant/server"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Origem pública usada nos redirecionamentos de /auth: o subdomínio validado
 * da imobiliária ou o domínio raiz (env + slug), nunca Host/X-Forwarded-Host.
 * Mantém a sessão no mesmo host em que o fluxo começou.
 */
export function getRequestOrigin() {
  return getCurrentOrigin()
}

type LoginRedirectParams = {
  /** Código de erro exibido em /entrar (ver getAuthQueryErrorMessage). */
  erro?: string
  /** Código de aviso positivo exibido em /entrar (ver getAuthQueryNotice). */
  aviso?: string
  /** Destino já sanitizado para depois do login. */
  next?: string
}

/** Caminho relativo de /entrar com `erro`, `aviso` e `next` (para redirect()). */
export function buildLoginPath(params: LoginRedirectParams) {
  const search = new URLSearchParams()

  if (params.erro) search.set("erro", params.erro)
  if (params.aviso) search.set("aviso", params.aviso)
  if (params.next && params.next !== HOME_PATH) search.set("next", params.next)

  const query = search.toString()

  return query ? `${LOGIN_PATH}?${query}` : LOGIN_PATH
}

export async function redirectToLogin(params: LoginRedirectParams) {
  return NextResponse.redirect(new URL(buildLoginPath(params), await getRequestOrigin()))
}

export function getLinkErrorCode(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get("error_code") ?? searchParams.get("error")

  if (!code) {
    return null
  }

  return code === "otp_expired" ? "link-expirado" : "link-invalido"
}

type AuthErrorLike = { name?: string; code?: string }

/**
 * O code verifier do PKCE fica num cookie do navegador que pediu o link. Se o
 * link for aberto em outro navegador (ou no app de e-mail), ele não existe.
 */
export function isPkceVerifierMissing(error: AuthErrorLike) {
  return (
    error.code === "pkce_code_verifier_not_found" ||
    error.name === "AuthPKCECodeVerifierMissingError"
  )
}

/** `?code=` do PKCE (UUID emitido pelo Supabase Auth) e `sb_flow_id`. */
const AUTH_CODE_PATTERN = /^[A-Za-z0-9-]{8,128}$/
const FLOW_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/

/** Lê o `code` do link só se tiver o formato esperado; senão `null`. */
export function readAuthCode(searchParams: URLSearchParams): string | null {
  const value = searchParams.get("code")
  return value !== null && AUTH_CODE_PATTERN.test(value) ? value : null
}

function readFlowId(searchParams: URLSearchParams): string | null {
  const value = searchParams.get("sb_flow_id")
  return value !== null && FLOW_ID_PATTERN.test(value) ? value : null
}

export type CodeExchangeOutcome =
  { ok: true } | { ok: false; reason: "invalid" | "expired" | "verifier-missing" }

/**
 * Troca o `code` do link por uma sessão. Quem decide se a sessão abre é o
 * Supabase Auth (code + code verifier do navegador): nenhum outro parâmetro
 * da URL concede acesso ou pula esta checagem.
 */
export async function exchangeAuthCode(
  supabase: SupabaseServerClient,
  searchParams: URLSearchParams,
  logTag: string
): Promise<CodeExchangeOutcome> {
  const code = readAuthCode(searchParams)

  if (code === null) {
    return { ok: false, reason: "invalid" }
  }

  // O auth-js anexa `sb_flow_id` ao redirectTo: com ele, a troca usa o verifier
  // exato daquele pedido (e não o do pedido mais recente deste navegador).
  const flowId = readFlowId(searchParams)
  const { error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined
  )

  if (!error) {
    return { ok: true }
  }

  // Só o código do erro: nada de e-mail, token ou code no log.
  console.warn(`[${logTag}] exchangeCodeForSession falhou: ${error.code ?? error.name}`)

  if (isPkceVerifierMissing(error)) {
    return { ok: false, reason: "verifier-missing" }
  }

  return {
    ok: false,
    reason:
      error.code === "flow_state_expired" || error.code === "otp_expired" ? "expired" : "invalid",
  }
}

/**
 * Parâmetros de /entrar para uma troca de código que falhou. `signUpNotice`
 * (vindo da URL) só escolhe o texto do aviso: não abre sessão nem muda destino.
 */
export function loginParamsForFailedExchange(
  reason: Exclude<CodeExchangeOutcome, { ok: true }>["reason"],
  next: string,
  signUpNotice: boolean
): LoginRedirectParams {
  switch (reason) {
    case "verifier-missing":
      // O Supabase já confirmou o e-mail antes de redirecionar para cá; só não
      // dá para abrir a sessão neste navegador.
      return signUpNotice
        ? { aviso: "email-confirmado", next }
        : { erro: "link-outro-navegador", next }
    case "expired":
      return { erro: "link-expirado", next }
    default:
      return { erro: "link-invalido", next }
  }
}

/** Janela para considerar o `amr` de cadastro como o da sessão recém-aberta. */
const SIGN_UP_AMR_WINDOW_SECONDS = 15 * 60

/**
 * Se a sessão atual nasceu agora da confirmação de cadastro. A fonte é o claim
 * `amr` do JWT emitido pelo Supabase Auth (método "email/signup" do flow state
 * PKCE), nunca um parâmetro da URL.
 */
export async function isSignUpSession(supabase: SupabaseServerClient) {
  const { data, error } = await supabase.auth.getClaims()
  const amr: unknown = data?.claims?.amr

  if (error || !Array.isArray(amr)) {
    return false
  }

  const now = Math.floor(Date.now() / 1000)

  return amr.some((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) {
      return false
    }

    const { method, timestamp } = entry as {
      method?: unknown
      timestamp?: unknown
    }

    return (
      method === "email/signup" &&
      typeof timestamp === "number" &&
      now - timestamp <= SIGN_UP_AMR_WINDOW_SECONDS
    )
  })
}

/** Se o usuário da sessão atual já é membro de alguma imobiliária (RLS filtra por ele). */
async function userHasMembership(supabase: SupabaseServerClient) {
  const { data, error } = await supabase.from("memberships").select("id").limit(1)
  return !error && (data?.length ?? 0) > 0
}

/**
 * Destino final da confirmação de cadastro (/auth/callback e /auth/confirmar).
 * Só respeita um `next` de convite quando o usuário recém-confirmado ainda não
 * tem imobiliária; nos demais casos mantém o comportamento atual (onboarding).
 */
export async function resolveSignUpNext(supabase: SupabaseServerClient, next: string) {
  if (!next.startsWith(INVITATION_PATH_PREFIX)) {
    return ONBOARDING_PATH
  }

  return (await userHasMembership(supabase)) ? ONBOARDING_PATH : next
}
