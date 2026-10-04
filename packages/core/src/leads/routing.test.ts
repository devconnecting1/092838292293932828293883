import { describe, expect, it } from "vitest"

import {
  clampMaxReassignments,
  clampSlaMinutes,
  clampWarningPercent,
  compareRoutingCandidates,
  decideOverdueLead,
  isCandidateAvailable,
  isCandidateAway,
  isWithinShift,
  LEAD_ROUTING_RETRY_MINUTES,
  LEAD_ROUTING_TIME_ZONE,
  LEAD_SLA_DEFAULT_MINUTES,
  LEAD_SLA_DEFAULT_WARNING_PERCENT,
  leadSlaState,
  minutesUntilNextQueueWindow,
  minutesUntilNextShift,
  normalizeShift,
  pickNextAssignee,
  resolveFirstContactAtMs,
  routeLead,
  slaDeadlineMs,
  slaMinutesLeft,
  slaWarningMs,
  zonedClock,
  type LeadRoutingCandidate,
  type LeadRoutingContext,
  type LeadShift,
} from "./routing"

const MINUTE = 60_000

function candidate(
  userId: string,
  overrides: Partial<LeadRoutingCandidate> = {}
): LeadRoutingCandidate {
  return {
    userId,
    weight: 1,
    dailyLimit: null,
    assignedToday: 0,
    lastAssignedAtMs: null,
    shifts: [],
    ...overrides,
  }
}

function context(overrides: Partial<LeadRoutingContext> = {}): LeadRoutingContext {
  return {
    atMs: Date.parse("2026-09-16T13:00:00.000Z"),
    // Quarta-feira, 10:00 em Brasília.
    clock: { weekday: 3, minuteOfDay: 10 * 60 },
    respectSchedule: true,
    ...overrides,
  }
}

const shift = (weekday: number, startHour: number, endHour: number): LeadShift => ({
  weekday,
  startMinute: startHour * 60,
  endMinute: endHour * 60,
})

// -----------------------------------------------------------------------------
// Relógio no fuso da imobiliária
// -----------------------------------------------------------------------------

describe("zonedClock", () => {
  it("converte para o dia e a hora de Brasília", () => {
    // 2026-09-16 é uma quarta-feira; 13:00 UTC = 10:00 em São Paulo (UTC-3).
    expect(zonedClock("2026-09-16T13:00:00.000Z")).toEqual({ weekday: 3, minuteOfDay: 600 })
  })

  it("vira o dia quando o UTC já passou da meia-noite mas Brasília não", () => {
    // 2026-09-17 02:30 UTC = 2026-09-16 23:30 em São Paulo (ainda quarta).
    expect(zonedClock("2026-09-17T02:30:00.000Z", LEAD_ROUTING_TIME_ZONE)).toEqual({
      weekday: 3,
      minuteOfDay: 23 * 60 + 30,
    })
  })

  it("devolve null para fuso ou data inválidos", () => {
    expect(zonedClock("2026-09-16T13:00:00.000Z", "Marte/Olympus")).toBeNull()
    expect(zonedClock("não é data")).toBeNull()
  })
})

// -----------------------------------------------------------------------------
// Escala de plantão
// -----------------------------------------------------------------------------

describe("normalizeShift", () => {
  it("aceita uma janela válida", () => {
    expect(normalizeShift({ weekday: 1, startMinute: 540, endMinute: 1080 })).toEqual({
      weekday: 1,
      startMinute: 540,
      endMinute: 1080,
    })
  })

  it("recusa dia fora de 0..6, fim antes do início e fim depois do dia", () => {
    expect(normalizeShift({ weekday: 7, startMinute: 0, endMinute: 60 })).toBeNull()
    expect(normalizeShift({ weekday: 1, startMinute: 600, endMinute: 600 })).toBeNull()
    expect(normalizeShift({ weekday: 1, startMinute: 600, endMinute: 1441 })).toBeNull()
  })
})

