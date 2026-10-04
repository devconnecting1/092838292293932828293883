import { readdirSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  BILLING_WEBHOOK_ACTIONS,
  BILLING_WEBHOOK_OUTCOMES,
  billingWebhookSignal,
  isBillingWebhookConfigProblem,
  isFreshStripeSignatureHeader,
  isStripeEventType,
  type BillingWebhookDelivery,
} from "./billing-webhook"
import { describeMeasurementDetail } from "./measurements"

const NOW = new Date("2026-09-17T12:00:00Z")
const V1 = "a".repeat(64)

function at(minutesAgo: number) {
  return new Date(NOW.getTime() - minutesAgo * 60_000).toISOString()
}

function delivery(minutesAgo: number, outcome: BillingWebhookDelivery["outcome"]) {
  return { receivedAt: at(minutesAgo), outcome }
}

describe("billingWebhookSignal", () => {
  it("sem entrega na janela é sem medição (null), nunca queda", () => {
    expect(billingWebhookSignal([], NOW)).toBeNull()
    expect(billingWebhookSignal([delivery(121, "config_ausente")], NOW)).toBeNull()
    expect(billingWebhookSignal([delivery(-1, "config_ausente")], NOW)).toBeNull()
  })

  it("configuração ausente sem ok depois = instabilidade parcial", () => {
    expect(billingWebhookSignal([delivery(5, "config_ausente")], NOW)).toEqual({
      level: "partial_outage",
      detail: "webhook_config_ausente",
    })
  })

  it("ok depois da falha de configuração volta a operacional", () => {
    expect(billingWebhookSignal([delivery(5, "config_ausente"), delivery(4, "ok")], NOW)).toEqual({
      level: "operational",
      detail: "ok",
    })
  })

  it("assinatura inválida depois de ok = instabilidade parcial", () => {
    expect(
      billingWebhookSignal([delivery(5, "ok"), delivery(3, "assinatura_invalida")], NOW)
    ).toEqual({ level: "partial_outage", detail: "webhook_assinatura_invalida" })
  })

  it("no mesmo instante vale a ordem de gravação", () => {
    const same = at(3)

    expect(
      billingWebhookSignal(
        [
          { receivedAt: same, outcome: "assinatura_invalida" },
          { receivedAt: same, outcome: "ok" },
        ],
        NOW
      )?.level
    ).toBe("operational")
    expect(
      billingWebhookSignal(
        [
          { receivedAt: same, outcome: "ok" },
          { receivedAt: same, outcome: "assinatura_invalida" },
        ],
        NOW
      )?.level
    ).toBe("partial_outage")
  })

  it("mais da metade das processadas com erro (mínimo 3) = lentidão", () => {
    expect(
      billingWebhookSignal(
        [delivery(10, "erro_processamento"), delivery(9, "ok"), delivery(8, "erro_processamento")],
        NOW
      )
    ).toEqual({ level: "degraded_performance", detail: "webhook_erros_processamento" })
  })

  it("erro em menos de 3 entregas ou em exatamente metade = operacional", () => {
    expect(
      billingWebhookSignal([delivery(10, "erro_processamento"), delivery(9, "ok")], NOW)?.level
    ).toBe("operational")
    expect(
      billingWebhookSignal(
        [
          delivery(10, "erro_processamento"),
          delivery(9, "ok"),
          delivery(8, "erro_processamento"),
          delivery(7, "ok"),
        ],
        NOW
      )?.level
    ).toBe("operational")
  })

  it("falha de configuração superada não dilui a proporção de erro", () => {
    expect(
      billingWebhookSignal(
        [
          delivery(20, "config_ausente"),
          delivery(19, "config_ausente"),
          delivery(18, "config_ausente"),
          delivery(10, "erro_processamento"),
          delivery(9, "ok"),
          delivery(8, "erro_processamento"),
        ],
        NOW
      )?.level
    ).toBe("degraded_performance")
  })

  it("todo detalhe tem rótulo no console", () => {
    for (const detail of [
      "webhook_config_ausente",
      "webhook_assinatura_invalida",
      "webhook_erros_processamento",
    ]) {
      expect(describeMeasurementDetail(detail)).not.toBe(detail)
    }
  })
})

