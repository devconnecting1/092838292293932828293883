import { describe, expect, it } from "vitest"

import {
  detectStripeKeyMode,
  evaluatePlatformEnv,
  PLATFORM_ENV_NAMES,
  type PlatformEnvSnapshot,
} from "./env"

// Valores falsos, só com o formato certo: o teste confere que nenhum deles
// aparece na saída.
const FULL: PlatformEnvSnapshot = {
  NEXT_PUBLIC_SUPABASE_URL: "https://projeto-falso.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_valorfalso123",
  NEXT_PUBLIC_SITE_URL: "https://crm-falso.example",
  NEXT_PUBLIC_SUPPORT_WHATSAPP: "5511900000000",
  CRON_SECRET: "cron-segredo-falso-0001",
  BREVO_API_KEY: "xkeysib-valorfalso0002",
  EMAIL_FROM_ADDRESS: "avisos@crm-falso.example",
  STRIPE_SECRET_KEY: "rk_test_valorfalso0003",
  STRIPE_WEBHOOK_SECRET: "whsec_valorfalso0004",
  BILLING_SERVER_KEY: "billing-falso-0005",
  CAPTURE_FORM_SECRET: "captura-form-falso-0006",
  CAPTURE_SERVER_KEY: "captura-falso-0007",
  LEAD_SERVER_KEY: "lead-falso-0008",
  NOTIFICATION_SERVER_KEY: "notificacao-falso-0009",
  CAIXA_SERVER_KEY: "caixa-falso-0010",
  LEAD_INGEST_SERVER_KEY: "ingest-falso-0011",
  CONNECTIONS_SERVER_KEY: "conexoes-falso-0012",
  ORGANIZATION_DELETION_SERVER_KEY: "exclusao-falso-0013",
  PLATFORM_SERVER_KEY: "plataforma-falso-0013",
  PLATFORM_ADMIN_EMAILS: "equipe@crm-falso.example, outra@crm-falso.example",
  META_APP_SECRET: "meta-falso-0014",
  META_WEBHOOK_VERIFY_TOKEN: "meta-token-falso-0015",
  NEXT_PUBLIC_META_APP_ID: "123456",
  NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID: "654321",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: `B${"A".repeat(86)}`,
  VAPID_PRIVATE_KEY: "C".repeat(43),
  VAPID_SUBJECT: "mailto:suporte@crm-falso.example",
}

function byKey(env: PlatformEnvSnapshot, production = true) {
  return new Map(evaluatePlatformEnv(env, { production }).map((entry) => [entry.key, entry]))
}

describe("detectStripeKeyMode", () => {
  it("reconhece teste e produção pelo prefixo, sem olhar o resto", () => {
    expect(detectStripeKeyMode("sk_test_abc")).toBe("teste")
    expect(detectStripeKeyMode("rk_test_abc")).toBe("teste")
    expect(detectStripeKeyMode("sk_live_abc")).toBe("producao")
    expect(detectStripeKeyMode("rk_live_abc")).toBe("producao")
    expect(detectStripeKeyMode("pk_test_abc")).toBe("desconhecido")
    expect(detectStripeKeyMode("  ")).toBeNull()
    expect(detectStripeKeyMode(undefined)).toBeNull()
  })
})

