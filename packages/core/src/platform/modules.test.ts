import { describe, expect, it } from "vitest"

import { evaluateBilling, evaluateStripeMode } from "./billing"
import { evaluateCaixaLoad, type CaixaLoadHealthInput } from "./caixa"
import { evaluateQueue, evaluateQueues, type PlatformQueueCounts } from "./queues"
import { evaluateVaultSecrets, PLATFORM_VAULT_SECRET_NAMES } from "./vault"

const NOW = new Date("2026-09-17T12:00:00Z")

describe("evaluateVaultSecrets", () => {
  const allPresent = Object.fromEntries(PLATFORM_VAULT_SECRET_NAMES.map((name) => [name, true]))

  it("pede os nove *_server_key e os dois pares de webhook", () => {
    expect(PLATFORM_VAULT_SECRET_NAMES.filter((name) => name.endsWith("_server_key"))).toHaveLength(
      9
    )
    expect(PLATFORM_VAULT_SECRET_NAMES).toContain("visit_reminders_webhook_url")
    expect(PLATFORM_VAULT_SECRET_NAMES).toContain("lead_alerts_webhook_secret")
    expect(PLATFORM_VAULT_SECRET_NAMES).toContain("lead_ingest_webhook_url")
    expect(PLATFORM_VAULT_SECRET_NAMES).toContain("lead_ingest_webhook_secret")
    expect(PLATFORM_VAULT_SECRET_NAMES.every((name) => /^[a-z][a-z0-9_]{2,62}$/.test(name))).toBe(
      true
    )
  })

  it("tudo presente é ok", () => {
    expect(evaluateVaultSecrets(allPresent).every((entry) => entry.status === "ok")).toBe(true)
  })

  it("aponta o que falta", () => {
    const items = new Map(
      evaluateVaultSecrets({
        ...allPresent,
        caixa_server_key: false,
        lead_alerts_webhook_url: false,
        lead_alerts_webhook_secret: false,
        visit_reminders_webhook_url: false,
        visit_reminders_webhook_secret: false,
        lead_ingest_webhook_url: false,
        lead_ingest_webhook_secret: false,
      }).map((entry) => [entry.key, entry])
    )

    expect(items.get("vault_caixa_server_key")?.status).toBe("problema")
    expect(items.get("vault_lead_alerts")?.status).toBe("atencao")
    expect(items.get("vault_visit_reminders")?.status).toBe("problema")
    expect(items.get("vault_lead_ingest")?.status).toBe("atencao")
    expect(items.get("vault_lead_ingest")?.action).toContain("/api/cron/lead-ingest")
    expect(items.get("vault_visit_reminders")?.action).toContain(
      "/api/cron/daily-digest/visit-reminders"
    )
  })

  it("sonda da página de status faltando é atenção, com o comando", () => {
    const item = evaluateVaultSecrets({ ...allPresent, status_probe_url: false }).find(
      (entry) => entry.key === "vault_status_probe_url"
    )
    expect(PLATFORM_VAULT_SECRET_NAMES).toContain("status_probe_url")
    expect(item?.status).toBe("atencao")
    expect(item?.action).toContain("/api/status/ping")
  })

  it("só um dos dois segredos do par é problema", () => {
    const item = evaluateVaultSecrets({ ...allPresent, lead_alerts_webhook_secret: false }).find(
      (entry) => entry.key === "vault_lead_alerts"
    )
    expect(item?.status).toBe("problema")
    expect(item?.detail).toContain("lead_alerts_webhook_secret")
  })
})

