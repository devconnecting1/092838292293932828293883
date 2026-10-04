import { describe, expect, it } from "vitest"

import { decideCaixaUploadReminder } from "./upload-reminder"

const NOW = new Date("2026-09-18T08:07:00Z")

describe("decideCaixaUploadReminder", () => {
  it("não envia sem nenhuma carga anterior", () => {
    expect(decideCaixaUploadReminder(null, NOW)).toEqual({
      send: false,
      reason: "sem_carga_anterior",
    })
    expect(decideCaixaUploadReminder(undefined, NOW)).toEqual({
      send: false,
      reason: "sem_carga_anterior",
    })
    expect(decideCaixaUploadReminder("não é data", NOW)).toEqual({
      send: false,
      reason: "sem_carga_anterior",
    })
  })

  it("não envia com carga de até 24 horas", () => {
    expect(decideCaixaUploadReminder("2026-09-17T10:00:00Z", NOW)).toEqual({
      send: false,
      reason: "em_dia",
    })
    expect(decideCaixaUploadReminder("2026-09-17T08:07:00Z", NOW)).toEqual({
      send: false,
      reason: "em_dia",
    })
  })

  it("envia quando a última carga tem mais de 24 horas", () => {
    expect(decideCaixaUploadReminder("2026-09-17T08:06:00Z", NOW)).toEqual({
      send: true,
      ageHours: 24,
    })
    expect(decideCaixaUploadReminder(new Date("2026-09-15T20:00:00Z"), NOW)).toEqual({
      send: true,
      ageHours: 60,
    })
  })
})