describe("isWithinShift", () => {
  const shifts = [shift(3, 9, 12), shift(3, 14, 18)]

  it("sem escala cadastrada, o corretor atende sempre", () => {
    expect(isWithinShift([], { weekday: 0, minuteOfDay: 3 * 60 })).toBe(true)
  })

  it("aceita o início da janela e recusa o minuto do fim", () => {
    expect(isWithinShift(shifts, { weekday: 3, minuteOfDay: 9 * 60 })).toBe(true)
    expect(isWithinShift(shifts, { weekday: 3, minuteOfDay: 12 * 60 })).toBe(false)
    expect(isWithinShift(shifts, { weekday: 3, minuteOfDay: 15 * 60 })).toBe(true)
  })

  it("recusa outro dia da semana", () => {
    expect(isWithinShift(shifts, { weekday: 4, minuteOfDay: 10 * 60 })).toBe(false)
  })
})

describe("minutesUntilNextShift", () => {
  it("devolve 0 quando já está na janela (ou sem escala)", () => {
    expect(minutesUntilNextShift([shift(3, 9, 18)], { weekday: 3, minuteOfDay: 600 })).toBe(0)
    expect(minutesUntilNextShift([], { weekday: 3, minuteOfDay: 600 })).toBe(0)
  })

  it("espera a próxima janela do mesmo dia", () => {
    const shifts = [shift(3, 9, 12), shift(3, 14, 18)]
    expect(minutesUntilNextShift(shifts, { weekday: 3, minuteOfDay: 13 * 60 })).toBe(60)
  })

  it("atravessa a semana até a próxima janela", () => {
    // Sexta 20:00 → segunda 09:00 = 61 h (sábado e domingo sem plantão).
    expect(minutesUntilNextShift([shift(1, 9, 18)], { weekday: 5, minuteOfDay: 20 * 60 })).toBe(
      61 * 60
    )
  })

  it("volta à mesma janela na semana seguinte", () => {
    expect(minutesUntilNextShift([shift(3, 9, 12)], { weekday: 3, minuteOfDay: 13 * 60 })).toBe(
      7 * 1440 - 4 * 60
    )
  })
})

describe("minutesUntilNextQueueWindow", () => {
  it("usa a menor espera da fila inteira", () => {
    const fila = [
      candidate("a", { shifts: [shift(3, 18, 20)] }),
      candidate("b", { shifts: [shift(3, 14, 16)] }),
    ]

    expect(minutesUntilNextQueueWindow(fila, { weekday: 3, minuteOfDay: 13 * 60 })).toBe(60)
  })
})

// -----------------------------------------------------------------------------
// Ordem do rodízio
// -----------------------------------------------------------------------------

describe("compareRoutingCandidates", () => {
  it("quem recebeu menos hoje vem primeiro", () => {
    const a = candidate("a", { assignedToday: 1 })
    const b = candidate("b", { assignedToday: 3 })
    expect(compareRoutingCandidates(a, b)).toBeLessThan(0)
  })

  it("o peso dobra a cota do corretor", () => {
    const pesado = candidate("a", { assignedToday: 3, weight: 2 })
    const leve = candidate("b", { assignedToday: 2, weight: 1 })
    // 3/2 = 1,5 contra 2/1 = 2: o de peso 2 ainda recebe.
    expect(compareRoutingCandidates(pesado, leve)).toBeLessThan(0)
  })

  it("empate na cota: vence quem está há mais tempo sem receber", () => {
    const antigo = candidate("a", { assignedToday: 2, lastAssignedAtMs: 1_000 })
    const recente = candidate("b", { assignedToday: 2, lastAssignedAtMs: 9_000 })
    expect(compareRoutingCandidates(antigo, recente)).toBeLessThan(0)
  })

  it("quem nunca recebeu passa na frente de quem já recebeu", () => {
    const novato = candidate("z", { assignedToday: 0, lastAssignedAtMs: null })
    const veterano = candidate("a", { assignedToday: 0, lastAssignedAtMs: 1 })
    expect(compareRoutingCandidates(novato, veterano)).toBeLessThan(0)
  })

  it("desempate final pelo id, para o resultado ser determinístico", () => {
    const a = candidate("a", { lastAssignedAtMs: 5 })
    const b = candidate("b", { lastAssignedAtMs: 5 })
    expect(compareRoutingCandidates(a, b)).toBeLessThan(0)
    expect(compareRoutingCandidates(b, a)).toBeGreaterThan(0)
  })
})