describe("evaluateQueue", () => {
  const empty: PlatformQueueCounts = {
    pending: 0,
    stale: 0,
    failed: 0,
    oldestPendingAt: null,
    staleAfterMinutes: 60,
  }

  it("fila vazia é ok", () => {
    const item = evaluateQueue("avisos_de_lead", empty, NOW)
    expect(item.status).toBe("ok")
    expect(item.detail).toBe("Nada pendente.")
  })

  it("pendente dentro do prazo é ok", () => {
    const item = evaluateQueue(
      "avisos_de_lead",
      { ...empty, pending: 2, oldestPendingAt: "2026-09-17T11:50:00Z" },
      NOW
    )
    expect(item.status).toBe("ok")
    expect(item.detail).toContain("2 pendentes")
  })

  it("parado é atenção e com erro é problema", () => {
    expect(
      evaluateQueue(
        "avisos_de_lead",
        { ...empty, pending: 1, stale: 1, oldestPendingAt: "2026-09-17T08:00:00Z" },
        NOW
      ).status
    ).toBe("atencao")
    expect(evaluateQueue("lembretes_de_visita", { ...empty, failed: 1 }, NOW).status).toBe(
      "problema"
    )
  })

  it("entrada de leads com falha ainda em nova tentativa é atenção", () => {
    expect(evaluateQueue("entrada_de_leads", { ...empty, failed: 2 }, NOW).status).toBe("atencao")
    expect(evaluateQueue("entrada_de_leads", { ...empty, failed: 2, stale: 2 }, NOW).status).toBe(
      "problema"
    )
  })

  it("push: e-mail enviado sem push é atenção", () => {
    const ok = evaluateQueue("push_de_avisos", { ...empty, devices: 3 }, NOW)
    expect(ok.status).toBe("ok")
    expect(ok.detail).toContain("3 aparelhos")

    expect(evaluateQueue("push_de_avisos", { ...empty, stale: 1, devices: 1 }, NOW).status).toBe(
      "atencao"
    )
  })

  it("evaluateQueues ignora fila ausente", () => {
    expect(evaluateQueues({ resumos_diarios: empty }, NOW).map((entry) => entry.key)).toEqual([
      "fila_resumos_diarios",
    ])
  })
})

describe("evaluateCaixaLoad", () => {
  const load: CaixaLoadHealthInput = {
    syncedAt: "2026-09-17T08:00:00Z",
    listGeneratedOn: "2026-09-16",
    totalActive: 8094,
    lastResult: "ok",
    lastFailureAt: null,
    lastFailureLabel: null,
  }

  it("carga recente é ok", () => {
    const item = evaluateCaixaLoad(load, NOW)
    expect(item.status).toBe("ok")
    expect(item.detail).toContain("8.094 imóveis ativos")
    expect(item.detail).toContain("16/09/2026")
  })

  it("sem carga é atenção", () => {
    expect(evaluateCaixaLoad(null, NOW).status).toBe("atencao")
    expect(evaluateCaixaLoad({ ...load, syncedAt: null }, NOW).status).toBe("atencao")
  })

  it("mais de 24 h é atenção e mais de 72 h é problema", () => {
    expect(evaluateCaixaLoad({ ...load, syncedAt: "2026-09-16T08:00:00Z" }, NOW).status).toBe(
      "atencao"
    )
    expect(evaluateCaixaLoad({ ...load, syncedAt: "2026-09-14T08:00:00Z" }, NOW).status).toBe(
      "problema"
    )
  })

  it("falha depois da carga é atenção com o motivo", () => {
    const item = evaluateCaixaLoad(
      {
        ...load,
        lastResult: "falha",
        lastFailureAt: "2026-09-17T10:00:00Z",
        lastFailureLabel: "O arquivo não tem nenhum imóvel válido.",
      },
      NOW
    )
    expect(item.status).toBe("atencao")
    expect(item.detail).toContain("nenhum imóvel válido")
  })
})

describe("assinaturas", () => {
  it("modo da Stripe", () => {
    expect(evaluateStripeMode(null).status).toBe("atencao")
    expect(evaluateStripeMode("desconhecido").status).toBe("problema")
    expect(evaluateStripeMode("teste").detail).toContain("Modo teste")
    expect(evaluateStripeMode("producao").detail).toContain("Modo produção")
  })

  it("contagens por situação e por status, sem dado de imobiliária", () => {
    const items = evaluateBilling({
      organizations: 3,
      accounts: 3,
      withCustomer: 1,
      withSubscription: 1,
      byStatus: { trialing: 2, active: 1 },
      byState: { trialing: 2, active: 1 },
    })

    expect(items.map((entry) => entry.status)).toEqual(["ok", "ok"])
    expect(items[0]?.detail).toBe(
      "2 em teste grátis · 1 ativa · 0 em carência · 0 em somente leitura."
    )
    expect(items[1]?.detail).toContain("1 ativa · 2 em teste")
  })

  it("carência é atenção e imobiliária sem conta é problema", () => {
    const items = evaluateBilling({
      organizations: 4,
      accounts: 3,
      withCustomer: 3,
      withSubscription: 3,
      byStatus: { past_due: 1, active: 2 },
      byState: { grace: 1, active: 2 },
    })

    expect(items[0]?.status).toBe("atencao")
    expect(items[2]?.status).toBe("problema")
    expect(items[2]?.detail).toContain("1 imobiliária sem conta")
  })
})
