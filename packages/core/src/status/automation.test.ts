import { readdirSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  advanceAutoStreaks,
  AUTO_INCIDENT_MESSAGES,
  AUTO_INCIDENT_RULES,
  automaticIncidentTitle,
  automationStateOf,
  describeVendorSignal,
  EMPTY_AUTO_STREAKS,
  qualifyingAutoImpact,
  selectStatusAlertRecipients,
  STATUS_ALERT_DAILY_EMAIL_LIMIT,
  STATUS_ALERT_MAX_RECIPIENTS,
  STATUS_ALERTS_SETUP_SQL,
  summarizeVendorSignals,
  vendorSignalState,
  type AutoStreaks,
} from "./automation"
import type { MeasuredStatusLevel } from "./levels"
import { STATUS_COMPONENTS } from "./public"

const START = Date.parse("2026-09-17T12:00:00Z")

function minute(n: number) {
  return new Date(START + n * 60_000)
}

/** Aplica uma sequência de níveis, um por minuto a partir do minuto 1. */
function run(
  levels: readonly (MeasuredStatusLevel | null)[],
  from: AutoStreaks = EMPTY_AUTO_STREAKS
) {
  return levels.reduce(
    (streaks, level, index) => advanceAutoStreaks(streaks, level, minute(index + 1)),
    from
  )
}

describe("advanceAutoStreaks", () => {
  it("conta medições seguidas por tipo", () => {
    const streaks = run(["degraded_performance", "partial_outage", "major_outage"])

    expect(streaks).toMatchObject({
      level: "major_outage",
      downStreak: 2,
      impairedStreak: 3,
      okStreak: 0,
      calmStreak: 0,
    })
  })

  it("sem nível confirmado não conta nada (sem medição nunca é queda)", () => {
    const before = run(["partial_outage", "partial_outage"])
    expect(advanceAutoStreaks(before, null, minute(3))).toBe(before)
  })

  it("intervalo maior que 5 min recomeça a contagem", () => {
    const before = run(["partial_outage", "partial_outage"])
    const after = advanceAutoStreaks(before, "partial_outage", minute(2 + 6))

    expect(after.downStreak).toBe(1)
    expect(advanceAutoStreaks(before, "partial_outage", minute(2 + 5)).downStreak).toBe(3)
  })

  it("não conta duas vezes a mesma medição nem medição mais antiga", () => {
    const before = run(["partial_outage"])
    expect(advanceAutoStreaks(before, "partial_outage", minute(1))).toBe(before)
    expect(advanceAutoStreaks(before, "partial_outage", minute(0))).toBe(before)
  })
})

describe("qualifyingAutoImpact", () => {
  it("instabilidade parcial abre só na 3ª medição seguida, com impacto grande", () => {
    expect(qualifyingAutoImpact(run(["partial_outage", "partial_outage"]))).toBeNull()
    expect(qualifyingAutoImpact(run(["partial_outage", "partial_outage", "partial_outage"]))).toBe(
      "major"
    )
  })

  it("fora do ar vira impacto crítico", () => {
    expect(qualifyingAutoImpact(run(["partial_outage", "major_outage", "major_outage"]))).toBe(
      "critical"
    )
  })

  it("lentidão só abre na 10ª medição, com impacto pequeno", () => {
    const nine = Array<MeasuredStatusLevel>(9).fill("degraded_performance")

    expect(qualifyingAutoImpact(run(nine))).toBeNull()
    expect(qualifyingAutoImpact(run([...nine, "degraded_performance"]))).toBe("minor")
  })

  it("operacional nunca qualifica", () => {
    expect(qualifyingAutoImpact(run(Array<MeasuredStatusLevel>(20).fill("operational")))).toBeNull()
  })
})

describe("textos e estado da automação", () => {
  it("título com uma parte usa o nome público; com várias, título genérico", () => {
    expect(automaticIncidentTitle(["notifications"])).toBe(
      "Instabilidade em Avisos por e-mail e no celular"
    )
    expect(automaticIncidentTitle(["crm", "login"])).toBe(
      "Instabilidade em várias partes do sistema"
    )
  })

  it("textos sem detalhe interno nem nome de fornecedor", () => {
    for (const message of Object.values(AUTO_INCIDENT_MESSAGES)) {
      expect(message).not.toMatch(/supabase|vercel|stripe|brevo|pg_|http|fila|rotina/i)
      expect(message.length).toBeLessThanOrEqual(2000)
    }
  })

  it("estado da automação", () => {
    expect(automationStateOf({ source: "team", automationStoppedReason: null })).toBe(
      "nao_se_aplica"
    )
    expect(automationStateOf({ source: "automatic", automationStoppedReason: null })).toBe("ativa")
    expect(automationStateOf({ source: "automatic", automationStoppedReason: "equipe" })).toBe(
      "assumido"
    )
    expect(
      automationStateOf({ source: "automatic", automationStoppedReason: "limite_de_atualizacoes" })
    ).toBe("pausada")
  })
})