describe("isFreshStripeSignatureHeader", () => {
  const nowSeconds = Math.floor(NOW.getTime() / 1000)

  it("aceita t= recente com v1 de 64 hex (com v0 de teste junto)", () => {
    expect(isFreshStripeSignatureHeader(`t=${nowSeconds},v1=${V1}`, NOW.getTime())).toBe(true)
    expect(
      isFreshStripeSignatureHeader(
        `t=${nowSeconds - 290},v1=${V1},v0=${"b".repeat(64)}`,
        NOW.getTime()
      )
    ).toBe(true)
  })

  it("recusa ausente, sem v1, v1 malformado ou carimbo fora dos 5 min", () => {
    expect(isFreshStripeSignatureHeader(null, NOW.getTime())).toBe(false)
    expect(isFreshStripeSignatureHeader("", NOW.getTime())).toBe(false)
    expect(isFreshStripeSignatureHeader(`t=${nowSeconds}`, NOW.getTime())).toBe(false)
    expect(isFreshStripeSignatureHeader(`t=${nowSeconds},v1=xyz`, NOW.getTime())).toBe(false)
    expect(isFreshStripeSignatureHeader(`t=${nowSeconds - 301},v1=${V1}`, NOW.getTime())).toBe(
      false
    )
    expect(isFreshStripeSignatureHeader(`t=${nowSeconds + 301},v1=${V1}`, NOW.getTime())).toBe(
      false
    )
    expect(isFreshStripeSignatureHeader(`v1=${V1}`, NOW.getTime())).toBe(false)
  })
})

describe("rótulos e checagens", () => {
  it("tipo de evento no formato da Stripe", () => {
    expect(isStripeEventType("invoice.paid")).toBe(true)
    expect(isStripeEventType("checkout.session.async_payment_succeeded")).toBe(true)
    expect(isStripeEventType("Invoice Paid")).toBe(false)
    expect(isStripeEventType("invoice")).toBe(false)
    expect(isStripeEventType(42)).toBe(false)
  })

  it("só falha de configuração pede conferir STRIPE_WEBHOOK_SECRET na Vercel", () => {
    expect(isBillingWebhookConfigProblem("config_ausente")).toBe(true)
    expect(isBillingWebhookConfigProblem("assinatura_invalida")).toBe(true)
    expect(isBillingWebhookConfigProblem("erro_processamento")).toBe(false)
    expect(isBillingWebhookConfigProblem("ok")).toBe(false)
    expect(BILLING_WEBHOOK_ACTIONS.config_ausente).toContain("STRIPE_WEBHOOK_SECRET na Vercel")
    expect(BILLING_WEBHOOK_ACTIONS.assinatura_invalida).toContain("STRIPE_WEBHOOK_SECRET na Vercel")
    expect(BILLING_WEBHOOK_ACTIONS.ok).toBeNull()
  })
})

describe("migração do webhook da Stripe na página de status", () => {
  const migrationsDir = new URL("../../../../supabase/migrations/", import.meta.url)
  const file = readdirSync(migrationsDir).find((name) =>
    name.endsWith("_status_page_billing_webhook_signal.sql")
  )
  const sql = file ? readFileSync(new URL(file, migrationsDir), "utf8") : ""

  it("existe", () => {
    expect(file).toBeDefined()
  })

  it("aceita os mesmos resultados do core", () => {
    for (const outcome of BILLING_WEBHOOK_OUTCOMES) {
      expect(sql).toContain(`'${outcome}'`)
    }
  })

  it("usa a mesma janela, mínimo, retenção e intervalo de rajada", () => {
    expect(sql).toContain("p_now - interval '2 hours'")
    expect(sql).toContain("a.processed >= 3 and a.errors * 2 > a.processed")
    expect(sql).toContain("interval '14 days'")
    expect(sql).toContain("interval '10 seconds'")
  })

  it("a tabela não tem coluna para payload, ids da Stripe ou valores", () => {
    const table = /create table private\.status_billing_webhook_deliveries \(([\s\S]*?)\n\);/.exec(
      sql
    )?.[1]

    expect(table).toBeDefined()
    expect(table).not.toMatch(/payload|customer|subscription|organization|amount|signature/i)
  })
})