describe("isCandidateAway", () => {
  const at = Date.parse("2026-09-16T13:00:00.000Z")

  it("sem período de ausência, nunca está ausente", () => {
    expect(isCandidateAway(candidate("a"), at)).toBe(false)
  })

  it("respeita o início e o fim do período", () => {
    const ferias = candidate("a", {
      awayFromMs: Date.parse("2026-09-15T00:00:00.000Z"),
      awayUntilMs: Date.parse("2026-09-20T00:00:00.000Z"),
    })
    expect(isCandidateAway(ferias, at)).toBe(true)
    expect(isCandidateAway(ferias, Date.parse("2026-09-21T00:00:00.000Z"))).toBe(false)
    expect(isCandidateAway(ferias, Date.parse("2026-09-14T00:00:00.000Z"))).toBe(false)
  })

  it("ausência sem data de volta continua valendo", () => {
    const afastado = candidate("a", { awayFromMs: Date.parse("2026-09-01T00:00:00.000Z") })
    expect(isCandidateAway(afastado, at)).toBe(true)
  })
})

describe("isCandidateAvailable", () => {
  it("recusa quem está na lista de exclusão", () => {
    expect(isCandidateAvailable(candidate("a"), context({ exclude: ["a"] }))).toBe(false)
  })

  it("recusa quem bateu o limite diário", () => {
    const cheio = candidate("a", { dailyLimit: 5, assignedToday: 5 })
    expect(isCandidateAvailable(cheio, context())).toBe(false)
    expect(isCandidateAvailable({ ...cheio, assignedToday: 4 }, context())).toBe(true)
  })

  it("recusa quem está fora da escala, a menos que a escala esteja desligada", () => {
    const foraDoHorario = candidate("a", { shifts: [shift(3, 14, 18)] })
    expect(isCandidateAvailable(foraDoHorario, context())).toBe(false)
    expect(isCandidateAvailable(foraDoHorario, context({ respectSchedule: false }))).toBe(true)
  })
})

describe("pickNextAssignee", () => {
  it("distribui em rodízio conforme os leads do dia vão entrando", () => {
    const fila = [
      candidate("ana", { assignedToday: 0, lastAssignedAtMs: 10 }),
      candidate("bia", { assignedToday: 0, lastAssignedAtMs: 20 }),
      candidate("caio", { assignedToday: 0, lastAssignedAtMs: 30 }),
    ]

    const ordem: string[] = []
    let clock = 100

    for (let i = 0; i < 6; i += 1) {
      const escolhido = pickNextAssignee(fila, context())
      expect(escolhido).not.toBeNull()
      ordem.push(escolhido as string)

      const alvo = fila.find((item) => item.userId === escolhido) as LeadRoutingCandidate
      alvo.assignedToday += 1
      alvo.lastAssignedAtMs = clock
      clock += 10
    }

    expect(ordem).toEqual(["ana", "bia", "caio", "ana", "bia", "caio"])
  })

  it("devolve null quando ninguém está disponível", () => {
    const fila = [candidate("ana", { shifts: [shift(0, 9, 12)] })]
    expect(pickNextAssignee(fila, context())).toBeNull()
    expect(pickNextAssignee([], context())).toBeNull()
  })
})

