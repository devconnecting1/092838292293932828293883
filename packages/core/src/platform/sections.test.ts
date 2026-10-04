import { describe, expect, it } from "vitest"

import { summarizeHealth } from "./health"
import { buildPlatformHealthSections, PLATFORM_HEALTH_PART_UNAVAILABLE } from "./sections"
import { parsePlatformHealthSnapshot } from "./snapshot"

const NOW = new Date("2026-09-17T04:20:00Z")

/** Formato real de platform_health (resumido), só com contagens. */
const RESPONSE = {
  generated_at: "2026-09-17T04:18:20.070525+00:00",
  cron_jobs: [
    {
      name: "rodizio-de-leads",
      active: true,
      runs_24h: 1440,
      schedule: "* * * * *",
      last_status: "succeeded",
      failures_24h: 0,
      last_message: null,
      last_started_at: "2026-09-17T04:18:00.026594+00:00",
      last_finished_at: "2026-09-17T04:18:00.045486+00:00",
    },
    {
      name: "expurgo-caixa",
      active: true,
      runs_24h: 0,
      schedule: "11 5 * * 0",
      last_status: null,
      failures_24h: 0,
      last_message: null,
      last_started_at: null,
      last_finished_at: null,
    },
  ],
  vault_secrets: { platform_server_key: true, lead_alerts_webhook_url: false },
  queues: {
    avisos_de_lead: {
      stale: 1,
      failed: 0,
      pending: 1,
      oldest_pending_at: "2026-09-16T23:46:13.994062+00:00",
      stale_after_minutes: 60,
    },
    push_de_avisos: {
      stale: 0,
      failed: 0,
      devices: 0,
      pending: 0,
      oldest_pending_at: null,
      stale_after_minutes: null,
    },
    fila_desconhecida: { pending: 3 },
  },
  billing: {
    accounts: 2,
    by_state: { trialing: 2 },
    by_status: { trialing: 2 },
    organizations: 2,
    with_customer: 0,
    with_subscription: 0,
  },
}

describe("parsePlatformHealthSnapshot", () => {
  it("lê a resposta do banco", () => {
    const snapshot = parsePlatformHealthSnapshot(RESPONSE)

    expect(snapshot.generatedAt).toBe(RESPONSE.generated_at)
    expect(snapshot.cronJobs).toHaveLength(2)
    expect(snapshot.cronJobs?.[0]).toMatchObject({ name: "rodizio-de-leads", runs24h: 1440 })
    expect(snapshot.vaultSecrets).toEqual(RESPONSE.vault_secrets)
    expect(Object.keys(snapshot.queues ?? {})).toEqual(["avisos_de_lead", "push_de_avisos"])
    expect(snapshot.queues?.push_de_avisos?.devices).toBe(0)
    expect(snapshot.billing).toMatchObject({ organizations: 2, byState: { trialing: 2 } })
  })

  it("parte null ou inválida vira null sem derrubar as outras", () => {
    const snapshot = parsePlatformHealthSnapshot({
      ...RESPONSE,
      cron_jobs: null,
      billing: { organizations: "dois" },
      vault_secrets: { platform_server_key: "sim" },
    })

    expect(snapshot.cronJobs).toBeNull()
    expect(snapshot.billing).toBeNull()
    expect(snapshot.vaultSecrets).toBeNull()
    expect(snapshot.queues).not.toBeNull()
    expect(parsePlatformHealthSnapshot("não é objeto")).toEqual({
      generatedAt: null,
      cronJobs: null,
      vaultSecrets: null,
      queues: null,
      billing: null,
    })
  })
})

describe("buildPlatformHealthSections", () => {
  it("sem o banco, as partes globais ficam indisponíveis com o motivo e o resto continua", () => {
    const reason = "Configure PLATFORM_SERVER_KEY para ver rotinas, filas e assinaturas."
    const sections = buildPlatformHealthSections({
      now: NOW,
      env: {},
      production: false,
      database: { ok: false, reason },
      caixa: { ok: true, value: null },
    })

    const byKey = new Map(sections.map((section) => [section.key, section]))

    expect(sections.map((section) => section.key)).toEqual([
      "variaveis",
      "rotinas_banco",
      "vault",
      "filas",
      "rotinas_vercel",
      "caixa",
      "assinaturas",
    ])

    for (const key of ["rotinas_banco", "vault", "filas", "assinaturas"]) {
      expect(byKey.get(key)?.unavailable, key).toBe(reason)
      expect(byKey.get(key)?.status, key).not.toBe("ok")
    }

    expect(byKey.get("variaveis")?.items.length).toBeGreaterThan(10)
    expect(byKey.get("rotinas_vercel")?.items).toHaveLength(8)
    expect(byKey.get("caixa")?.items[0]?.status).toBe("atencao")
    // O modo da Stripe não depende do banco.
    expect(byKey.get("assinaturas")?.items[0]?.key).toBe("assinaturas_modo")
  })

  it("com o banco, monta todas as partes", () => {
    const sections = buildPlatformHealthSections({
      now: NOW,
      env: { CRON_SECRET: "x", STRIPE_SECRET_KEY: "rk_test_x" },
      production: false,
      database: { ok: true, value: parsePlatformHealthSnapshot(RESPONSE) },
      caixa: { ok: false, reason: "Não foi possível ler a última carga." },
    })

    const byKey = new Map(sections.map((section) => [section.key, section]))

    expect(byKey.get("rotinas_banco")?.items.map((entry) => entry.status)).toEqual(["ok", "ok"])
    expect(byKey.get("filas")?.items[0]?.status).toBe("atencao")
    expect(byKey.get("vault")?.unavailable).toBeNull()
    expect(byKey.get("caixa")?.unavailable).toBe("Não foi possível ler a última carga.")
    expect(byKey.get("assinaturas")?.items.map((entry) => entry.key)).toEqual([
      "assinaturas_modo",
      "assinaturas_situacao",
      "assinaturas_status_stripe",
    ])
    expect(summarizeHealth(sections).status).toBe("problema")
  })

  it("parte que o banco não calculou fica indisponível", () => {
    const sections = buildPlatformHealthSections({
      now: NOW,
      env: {},
      production: false,
      database: {
        ok: true,
        value: parsePlatformHealthSnapshot({ ...RESPONSE, queues: null }),
      },
      caixa: { ok: true, value: null },
    })

    expect(sections.find((section) => section.key === "filas")?.unavailable).toBe(
      PLATFORM_HEALTH_PART_UNAVAILABLE
    )
  })
})
