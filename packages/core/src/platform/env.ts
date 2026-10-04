/**
 * Console da Plataforma — variáveis de ambiente do servidor.
 *
 * Só verifica PRESENÇA (e, quando ajuda a agir, o formato ou o modo pelo
 * prefixo). Nenhum item devolvido contém o valor da variável: o servidor monta
 * o retrato com `process.env` e esta função devolve só estados e textos.
 */

import { parsePlatformAdminEmails } from "../caixa/platform-admins"
import { pluralize, type HealthItem, type HealthStatus } from "./health"

/** Variáveis lidas pelo console. Espelha apps/web/.env.example e turbo.json. */
export const PLATFORM_ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_SUPPORT_WHATSAPP",
  "NEXT_PUBLIC_SUPPORT_EMAIL",
  "CRON_SECRET",
  "BREVO_API_KEY",
  "EMAIL_FROM_ADDRESS",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "BILLING_SERVER_KEY",
  "CAPTURE_FORM_SECRET",
  "CAPTURE_SERVER_KEY",
  "LEAD_SERVER_KEY",
  "NOTIFICATION_SERVER_KEY",
  "CAIXA_SERVER_KEY",
  "LEAD_INGEST_SERVER_KEY",
  "CONNECTIONS_SERVER_KEY",
  "ORGANIZATION_DELETION_SERVER_KEY",
  "PLATFORM_SERVER_KEY",
  "PLATFORM_ADMIN_EMAILS",
  "META_APP_SECRET",
  "META_WEBHOOK_VERIFY_TOKEN",
  "NEXT_PUBLIC_META_APP_ID",
  "NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const

export type PlatformEnvName = (typeof PLATFORM_ENV_NAMES)[number]

export type PlatformEnvSnapshot = Partial<Record<PlatformEnvName, string | null | undefined>>

export type PlatformEnvOptions = {
  /** Build de produção (NODE_ENV=production): e-mail simulado vira problema. */
  production: boolean
}

export type StripeKeyMode = "teste" | "producao" | "desconhecido"

export const STRIPE_KEY_MODE_LABELS: Record<StripeKeyMode, string> = {
  teste: "Modo teste",
  producao: "Modo produção",
  desconhecido: "Modo não reconhecido",
}

/**
 * Modo da chave da Stripe pelo prefixo (https://docs.stripe.com/keys): chaves
 * de teste começam com `sk_test_`/`rk_test_`, de produção com `sk_live_`/
 * `rk_live_`. Null quando a variável está vazia.
 */
export function detectStripeKeyMode(value: string | null | undefined): StripeKeyMode | null {
  const key = value?.trim() ?? ""

  if (!key) {
    return null
  }

  if (/^(sk|rk)_test_/.test(key)) {
    return "teste"
  }

  if (/^(sk|rk)_live_/.test(key)) {
    return "producao"
  }

  return "desconhecido"
}

/**
 * Domínios de e-mail gratuitos: não dá para autenticar domínio na Brevo, e sem
 * domínio autenticado a Brevo troca o remetente por @brevosend.com
 * (https://help.brevo.com/hc/en-us/articles/16045394674066).
 */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "bol.com.br",
  "uol.com.br",
])

function has(env: PlatformEnvSnapshot, name: PlatformEnvName): boolean {
  return (env[name]?.trim() ?? "").length > 0
}