describe("routeLead", () => {
  it("entrega ao próximo da fila quando há alguém disponível", () => {
    expect(routeLead([candidate("ana")], context())).toEqual({ kind: "assigned", userId: "ana" })
  })

  it("enfileira para a próxima janela quando todos estão fora do horário", () => {
    const fila = [candidate("ana", { shifts: [shift(3, 14, 18)] })]
    expect(routeLead(fila, context())).toEqual({ kind: "queued", retryInMinutes: 4 * 60 })
  })

  it("tenta de novo em alguns minutos quando ninguém tem janela futura", () => {
    const fila = [candidate("ana", { dailyLimit: 1, assignedToday: 1 })]
    expect(routeLead(fila, context())).toEqual({
      kind: "queued",
      retryInMinutes: LEAD_ROUTING_RETRY_MINUTES,
    })
  })

  it("fila vazia (ou todos de férias) não tem para quem mandar", () => {
    expect(routeLead([], context())).toEqual({ kind: "unavailable" })

    const ferias = [candidate("ana", { awayFromMs: Date.parse("2026-09-01T00:00:00.000Z") })]
    expect(routeLead(ferias, context())).toEqual({ kind: "unavailable" })
  })
})

// -----------------------------------------------------------------------------
// SLA de primeiro contato
// -----------------------------------------------------------------------------

describe("limites configuráveis do SLA", () => {
  it("prende o prazo entre 1 min e 24 h e usa o padrão para valores inválidos", () => {
    expect(clampSlaMinutes(15)).toBe(15)
    expect(clampSlaMinutes(0)).toBe(1)
    expect(clampSlaMinutes(5000)).toBe(1440)
    expect(clampSlaMinutes("x")).toBe(LEAD_SLA_DEFAULT_MINUTES)
  })

  it("prende o percentual de aviso e o número de redistribuições", () => {
    expect(clampWarningPercent(50)).toBe(50)
    expect(clampWarningPercent(99)).toBe(95)
    expect(clampWarningPercent(null)).toBe(LEAD_SLA_DEFAULT_WARNING_PERCENT)
    expect(clampMaxReassignments(2)).toBe(2)
    expect(clampMaxReassignments(99)).toBe(10)
    expect(clampMaxReassignments(-1)).toBe(0)
  })
})

describe("slaDeadlineMs e slaWarningMs", () => {
  const assignedAt = Date.parse("2026-09-16T13:00:00.000Z")

  it("conta o prazo a partir de quando o corretor recebeu o lead", () => {
    expect(slaDeadlineMs(assignedAt, 5)).toBe(assignedAt + 5 * MINUTE)
    // Prazo inválido cai no padrão de 5 min.
    expect(slaDeadlineMs(assignedAt, 0)).toBe(assignedAt + 1 * MINUTE)
  })

  it("avisa no percentual do prazo já decorrido", () => {
    const due = slaDeadlineMs(assignedAt, 10)
    expect(slaWarningMs(assignedAt, due, 70)).toBe(assignedAt + 7 * MINUTE)
    expect(slaWarningMs(assignedAt, due, 50)).toBe(assignedAt + 5 * MINUTE)
  })

  it("prazo já vencido na origem avisa no próprio prazo", () => {
    expect(slaWarningMs(assignedAt, assignedAt, 70)).toBe(assignedAt)
  })
})

describe("leadSlaState", () => {
  const assignedAt = Date.parse("2026-09-16T13:00:00.000Z")
  const due = slaDeadlineMs(assignedAt, 10)

  it("sem prazo, não há contagem", () => {
    expect(leadSlaState({ assignedAtMs: assignedAt, dueAtMs: null, nowMs: assignedAt })).toBe(
      "idle"
    )
  })

  it("dentro do prazo e antes do aviso", () => {
    expect(
      leadSlaState({ assignedAtMs: assignedAt, dueAtMs: due, nowMs: assignedAt + 5 * MINUTE })
    ).toBe("ok")
  })

  it("passou do percentual de aviso", () => {
    expect(
      leadSlaState({ assignedAtMs: assignedAt, dueAtMs: due, nowMs: assignedAt + 7 * MINUTE })
    ).toBe("warning")
  })

  it("estourou no instante do prazo", () => {
    expect(leadSlaState({ assignedAtMs: assignedAt, dueAtMs: due, nowMs: due })).toBe("breached")
  })

  it("sem saber quando foi atribuído, só sabe dizer se estourou", () => {
    expect(leadSlaState({ assignedAtMs: null, dueAtMs: due, nowMs: assignedAt + 9 * MINUTE })).toBe(
      "ok"
    )
    expect(leadSlaState({ assignedAtMs: null, dueAtMs: due, nowMs: due + 1 })).toBe("breached")
  })
})

