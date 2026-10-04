// Rotas e regras de redirecionamento compartilhadas entre proxy, páginas e actions.

import { REFERRAL_LINK_PATH_PREFIX } from "@workspace/core/billing/referrals"
import { PROPOSAL_SHARE_PATH_PREFIX } from "@workspace/core/proposals/share"

export const LOGIN_PATH = "/entrar"
export const SIGN_UP_PATH = "/cadastro"
export const RECOVER_PASSWORD_PATH = "/recuperar-senha"
export const RESET_PASSWORD_PATH = "/redefinir-senha"
export const ONBOARDING_PATH = "/onboarding"
export const HOME_PATH = "/painel"

/** Escolha de imobiliária no domínio raiz (links para cada subdomínio). */
export const TENANT_PICKER_PATH = "/imobiliarias"

/** Tela "Você não tem acesso a esta imobiliária" no subdomínio. */
export const ACCESS_DENIED_PATH = "/sem-acesso"

/**
 * Página intermediária dos links com `token_hash` (/auth/confirm): o token só
 * é consumido depois do clique em "Continuar". Pública pelo prefixo "/auth".
 */
export const CONFIRM_LINK_PATH = "/auth/confirmar"

/** Prefixo das páginas públicas de convite (ver lib/configuracoes/invitations.ts). */
export const INVITATION_PATH_PREFIX = "/convite/"

/** Página pública de planos (Pagamentos/Assinatura): domínio raiz e host único. */
export const PLANS_PATH = "/planos"

/**
 * Versão de /planos para quem entrou (conta, imobiliária e botões de assinar).
 * O proxy reescreve /planos para cá quando há sessão: a versão sem login segue
 * estática (ISR) e a da conta é renderizada a cada pedido, sem piscar.
 */
export const PLANS_ACCOUNT_INTERNAL_PATH = "/planos/conta"

/** Parâmetro de /planos com o slug da imobiliária escolhida (modo subdomain, na raiz). */
export const PLANS_ORGANIZATION_PARAM = "imobiliaria"

/** Assinatura da imobiliária no CRM (rota normal, com membership). */
export const SUBSCRIPTION_SETTINGS_PATH = "/configuracoes/assinatura"

/**
 * Webhooks de serviços externos (ex.: Stripe). Públicos e sem sessão em
 * qualquer host: a autenticidade é conferida pela assinatura do provedor.
 */
export const WEBHOOKS_PATH_PREFIX = "/api/webhooks"

/**
 * Tarefas agendadas (Vercel Cron). Públicas e sem sessão em qualquer host: cada
 * rota confere `Authorization: Bearer CRON_SECRET`.
 */
export const CRON_PATH_PREFIX = "/api/cron"

/**
 * Área interna da equipe da plataforma (fora do CRM das imobiliárias). Atendida
 * no domínio raiz; quem não está em PLATFORM_ADMIN_EMAILS recebe 404 na própria
 * página e na rota (lib/plataforma/admin.ts).
 */
export const PLATFORM_ADMIN_PATH_PREFIX = "/plataforma"

/**
 * Página de status pública (/status) e seu JSON (/api/status, e a sonda
 * /api/status/ping chamada pelo banco a cada minuto). Públicas, sem sessão e
 * atendidas no domínio raiz: o cliente precisa ver o status mesmo sem conseguir
 * entrar.
 */
export const STATUS_PAGE_PATH = "/status"
export const STATUS_API_PATH_PREFIX = "/api/status"

/** Programa Indique e ganhe (dentro de configurações). */
export const REFERRALS_SETTINGS_PATH = "/configuracoes/indicacoes"

/**
 * Link público de indicação (/i/{código}, definido no core): grava o cookie
 * `ref` e leva ao cadastro.
 */
export { REFERRAL_LINK_PATH_PREFIX }

/**
 * Link público da proposta (/proposta/{token}, definido no core): o corretor
 * manda no WhatsApp e o cliente abre sem login. O token identifica a proposta,
 * então o caminho é o mesmo na raiz, no subdomínio e no host único.
 */
export { PROPOSAL_SHARE_PATH_PREFIX }

/** Service worker dos avisos no celular (public/sw.js, registrado por lib/push/client.ts). */
export const SERVICE_WORKER_PATH = "/sw.js"

/** Manifesto do app instalável: caminho que o Next gera para app/manifest.ts. */
export const WEB_MANIFEST_PATH = "/manifest.webmanifest"

/**
 * Arquivos do app instalável (PWA). O navegador os busca sem sessão (registro e
 * atualização do service worker, leitura do manifesto), em qualquer host: nunca
 * podem receber o redirecionamento para o login nem para a escolha de
 * imobiliária. O manifesto hoje nem passa pelo proxy (extensão fora do matcher);
 * fica aqui para continuar público se o matcher mudar.
 */
const PWA_PUBLIC_PATHS = [SERVICE_WORKER_PATH, WEB_MANIFEST_PATH]

/**
 * Portal público de leilões (home e páginas institucionais). Sem login, no
 * domínio raiz e no host único. A home "/" é exata (ver matchesPrefix).
 */
export const PORTAL_HOME_PATH = "/"
export const PORTAL_PREFIXES = [
  "/leiloes",
  "/como-funciona",
  "/credito",
  "/servicos",
  "/corretores",
  "/privacidade",
  "/anunciar",
  "/corretor",
  "/cotas",
  "/simulador",
  "/processos",
  "/assinar",
  "/parceiros",
  "/anuncie-gratis",
  "/imoveis-a-venda",
  "/outros-leiloes",
  "/quanto-vale-meu-imovel",
  "/autorizacao-de-venda",
  "/parceria-corretor",
  "/gestao",
  "/quem-somos",
  "/r",
  "/minha-conta",
  "/investidor",
  "/termo-indicacao",
  "/suporte",
  "/api/portal",
] as const

