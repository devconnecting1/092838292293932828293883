import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  cronIntervalMinutes,
  describeCronSchedule,
  evaluateDatabaseCronJob,
  evaluateVercelCrons,
  VERCEL_CRONS,
  type DatabaseCronJob,
} from "./cron"

const NOW = new Date("2026-09-17T12:00:00Z")

function job(overrides: Partial<DatabaseCronJob> = {}): DatabaseCronJob {
  return {
    name: "rodizio-de-leads",
    schedule: "* * * * *",
    active: true,
    lastStatus: "succeeded",
    lastStartedAt: "2026-09-17T11:59:00Z",
    lastFinishedAt: "2026-09-17T11:59:01Z",
    lastMessage: null,
    runs24h: 1440,
    failures24h: 0,
    ...overrides,
  }
}

describe("cronIntervalMinutes", () => {
  it("entende os formatos usados no projeto", () => {
    expect(cronIntervalMinutes("* * * * *")).toBe(1)
    expect(cronIntervalMinutes("*/5 * * * *")).toBe(5)
    expect(cronIntervalMinutes("*/30 * * * *")).toBe(30)
    expect(cronIntervalMinutes("13,43 * * * *")).toBe(30)
    expect(cronIntervalMinutes("0 */6 * * *")).toBe(360)
    expect(cronIntervalMinutes("17 3 * * *")).toBe(1440)
    expect(cronIntervalMinutes("0 8,20 * * *")).toBe(720)
    expect(cronIntervalMinutes("23 4 * * 0")).toBe(10080)
  })

  it("formato desconhecido volta null", () => {
    expect(cronIntervalMinutes("30 seconds")).toBeNull()
    expect(cronIntervalMinutes("0 0 1 * *")).toBeNull()
    expect(cronIntervalMinutes("0 0 * 1 *")).toBeNull()
    expect(cronIntervalMinutes("")).toBeNull()
  })
})

describe("describeCronSchedule", () => {
  it("descreve em pt-BR com o horário de Brasília", () => {
    expect(describeCronSchedule("* * * * *")).toBe("a cada minuto")
    expect(describeCronSchedule("*/5 * * * *")).toBe("a cada 5 min")
    expect(describeCronSchedule("7 8 * * *")).toBe("todo dia às 05:07 (Brasília)")
    expect(describeCronSchedule("17 3 * * *")).toBe("todo dia às 00:17 (Brasília)")
    expect(describeCronSchedule("0 10 * * 1")).toBe("toda segunda às 07:00 (Brasília)")
    expect(describeCronSchedule("0 1 * * 0")).toBe("todo sábado às 22:00 (Brasília)")
    expect(describeCronSchedule("30 seconds")).toBe("agenda 30 seconds (UTC)")
  })
})

describe("evaluateDatabaseCronJob", () => {
  it("execução recente sem falhas é ok", () => {
    const result = evaluateDatabaseCronJob(job(), NOW)
    expect(result.status).toBe("ok")
    expect(result.label).toBe("Rodízio de leads e prazo de primeiro contato")
    expect(result.reference).toBe("rodizio-de-leads")
  })

  it("rotina desligada é atenção", () => {
    expect(evaluateDatabaseCronJob(job({ active: false }), NOW).status).toBe("atencao")
  })

  it("última execução com falha é problema e mostra a mensagem curta", () => {
    const result = evaluateDatabaseCronJob(
      job({ lastStatus: "failed", lastMessage: "ERROR: função não existe", failures24h: 3 }),
      NOW
    )

    expect(result.status).toBe("problema")
    expect(result.detail).toContain("3 falhas")
    expect(result.detail).toContain("função não existe")
  })

  it("falhas nas 24 h com a última execução certa é atenção", () => {
    expect(evaluateDatabaseCronJob(job({ failures24h: 2 }), NOW).status).toBe("atencao")
  })

  it("rotina frequente que parou de rodar é problema", () => {
    const result = evaluateDatabaseCronJob(job({ lastStartedAt: "2026-09-17T10:00:00Z" }), NOW)
    expect(result.status).toBe("problema")
    expect(result.detail).toContain("Não roda há 2 h")
  })

  it("sem execução no histórico: atenção se diária ou mais frequente, ok se semanal", () => {
    expect(
      evaluateDatabaseCronJob(job({ lastStatus: null, lastStartedAt: null }), NOW).status
    ).toBe("atencao")
    expect(
      evaluateDatabaseCronJob(
        job({
          name: "expurgo-caixa",
          schedule: "11 5 * * 0",
          lastStatus: null,
          lastStartedAt: null,
        }),
        NOW
      ).status
    ).toBe("ok")
  })

  it("execução presa há mais de 1 hora é atenção", () => {
    const result = evaluateDatabaseCronJob(
      job({
        schedule: "23 4 * * 0",
        lastStatus: "running",
        lastStartedAt: "2026-09-17T09:00:00Z",
      }),
      NOW
    )
    expect(result.status).toBe("atencao")
  })
})

describe("rotinas da Vercel", () => {
  it("a lista é a mesma de apps/web/vercel.json", () => {
    const file = JSON.parse(
      readFileSync(new URL("../../../../apps/web/vercel.json", import.meta.url), "utf8")
    ) as { crons: { path: string; schedule: string }[] }

    expect(VERCEL_CRONS.map(({ path, schedule }) => ({ path, schedule }))).toEqual(file.crons)
  })

  it("todas cabem no plano Hobby (1x por dia)", () => {
    for (const cron of VERCEL_CRONS) {
      expect(cronIntervalMinutes(cron.schedule), cron.path).toBeGreaterThanOrEqual(1440)
    }
  })

  it("sem CRON_SECRET todas viram problema", () => {
    expect(
      evaluateVercelCrons({ hasCronSecret: false }).every((entry) => entry.status === "problema")
    ).toBe(true)
    expect(
      evaluateVercelCrons({ hasCronSecret: true }).every((entry) => entry.status === "ok")
    ).toBe(true)
  })
})