function read(env: PlatformEnvSnapshot, name: PlatformEnvName): string {
  return env[name]?.trim() ?? ""
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

function item(
  key: string,
  label: string,
  reference: string | null,
  status: HealthStatus,
  detail: string,
  action: string | null = null
): HealthItem {
  return { key, label, reference, status, detail, action }
}

const DEPLOY_HINT = "cadastre nas variáveis do projeto na Vercel e refaça o deploy"

type ServerKeySpec = {
  env: PlatformEnvName
  vault: string | null
  label: string
  /** Consequência da falta, em pt-BR. */
  missing: string
  /** Estado quando falta. `ok` = recurso opcional desligado. */
  missingStatus: HealthStatus
}

const SERVER_KEYS: readonly ServerKeySpec[] = [
  {
    env: "PLATFORM_SERVER_KEY",
    vault: "platform_server_key",
    label: "Chave do Console da Plataforma",
    missing: "Este console não consegue ler os dados globais (rotinas, filas e assinaturas).",
    missingStatus: "problema",
  },
  {
    env: "NOTIFICATION_SERVER_KEY",
    vault: "notification_server_key",
    label: "Chave das filas de avisos",
    missing:
      "Avisos de lead, lembretes de visita, resumos diários, relatório semanal e push não saem.",
    missingStatus: "problema",
  },
  {
    env: "LEAD_SERVER_KEY",
    vault: "lead_server_key",
    label: "Chave dos leads das páginas públicas",
    missing: "Landing pages e a página pública do imóvel não recebem leads.",
    missingStatus: "problema",
  },
  {
    env: "CAPTURE_SERVER_KEY",
    vault: "capture_server_key",
    label: "Chave do formulário de captação",
    missing: "O formulário público de captação (/captar) falha em todo envio.",
    missingStatus: "problema",
  },
  {
    env: "CAPTURE_FORM_SECRET",
    vault: null,
    label: "Segredo antirrobô da captação",
    missing: "O formulário público de captação recusa os envios.",
    missingStatus: "problema",
  },
  {
    env: "CAIXA_SERVER_KEY",
    vault: "caixa_server_key",
    label: "Chave do catálogo da Caixa",
    missing: "O envio da lista da Caixa não grava nada e o lembrete diário não lê a última carga.",
    missingStatus: "atencao",
  },
  {
    env: "LEAD_INGEST_SERVER_KEY",
    vault: "lead_ingest_server_key",
    label: "Chave da entrada de leads de portais e anúncios",
    missing: "Entrada de leads do Canal Pro e do Meta Lead Ads desligada (opcional).",
    missingStatus: "ok",
  },
  {
    env: "CONNECTIONS_SERVER_KEY",
    vault: "connections_server_key",
    label: "Chave das contas conectadas",
    missing: "WhatsApp oficial e contas conectadas desligados (opcional).",
    missingStatus: "ok",
  },
  {
    env: "ORGANIZATION_DELETION_SERVER_KEY",
    vault: "organization_deletion_server_key",
    label: "Chave da exclusão de imobiliária",
    missing:
      "Imobiliária com exclusão agendada não recebe o aviso de 3 dias e os arquivos dela ficam no Storage depois da exclusão.",
    missingStatus: "atencao",
  },
]

function serverKeyAction(spec: ServerKeySpec): string {
  if (spec.vault) {
    return (
      `Copie o valor do segredo ${spec.vault} do Vault do Supabase ` +
      `(select decrypted_secret from vault.decrypted_secrets where name = '${spec.vault}') ` +
      `para ${spec.env}, ${DEPLOY_HINT}.`
    )
  }

  return `Gere 32 bytes aleatórios em hexadecimal para ${spec.env}, ${DEPLOY_HINT}.`
}

function evaluateServerKey(env: PlatformEnvSnapshot, spec: ServerKeySpec): HealthItem {
  const key = `env_${spec.env.toLowerCase()}`

  if (has(env, spec.env)) {
    return item(key, spec.label, spec.env, "ok", "Definida.")
  }

  return item(
    key,
    spec.label,
    spec.env,
    spec.missingStatus,
    `Não definida. ${spec.missing}`,
    spec.missingStatus === "ok" ? null : serverKeyAction(spec)
  )
}

function evaluateSupabase(env: PlatformEnvSnapshot): HealthItem[] {
  const url = read(env, "NEXT_PUBLIC_SUPABASE_URL")
  const urlItem = !url
    ? item(
        "env_supabase_url",
        "Endereço do banco",
        "NEXT_PUBLIC_SUPABASE_URL",
        "problema",
        "Não definida. O app não conecta ao banco.",
        `Copie a URL do projeto (Supabase > Project Settings > Data API) para NEXT_PUBLIC_SUPABASE_URL, ${DEPLOY_HINT}.`
      )
    : isHttpUrl(url)
      ? item("env_supabase_url", "Endereço do banco", "NEXT_PUBLIC_SUPABASE_URL", "ok", "Definida.")
      : item(
          "env_supabase_url",
          "Endereço do banco",
          "NEXT_PUBLIC_SUPABASE_URL",
          "problema",
          "Definida, mas não é um endereço http(s) válido.",
          "Confira a URL do projeto no Supabase (Project Settings > Data API)."
        )

  const keyItem = has(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    ? item(
        "env_supabase_key",
        "Chave publicável do banco",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "ok",
        "Definida."
      )
    : has(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY")
      ? item(
          "env_supabase_key",
          "Chave publicável do banco",
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          "atencao",
          "Usando a chave anon legada (NEXT_PUBLIC_SUPABASE_ANON_KEY).",
          `Troque pela chave publicável (sb_publishable_...) em NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ${DEPLOY_HINT}.`
        )
      : item(
          "env_supabase_key",
          "Chave publicável do banco",
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          "problema",
          "Não definida. O app não conecta ao banco.",
          `Copie a chave publicável (Supabase > Project Settings > API Keys), ${DEPLOY_HINT}.`
        )

  return [urlItem, keyItem]
}

function evaluateSiteUrl(env: PlatformEnvSnapshot, options: PlatformEnvOptions): HealthItem {
  if (has(env, "NEXT_PUBLIC_SITE_URL")) {
    return item("env_site_url", "Endereço do site", "NEXT_PUBLIC_SITE_URL", "ok", "Definida.")
  }

  if (has(env, "VERCEL_PROJECT_PRODUCTION_URL")) {
    return item(
      "env_site_url",
      "Endereço do site",
      "NEXT_PUBLIC_SITE_URL",
      "ok",
      "Não definida; os links usam a URL de produção informada pela Vercel."
    )
  }

  return item(
    "env_site_url",
    "Endereço do site",
    "NEXT_PUBLIC_SITE_URL",
    options.production ? "problema" : "atencao",
    "Não definida. Links de e-mail, convites e páginas públicas podem apontar para o endereço errado.",
    `Defina a origem pública do site, sem barra no final, ${DEPLOY_HINT}.`
  )
}

function evaluateCronSecret(env: PlatformEnvSnapshot): HealthItem {
  return has(env, "CRON_SECRET")
    ? item("env_cron_secret", "Segredo das rotinas agendadas", "CRON_SECRET", "ok", "Definida.")
    : item(
        "env_cron_secret",
        "Segredo das rotinas agendadas",
        "CRON_SECRET",
        "problema",
        "Não definida. As rotinas da Vercel (/api/cron/*) recusam todas as chamadas.",
        `Gere 32 bytes aleatórios em hexadecimal para CRON_SECRET, ${DEPLOY_HINT}. Use o mesmo valor nos segredos *_webhook_secret do Vault.`
      )
}

function evaluateEmail(env: PlatformEnvSnapshot, options: PlatformEnvOptions): HealthItem {
  const key = read(env, "BREVO_API_KEY")
  const from = read(env, "EMAIL_FROM_ADDRESS").toLowerCase()
  const reference = "BREVO_API_KEY, EMAIL_FROM_ADDRESS"
  const label = "E-mail (Brevo)"

  if (!key) {
    return item(
      "env_email",
      label,
      reference,
      options.production ? "problema" : "atencao",
      "BREVO_API_KEY não definida: os e-mails ficam em modo simulado e nada é enviado.",
      `Crie a API key v3 na Brevo (SMTP & API > API Keys) e cadastre em BREVO_API_KEY, com o remetente em EMAIL_FROM_ADDRESS; ${DEPLOY_HINT}.`
    )
  }

  if (key.startsWith("xsmtpsib-")) {
    return item(
      "env_email",
      label,
      reference,
      "problema",
      "BREVO_API_KEY tem a chave SMTP, não a API key v3: os envios falham.",
      `Troque pela API key v3 (começa com xkeysib-), ${DEPLOY_HINT}.`
    )
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
    return item(
      "env_email",
      label,
      reference,
      "problema",
      "EMAIL_FROM_ADDRESS ausente ou inválida: os envios pela Brevo ficam desativados.",
      `Cadastre em EMAIL_FROM_ADDRESS um remetente confirmado na Brevo, ${DEPLOY_HINT}.`
    )
  }

  const domain = from.slice(from.lastIndexOf("@") + 1)

  if (FREE_MAIL_DOMAINS.has(domain)) {
    return item(
      "env_email",
      label,
      reference,
      "atencao",
      "Brevo configurada, mas o remetente é de e-mail gratuito: sem domínio autenticado a Brevo troca o endereço por @brevosend.com.",
      "Quando houver domínio próprio, autentique-o na Brevo (DKIM e DMARC) e use um remetente desse domínio."
    )
  }

  return item("env_email", label, reference, "ok", "Brevo configurada, com remetente definido.")
}

function evaluateStripe(env: PlatformEnvSnapshot): HealthItem[] {
  const mode = detectStripeKeyMode(env.STRIPE_SECRET_KEY)
  const items: HealthItem[] = []

  if (mode === null) {
    items.push(
      item(
        "env_stripe_secret_key",
        "Pagamentos (Stripe)",
        "STRIPE_SECRET_KEY",
        "atencao",
        "Não definida: a tela de assinatura mostra os preços e avisa que o pagamento ainda não está ativo.",
        `Crie uma chave restrita na Stripe (veja apps/web/.env.example) e cadastre em STRIPE_SECRET_KEY, ${DEPLOY_HINT}.`
      )
    )
  } else if (mode === "desconhecido") {
    items.push(
      item(
        "env_stripe_secret_key",
        "Pagamentos (Stripe)",
        "STRIPE_SECRET_KEY",
        "problema",
        "Definida, mas o formato não é de chave secreta ou restrita da Stripe.",
        "Use a chave restrita (rk_test_... ou rk_live_...) criada no painel da Stripe."
      )
    )
  } else {
    items.push(
      item(
        "env_stripe_secret_key",
        "Pagamentos (Stripe)",
        "STRIPE_SECRET_KEY",
        "ok",
        mode === "teste"
          ? "Definida, em modo teste: nenhuma cobrança é real."
          : "Definida, em modo produção: as cobranças são reais."
      )
    )
  }

  const webhook = read(env, "STRIPE_WEBHOOK_SECRET")

  if (mode === null) {
    items.push(
      item(
        "env_stripe_webhook_secret",
        "Webhook da Stripe",
        "STRIPE_WEBHOOK_SECRET",
        "ok",
        webhook ? "Definida." : "Não definida (só é necessária com a Stripe ligada)."
      )
    )
  } else if (!webhook) {
    items.push(
      item(
        "env_stripe_webhook_secret",
        "Webhook da Stripe",
        "STRIPE_WEBHOOK_SECRET",
        "problema",
        "Não definida: as assinaturas pagas não são sincronizadas com o CRM.",
        `Copie o segredo de assinatura (whsec_...) do endpoint /api/webhooks/stripe no painel da Stripe, ${DEPLOY_HINT}.`
      )
    )
  } else if (!webhook.startsWith("whsec_")) {
    items.push(
      item(
        "env_stripe_webhook_secret",
        "Webhook da Stripe",
        "STRIPE_WEBHOOK_SECRET",
        "atencao",
        "Definida, mas não começa com whsec_: a conferência da assinatura do webhook vai falhar.",
        "Copie o segredo de assinatura do endpoint no painel da Stripe (Developers > Webhooks)."
      )
    )
  } else {
    items.push(
      item(
        "env_stripe_webhook_secret",
        "Webhook da Stripe",
        "STRIPE_WEBHOOK_SECRET",
        "ok",
        "Definida."
      )
    )
  }

  items.push(
    evaluateServerKey(env, {
      env: "BILLING_SERVER_KEY",
      vault: "billing_server_key",
      label: "Chave das assinaturas",
      missing:
        "Faturas, sincronização da assinatura, avisos de cobrança e Indique e ganhe desativados.",
      missingStatus: mode === null ? "atencao" : "problema",
    })
  )

  return items
}

function evaluateAdmins(env: PlatformEnvSnapshot): HealthItem {
  const count = parsePlatformAdminEmails(env.PLATFORM_ADMIN_EMAILS).size

  return count > 0
    ? item(
        "env_platform_admin_emails",
        "Equipe da plataforma",
        "PLATFORM_ADMIN_EMAILS",
        "ok",
        `${pluralize(count, "e-mail", "e-mails")} com acesso a este console.`
      )
    : item(
        "env_platform_admin_emails",
        "Equipe da plataforma",
        "PLATFORM_ADMIN_EMAILS",
        "problema",
        "Nenhum e-mail válido: ninguém entra neste console nem recebe o lembrete da Caixa.",
        `Liste os e-mails da equipe separados por vírgula, ${DEPLOY_HINT}.`
      )
}

function evaluateGroup(
  env: PlatformEnvSnapshot,
  spec: {
    key: string
    label: string
    names: readonly PlatformEnvName[]
    off: string
    on: string
    partial: string
    partialStatus: HealthStatus
    action: string
  }
): HealthItem {
  const missing = spec.names.filter((name) => !has(env, name))
  const reference = spec.names.join(", ")

  if (missing.length === spec.names.length) {
    return item(spec.key, spec.label, reference, "ok", spec.off)
  }

  if (missing.length === 0) {
    return item(spec.key, spec.label, reference, "ok", spec.on)
  }

  return item(
    spec.key,
    spec.label,
    reference,
    spec.partialStatus,
    `${spec.partial} Falta: ${missing.join(", ")}.`,
    spec.action
  )
}

const VAPID_NAMES = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const

/** Formato das chaves VAPID (base64url) e do contato, como em apps/web/lib/push/config.ts. */
function isValidVapid(env: PlatformEnvSnapshot): boolean {
  const publicKey = read(env, "NEXT_PUBLIC_VAPID_PUBLIC_KEY").replace(/=+$/, "")
  const privateKey = read(env, "VAPID_PRIVATE_KEY").replace(/=+$/, "")
  const subject = read(env, "VAPID_SUBJECT")

  return (
    /^[A-Za-z0-9_-]{86,88}$/.test(publicKey) &&
    /^[A-Za-z0-9_-]{42,44}$/.test(privateKey) &&
    /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/(?!localhost[:/]|localhost$)\S+)$/.test(subject)
  )
}

function evaluateVapid(env: PlatformEnvSnapshot): HealthItem {
  const complete = VAPID_NAMES.every((name) => has(env, name))

  if (complete && !isValidVapid(env)) {
    return item(
      "env_vapid",
      "Avisos no celular (push)",
      VAPID_NAMES.join(", "),
      "atencao",
      "Preenchidas, mas alguma está em formato inválido: os avisos no celular ficam desligados.",
      "Confira as chaves VAPID (pública com 87 caracteres, privada com 43) e o VAPID_SUBJECT (mailto: ou https, sem localhost)."
    )
  }

  return evaluateGroup(env, {
    key: "env_vapid",
    label: "Avisos no celular (push)",
    names: VAPID_NAMES,
    off: "Não configurados (opcional): a opção fica escondida em Meu perfil.",
    on: "Configurados.",
    partial: "Configuração incompleta: os avisos no celular ficam desligados.",
    partialStatus: "atencao",
    action: `Gere o par com \`npx web-push generate-vapid-keys\` e preencha as três variáveis, ${DEPLOY_HINT}.`,
  })
}

function evaluateSupport(env: PlatformEnvSnapshot): HealthItem {
  return has(env, "NEXT_PUBLIC_SUPPORT_WHATSAPP") || has(env, "NEXT_PUBLIC_SUPPORT_EMAIL")
    ? item(
        "env_support",
        "Contato do suporte",
        "NEXT_PUBLIC_SUPPORT_WHATSAPP, NEXT_PUBLIC_SUPPORT_EMAIL",
        "ok",
        "Definido: o botão Ajuda aparece no CRM."
      )
    : item(
        "env_support",
        "Contato do suporte",
        "NEXT_PUBLIC_SUPPORT_WHATSAPP, NEXT_PUBLIC_SUPPORT_EMAIL",
        "atencao",
        "Nenhum definido: o botão Ajuda não aparece para as imobiliárias.",
        `Cadastre o WhatsApp (só dígitos, com DDI) ou o e-mail do atendimento, ${DEPLOY_HINT}.`
      )
}

/** Itens de saúde das variáveis de ambiente, sem nenhum valor. */
export function evaluatePlatformEnv(
  env: PlatformEnvSnapshot,
  options: PlatformEnvOptions
): HealthItem[] {
  return [
    ...evaluateSupabase(env),
    evaluateSiteUrl(env, options),
    evaluateCronSecret(env),
    evaluateEmail(env, options),
    ...evaluateStripe(env),
    ...SERVER_KEYS.map((spec) => evaluateServerKey(env, spec)),
    evaluateAdmins(env),
    evaluateGroup(env, {
      key: "env_meta_webhooks",
      label: "Webhooks da Meta",
      names: ["META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN"],
      off: "Não configurados (opcional): Lead Ads e WhatsApp oficial desligados.",
      on: "Configurados.",
      partial: "Configuração incompleta: os webhooks da Meta respondem 503.",
      partialStatus: "problema",
      action: `Preencha as duas variáveis com os dados do app da Meta, ${DEPLOY_HINT}.`,
    }),
    evaluateGroup(env, {
      key: "env_meta_signup",
      label: "Conexão do WhatsApp oficial",
      names: ["NEXT_PUBLIC_META_APP_ID", "NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID"],
      off: "Não configurada (opcional): a tela de Conexões mostra configuração pendente.",
      on: "Configurada.",
      partial: "Configuração incompleta: a tela de Conexões não oferece o botão de conectar.",
      partialStatus: "atencao",
      action: `Preencha o ID do app e o Configuration ID do Embedded Signup, ${DEPLOY_HINT}.`,
    }),
    evaluateVapid(env),
    evaluateSupport(env),
  ]
}