describe("fornecedores", () => {
  const now = new Date("2026-09-17T12:10:00Z")

  it("leitura recente mostra o indicador; velha ou ausente vira sem leitura", () => {
    const fresh = {
      name: "Supabase",
      indicator: "none" as const,
      checkedAt: "2026-09-17T12:05:00Z",
    }
    const stale = { name: "Vercel", indicator: "major" as const, checkedAt: "2026-09-17T11:40:00Z" }

    expect(vendorSignalState(fresh, now)).toBe("operacional")
    expect(vendorSignalState({ ...fresh, indicator: "minor" }, now)).toBe("incidente")
    expect(vendorSignalState(stale, now)).toBe("sem_leitura")
    expect(describeVendorSignal({ ...fresh, indicator: "major" }, now)).toBe(
      "Supabase com incidente grande"
    )
    expect(summarizeVendorSignals([fresh, stale], now)).toBe(
      "Fornecedores: Supabase operacional · Vercel sem leitura recente"
    )
  })
})

describe("aviso por e-mail", () => {
  it("destinatários no teto e trava diária", () => {
    const emails = Array.from({ length: 8 }, (_, index) => `dono${index}@exemplo.com`)

    expect(selectStatusAlertRecipients(emails)).toHaveLength(STATUS_ALERT_MAX_RECIPIENTS)
    expect(STATUS_ALERT_MAX_RECIPIENTS).toBeLessThanOrEqual(STATUS_ALERT_DAILY_EMAIL_LIMIT)
  })
})

describe("migração dos incidentes automáticos (espelho do banco)", () => {
  const migrationsDir = new URL("../../../../supabase/migrations/", import.meta.url)
  const file = readdirSync(migrationsDir).find((name) =>
    name.endsWith("_status_page_automatic_incidents.sql")
  )
  const sql = file ? readFileSync(new URL(file, migrationsDir), "utf8") : ""

  it("existe", () => {
    expect(file).toBeDefined()
  })

  it("usa os mesmos números das regras", () => {
    expect(sql).toContain(`p_down_streak >= ${AUTO_INCIDENT_RULES.openOutageSamples}`)
    expect(sql).toContain(`p_impaired_streak >= ${AUTO_INCIDENT_RULES.openDegradedSamples}`)
    expect(sql).toContain(`c_recovery constant integer := ${AUTO_INCIDENT_RULES.recoverySamples};`)
    expect(sql).toContain(
      `c_calm constant integer := ${AUTO_INCIDENT_RULES.calmSamplesToLowerImpact};`
    )
    expect(sql).toContain(
      `c_monitoring constant interval := interval '${AUTO_INCIDENT_RULES.monitoringMinutes} minutes';`
    )
    expect(sql).toContain(
      `c_reopen constant interval := interval '${AUTO_INCIDENT_RULES.reopenWindowMinutes} minutes';`
    )
    expect(sql).toContain(
      `c_daily constant integer := ${AUTO_INCIDENT_RULES.maxPerComponentPerDay};`
    )
    expect(sql).toContain(
      `c_max_updates constant integer := ${AUTO_INCIDENT_RULES.maxUpdatesPerIncident};`
    )
    expect(sql).toContain(
      `c_recent constant interval := interval '${AUTO_INCIDENT_RULES.recentMeasurementMinutes} minutes';`
    )
    expect(sql).toContain(
      `t.last_sample_at >= p_now - interval '${AUTO_INCIDENT_RULES.streakGapMinutes} minutes'`
    )
    expect(sql).toContain(`select ${STATUS_ALERT_DAILY_EMAIL_LIMIT};`)
  })

  it("publica os mesmos textos", () => {
    expect(sql).toContain(`'${AUTO_INCIDENT_MESSAGES.worsened}'`)
    expect(sql).toContain(`'${AUTO_INCIDENT_MESSAGES.relapsed}'`)
    expect(sql).toContain(`'${AUTO_INCIDENT_MESSAGES.lowered}'`)
    expect(sql).toContain(`'${AUTO_INCIDENT_MESSAGES.monitoring}'`)
    expect(sql).toContain(`'${AUTO_INCIDENT_MESSAGES.resolved}'`)
    expect(sql).toContain(`'${AUTO_INCIDENT_MESSAGES.vendorSuffix}'`)
    expect(sql).toContain("'Detectamos automaticamente uma instabilidade '")
    expect(AUTO_INCIDENT_MESSAGES.openedOne).toBe(
      "Detectamos automaticamente uma instabilidade nesta parte do sistema. Estamos verificando."
    )
    expect(AUTO_INCIDENT_MESSAGES.openedMany).toBe(
      "Detectamos automaticamente uma instabilidade nestas partes do sistema. Estamos verificando."
    )
  })

  it("usa os mesmos nomes públicos das partes no título", () => {
    for (const component of STATUS_COMPONENTS) {
      expect(sql).toContain(`when '${component.key}' then '${component.name}'`)
    }
  })
})

describe("SQL de exemplo do aviso por e-mail", () => {
  it("usa só marcadores e os nomes esperados no Vault", () => {
    const sql = STATUS_ALERTS_SETUP_SQL.join("\n")

    expect(sql).toContain("<seu-dominio>")
    expect(sql).toContain("<mesmo valor de CRON_SECRET>")
    expect(sql).toContain("'status_alerts_webhook_url'")
    expect(sql).toContain("'status_alerts_webhook_secret'")
  })
})