describe("evaluatePlatformEnv", () => {
  it("com tudo configurado não há problema nem atenção", () => {
    const items = evaluatePlatformEnv(FULL, { production: true })

    expect(items.filter((entry) => entry.status !== "ok")).toEqual([])
  })

  it("nunca devolve o valor de nenhuma variável", () => {
    const output = JSON.stringify([
      evaluatePlatformEnv(FULL, { production: true }),
      evaluatePlatformEnv(
        { ...FULL, BREVO_API_KEY: "xsmtpsib-valorfalso0099", STRIPE_SECRET_KEY: "zz_valor0098" },
        { production: true }
      ),
    ])

    for (const value of Object.values(FULL)) {
      if (typeof value === "string" && value.length > 6) {
        expect(output).not.toContain(value)
      }
    }

    expect(output).not.toContain("valorfalso0099")
    expect(output).not.toContain("valor0098")
    expect(output).not.toContain("crm-falso.example")
  })

  it("sem nada, as obrigatórias viram problema", () => {
    const items = byKey({})

    for (const key of [
      "env_supabase_url",
      "env_supabase_key",
      "env_site_url",
      "env_cron_secret",
      "env_email",
      "env_platform_server_key",
      "env_notification_server_key",
      "env_lead_server_key",
      "env_capture_server_key",
      "env_capture_form_secret",
      "env_platform_admin_emails",
    ]) {
      expect(items.get(key)?.status, key).toBe("problema")
      expect(items.get(key)?.action, key).toBeTruthy()
    }

    // Opcionais desligados não pedem ação.
    for (const key of [
      "env_lead_ingest_server_key",
      "env_connections_server_key",
      "env_meta_webhooks",
      "env_meta_signup",
      "env_vapid",
      "env_stripe_webhook_secret",
    ]) {
      expect(items.get(key)?.status, key).toBe("ok")
    }

    expect(items.get("env_stripe_secret_key")?.status).toBe("atencao")
    expect(items.get("env_billing_server_key")?.status).toBe("atencao")
    expect(items.get("env_caixa_server_key")?.status).toBe("atencao")
    expect(items.get("env_support")?.status).toBe("atencao")
  })

  it("e-mail simulado é problema em produção e atenção fora dela", () => {
    const env = { ...FULL, BREVO_API_KEY: "" }

    expect(byKey(env, true).get("env_email")?.status).toBe("problema")
    expect(byKey(env, false).get("env_email")?.status).toBe("atencao")
  })

  it("chave SMTP da Brevo, remetente ausente e remetente gratuito", () => {
    expect(byKey({ ...FULL, BREVO_API_KEY: "xsmtpsib-abc" }).get("env_email")?.status).toBe(
      "problema"
    )
    expect(byKey({ ...FULL, EMAIL_FROM_ADDRESS: "" }).get("env_email")?.status).toBe("problema")

    const free = byKey({ ...FULL, EMAIL_FROM_ADDRESS: "plataforma@gmail.com" }).get("env_email")
    expect(free?.status).toBe("atencao")
    expect(free?.detail).toContain("@brevosend.com")
  })

  it("Stripe: modo, webhook e chave das assinaturas", () => {
    const live = byKey({ ...FULL, STRIPE_SECRET_KEY: "sk_live_abc" })
    expect(live.get("env_stripe_secret_key")?.detail).toContain("modo produção")

    const test = byKey(FULL)
    expect(test.get("env_stripe_secret_key")?.detail).toContain("modo teste")

    const noWebhook = byKey({ ...FULL, STRIPE_WEBHOOK_SECRET: "" })
    expect(noWebhook.get("env_stripe_webhook_secret")?.status).toBe("problema")

    const oddWebhook = byKey({ ...FULL, STRIPE_WEBHOOK_SECRET: "abc" })
    expect(oddWebhook.get("env_stripe_webhook_secret")?.status).toBe("atencao")

    const noBilling = byKey({ ...FULL, BILLING_SERVER_KEY: "" })
    expect(noBilling.get("env_billing_server_key")?.status).toBe("problema")

    const unknown = byKey({ ...FULL, STRIPE_SECRET_KEY: "abc" })
    expect(unknown.get("env_stripe_secret_key")?.status).toBe("problema")
  })

  it("grupos pela metade viram atenção ou problema", () => {
    const partial = byKey({
      ...FULL,
      META_WEBHOOK_VERIFY_TOKEN: "",
      NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID: "",
      VAPID_SUBJECT: "",
    })

    expect(partial.get("env_meta_webhooks")?.status).toBe("problema")
    expect(partial.get("env_meta_webhooks")?.detail).toContain("META_WEBHOOK_VERIFY_TOKEN")
    expect(partial.get("env_meta_signup")?.status).toBe("atencao")
    expect(partial.get("env_vapid")?.status).toBe("atencao")
  })

  it("VAPID completo mas inválido vira atenção", () => {
    const invalid = byKey({ ...FULL, VAPID_SUBJECT: "https://localhost:3000" })
    expect(invalid.get("env_vapid")?.status).toBe("atencao")
  })

  it("chave anon legada e URL inválida", () => {
    const legacy = byKey({
      ...FULL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJ",
    })
    expect(legacy.get("env_supabase_key")?.status).toBe("atencao")

    const badUrl = byKey({ ...FULL, NEXT_PUBLIC_SUPABASE_URL: "projeto.supabase.co" })
    expect(badUrl.get("env_supabase_url")?.status).toBe("problema")
  })

  it("URL do site cai na da Vercel quando não definida", () => {
    const vercel = byKey({
      ...FULL,
      NEXT_PUBLIC_SITE_URL: "",
      VERCEL_PROJECT_PRODUCTION_URL: "crm.vercel.app",
    })
    expect(vercel.get("env_site_url")?.status).toBe("ok")
  })

  it("conta os e-mails da equipe sem mostrá-los", () => {
    const admins = byKey(FULL).get("env_platform_admin_emails")
    expect(admins?.detail).toContain("2 e-mails")
  })

  it("todas as variáveis verificadas existem na lista", () => {
    const output = JSON.stringify(evaluatePlatformEnv({}, { production: true }))

    for (const name of PLATFORM_ENV_NAMES) {
      if (name !== "NEXT_PUBLIC_SUPABASE_ANON_KEY" && name !== "VERCEL_PROJECT_PRODUCTION_URL") {
        expect(output, name).toContain(name)
      }
    }
  })
})
