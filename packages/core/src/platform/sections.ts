/**
 * Console da Plataforma — montagem das seções da tela "Saúde do sistema".
 *
 * Junta o que o servidor já leu (variáveis, retrato do banco, última carga da
 * Caixa) nas seções da tela, na ordem de leitura. Sem o banco (chave ausente
 * ou recusada), as seções que dependem dele aparecem como indisponíveis com o
 * motivo, e o resto continua valendo.
 */

import { evaluateBilling, evaluateStripeMode } from "./billing"
import { evaluateCaixaLoad, type CaixaLoadHealthInput } from "./caixa"
import { evaluateDatabaseCronJob, evaluateVercelCrons } from "./cron"
import { detectStripeKeyMode, evaluatePlatformEnv, type PlatformEnvSnapshot } from "./env"
import { buildHealthSection, type HealthSection } from "./health"
import { evaluateQueues } from "./queues"
import type { PlatformHealthSnapshot } from "./snapshot"
import { evaluateVaultSecrets } from "./vault"

export type PlatformHealthSource<T> = { ok: true; value: T } | { ok: false; reason: string }

export type PlatformHealthInput = {
  now: Date
  env: PlatformEnvSnapshot
  production: boolean
  database: PlatformHealthSource<PlatformHealthSnapshot>
  caixa: PlatformHealthSource<CaixaLoadHealthInput | null>
}

export const PLATFORM_HEALTH_PART_UNAVAILABLE =
  "O banco não conseguiu calcular esta parte agora. Tente atualizar em instantes."

function databasePart<T>(
  database: PlatformHealthInput["database"],
  pick: (snapshot: PlatformHealthSnapshot) => T | null
): { value: T; unavailable: null } | { value: null; unavailable: string } {
  if (!database.ok) {
    return { value: null, unavailable: database.reason }
  }

  const value = pick(database.value)
  return value === null
    ? { value: null, unavailable: PLATFORM_HEALTH_PART_UNAVAILABLE }
    : { value, unavailable: null }
}

export function buildPlatformHealthSections(input: PlatformHealthInput): HealthSection[] {
  const { now, env, database } = input
  const cron = databasePart(database, (snapshot) => snapshot.cronJobs)
  const vault = databasePart(database, (snapshot) => snapshot.vaultSecrets)
  const queues = databasePart(database, (snapshot) => snapshot.queues)
  const billing = databasePart(database, (snapshot) => snapshot.billing)

  return [
    buildHealthSection({
      key: "variaveis",
      title: "Variáveis de ambiente",
      description:
        "Só a presença no servidor, nunca o valor. Mudou alguma? Refaça o deploy na Vercel.",
      items: evaluatePlatformEnv(env, { production: input.production }),
    }),
    buildHealthSection({
      key: "rotinas_banco",
      title: "Rotinas do banco",
      description: "Jobs do pg_cron no Supabase: última execução e falhas nas últimas 24 horas.",
      items: cron.value?.map((job) => evaluateDatabaseCronJob(job, now)) ?? [],
      unavailable: cron.unavailable,
    }),
    buildHealthSection({
      key: "vault",
      title: "Segredos do Vault",
      description:
        "Só se cada segredo existe, pelo nome. Os webhooks fazem os avisos saírem em minutos.",
      items: vault.value ? evaluateVaultSecrets(vault.value) : [],
      unavailable: vault.unavailable,
    }),
    buildHealthSection({
      key: "filas",
      title: "Filas de envio",
      description: "Só contagens: pendentes, parados e com erro em cada fila.",
      items: queues.value ? evaluateQueues(queues.value, now) : [],
      unavailable: queues.unavailable,
    }),
    buildHealthSection({
      key: "rotinas_vercel",
      title: "Rotinas da Vercel",
      description:
        "Agendas de apps/web/vercel.json. No plano Hobby cada rotina roda no máximo 1 vez por dia, em qualquer minuto da hora marcada.",
      items: evaluateVercelCrons({ hasCronSecret: (env.CRON_SECRET?.trim() ?? "").length > 0 }),
    }),
    buildHealthSection({
      key: "caixa",
      title: "Imóveis da Caixa",
      description: "Idade da última lista enviada pela equipe.",
      items: input.caixa.ok ? [evaluateCaixaLoad(input.caixa.value, now)] : [],
      unavailable: input.caixa.ok ? null : input.caixa.reason,
    }),
    buildHealthSection({
      key: "assinaturas",
      title: "Assinaturas (Stripe)",
      description: "Modo da Stripe e quantas contas há em cada situação.",
      items: [
        evaluateStripeMode(detectStripeKeyMode(env.STRIPE_SECRET_KEY)),
        ...(billing.value ? evaluateBilling(billing.value) : []),
      ],
      unavailable: billing.unavailable,
    }),
  ]
}