/** Caminhos exatos públicos. Também atendidos no domínio raiz (ROOT_HOST_PREFIXES). */
const PUBLIC_PATHS = new Set([
  PORTAL_HOME_PATH,
  LOGIN_PATH,
  SIGN_UP_PATH,
  RECOVER_PASSWORD_PATH,
  RESET_PASSWORD_PATH,
  PLANS_PATH,
  ...PWA_PUBLIC_PATHS,
])

/** `/lp` são as landing pages públicas das imobiliárias (tráfego pago e redes sociais). */
const PUBLIC_PREFIXES = [
  ...PORTAL_PREFIXES,
  "/auth",
  "/captar",
  "/api/feeds",
  WEBHOOKS_PATH_PREFIX,
  CRON_PATH_PREFIX,
  "/convite",
  "/lp",
  REFERRAL_LINK_PATH_PREFIX,
  PROPOSAL_SHARE_PATH_PREFIX,
  STATUS_PAGE_PATH,
  STATUS_API_PATH_PREFIX,
]

/** Rotas que só fazem sentido para quem ainda não entrou. */
const GUEST_ONLY_PATHS = new Set([LOGIN_PATH, SIGN_UP_PATH, RECOVER_PASSWORD_PATH])

/** Rotas atendidas só no domínio raiz: no subdomínio, redirecionam para a raiz. */
const ROOT_ONLY_PREFIXES = [ONBOARDING_PATH, TENANT_PICKER_PATH, PLANS_PATH]

/**
 * Rotas que o domínio raiz atende. As demais (CRM) levam à escolha de
 * imobiliária. /convite e o feed antigo continuam válidos na raiz por
 * compatibilidade com links já compartilhados.
 */
const ROOT_HOST_PREFIXES = [
  ...PUBLIC_PATHS,
  ...PORTAL_PREFIXES,
  "/auth",
  "/convite",
  "/api/feeds",
  WEBHOOKS_PATH_PREFIX,
  CRON_PATH_PREFIX,
  REFERRAL_LINK_PATH_PREFIX,
  PROPOSAL_SHARE_PATH_PREFIX,
  PLATFORM_ADMIN_PATH_PREFIX,
  STATUS_PAGE_PATH,
  STATUS_API_PATH_PREFIX,
  ...ROOT_ONLY_PREFIXES,
]

/**
 * Primeiro segmento aceito em `next` (allowlist): seções do CRM e fluxos de
 * conta. Ao criar uma seção nova no topo do app, inclua-a aqui; fora da lista,
 * o login leva ao destino padrão. Subpáginas herdam a seção (ex.:
 * /configuracoes/assinatura entra por "configuracoes").
 */
const REDIRECT_ALLOWED_SECTIONS = new Set([
  "agenda",
  "captacao",
  "chaves",
  "clientes",
  "comissoes",
  "condominios",
  "configuracoes",
  "imoveis",
  "leads",
  "marketing",
  "painel",
  "perfil",
  // Área interna da equipe da plataforma (link do lembrete por e-mail).
  "plataforma",
  "propostas",
  "tarefas",
  "onboarding",
  "imobiliarias",
  "convite",
  "redefinir-senha",
  "sem-acesso",
])

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "")
  }

  return pathname
}

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isPublicPath(pathname: string) {
  const path = normalizePathname(pathname)

  return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((prefix) => matchesPrefix(path, prefix))
}

/** Webhooks: sem sessão, sem tenant e sem redirecionamentos, em qualquer host. */
export function isWebhookPath(pathname: string) {
  return matchesPrefix(normalizePathname(pathname), WEBHOOKS_PATH_PREFIX)
}

/** Tarefas agendadas: sem sessão, sem tenant e sem redirecionamentos, em qualquer host. */
export function isCronPath(pathname: string) {
  return matchesPrefix(normalizePathname(pathname), CRON_PATH_PREFIX)
}

export function isGuestOnlyPath(pathname: string) {
  return GUEST_ONLY_PATHS.has(normalizePathname(pathname))
}

export function isRootOnlyPath(pathname: string) {
  const path = normalizePathname(pathname)
  return ROOT_ONLY_PREFIXES.some((prefix) => matchesPrefix(path, prefix))
}

export function isRootHostPath(pathname: string) {
  const path = normalizePathname(pathname)
  return ROOT_HOST_PREFIXES.some((prefix) => matchesPrefix(path, prefix))
}

/**
 * Aceita apenas caminhos relativos do próprio app (evita open redirect), cujo
 * primeiro segmento está na allowlist, e nunca devolve rotas que levariam a um
 * loop (login, cadastro, /auth/*).
 */
export function sanitizeRedirectPath(
  value: string | null | undefined,
  fallback: string = HOME_PATH
) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback
  }

  if (value.includes("\\")) {
    return fallback
  }

  try {
    const base = "http://app.local"
    const url = new URL(value, base)

    if (url.origin !== base) {
      return fallback
    }

    if (isGuestOnlyPath(url.pathname) || matchesPrefix(url.pathname, "/auth")) {
      return fallback
    }

    const section = url.pathname.split("/")[1] ?? ""

    if (!REDIRECT_ALLOWED_SECTIONS.has(section)) {
      return fallback
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

/** Anexa `?next=` a um caminho, para preservá-lo entre /entrar e /cadastro. */
export function appendNextParam(path: string, next: string | null | undefined) {
  if (!next) {
    return path
  }

  return `${path}?${new URLSearchParams({ next }).toString()}`
}
