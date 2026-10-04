import "server-only"

import type { PlatformEnvSnapshot } from "@workspace/core/platform/env"

/**
 * Retrato das variáveis de ambiente para a tela "Saúde do sistema".
 *
 * As referências são literais (`process.env.NOME`) de propósito: é assim que o
 * Next e o Turborepo enxergam cada variável. O retrato só passa para
 * `evaluatePlatformEnv` (packages/core), que devolve presença e estados; nenhum
 * valor sai deste servidor nem vai para a tela ou para log.
 */
export function readPlatformEnvSnapshot(): PlatformEnvSnapshot {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    NEXT_PUBLIC_SUPPORT_WHATSAPP: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP,
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    CRON_SECRET: process.env.CRON_SECRET,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    BILLING_SERVER_KEY: process.env.BILLING_SERVER_KEY,
    CAPTURE_FORM_SECRET: process.env.CAPTURE_FORM_SECRET,
    CAPTURE_SERVER_KEY: process.env.CAPTURE_SERVER_KEY,
    LEAD_SERVER_KEY: process.env.LEAD_SERVER_KEY,
    NOTIFICATION_SERVER_KEY: process.env.NOTIFICATION_SERVER_KEY,
    CAIXA_SERVER_KEY: process.env.CAIXA_SERVER_KEY,
    LEAD_INGEST_SERVER_KEY: process.env.LEAD_INGEST_SERVER_KEY,
    CONNECTIONS_SERVER_KEY: process.env.CONNECTIONS_SERVER_KEY,
    ORGANIZATION_DELETION_SERVER_KEY: process.env.ORGANIZATION_DELETION_SERVER_KEY,
    PLATFORM_SERVER_KEY: process.env.PLATFORM_SERVER_KEY,
    PLATFORM_ADMIN_EMAILS: process.env.PLATFORM_ADMIN_EMAILS,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN,
    NEXT_PUBLIC_META_APP_ID: process.env.NEXT_PUBLIC_META_APP_ID,
    NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID: process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  }
}

/** Build de produção: e-mail simulado e endereço do site ausente viram problema. */
export function isProductionBuild(): boolean {
  return process.env.NODE_ENV === "production"
}