describe("slaMinutesLeft", () => {
  const now = Date.parse("2026-09-16T13:00:00.000Z")

  it("arredonda para cima e nunca fica negativo", () => {
    expect(slaMinutesLeft(now + 90_000, now)).toBe(2)
    expect(slaMinutesLeft(now - 90_000, now)).toBe(0)
    expect(slaMinutesLeft(null, now)).toBe(0)
  })
})

// -----------------------------------------------------------------------------
// Primeiro contato e prazo estourado
// -----------------------------------------------------------------------------

describe("resolveFirstContactAtMs", () => {
  const now = Date.parse("2026-09-16T13:00:00.000Z")

  it("grava o primeiro contato na primeira vez", () => {
    expect(
      resolveFirstContactAtMs({
        previousFirstContactMs: null,
        lastContactMs: now - 3 * MINUTE,
        nowMs: now,
      })
    ).toBe(now - 3 * MINUTE)
  })

  it("não muda no segundo contato", () => {
    expect(
      resolveFirstContactAtMs({
        previousFirstContactMs: now - 2 * 24 * 60 * MINUTE,
        lastContactMs: now,
        nowMs: now,
      })
    ).toBe(now - 2 * 24 * 60 * MINUTE)
  })

  it("sem contato fica vazio e contato no futuro vira o instante da gravação", () => {
    expect(
      resolveFirstContactAtMs({ previousFirstContactMs: null, lastContactMs: null, nowMs: now })
    ).toBeNull()
    expect(
      resolveFirstContactAtMs({
        previousFirstContactMs: null,
        lastContactMs: now + 60 * MINUTE,
        nowMs: now,
      })
    ).toBe(now)
  })
})

describe("decideOverdueLead", () => {
  it("com um único corretor elegível, o lead continua com ele", () => {
    expect(
      decideOverdueLead({
        candidates: [candidate("ana")],
        ctx: context(),
        assignedTo: "ana",
        reassignments: 0,
        maxReassignments: 3,
      })
    ).toEqual({ kind: "keep" })
  })

  it("os outros fora do plantão ou no limite do dia também mantêm o responsável", () => {
    const fila = [
      candidate("ana"),
      candidate("bia", { shifts: [shift(3, 14, 18)] }),
      candidate("caio", { dailyLimit: 2, assignedToday: 2 }),
    ]

    expect(
      decideOverdueLead({
        candidates: fila,
        ctx: context(),
        assignedTo: "ana",
        reassignments: 0,
        maxReassignments: 3,
      })
    ).toEqual({ kind: "keep" })
  })

  it("com outro corretor disponível, redistribui para ele", () => {
    expect(
      decideOverdueLead({
        candidates: [candidate("ana"), candidate("bia")],
        ctx: context(),
        assignedTo: "ana",
        reassignments: 0,
        maxReassignments: 3,
      })
    ).toEqual({ kind: "reassign", userId: "bia" })
  })

  it("redistribuições esgotadas mantêm o responsável", () => {
    expect(
      decideOverdueLead({
        candidates: [candidate("ana"), candidate("bia")],
        ctx: context(),
        assignedTo: "ana",
        reassignments: 3,
        maxReassignments: 3,
      })
    ).toEqual({ kind: "keep" })
  })
})
