import { describe, expect, it } from "vitest"

import {
  buildHealthSection,
  describeAge,
  formatDurationMinutes,
  minutesSince,
  sortHealthItems,
  summarizeHealth,
  worstStatus,
  type HealthItem,
  type HealthStatus,
} from "./health"

function item(key: string, status: HealthStatus): HealthItem {
  return { key, label: key, reference: null, status, detail: "", action: null }
}

describe("worstStatus", () => {
  it("devolve o pior estado e ok para lista vazia", () => {
    expect(worstStatus([])).toBe("ok")
    expect(worstStatus(["ok", "atencao", "ok"])).toBe("atencao")
    expect(worstStatus(["atencao", "problema", "ok"])).toBe("problema")
  })
})

describe("sortHealthItems", () => {
  it("põe problemas primeiro e mantém a ordem dentro do mesmo estado", () => {
    const sorted = sortHealthItems([
      item("a", "ok"),
      item("b", "atencao"),
      item("c", "problema"),
      item("d", "atencao"),
      item("e", "problema"),
    ])

    expect(sorted.map((entry) => entry.key)).toEqual(["c", "e", "b", "d", "a"])
  })
})

describe("buildHealthSection", () => {
  it("calcula o estado pelos itens", () => {
    const section = buildHealthSection({
      key: "s",
      title: "S",
      description: "",
      items: [item("a", "ok"), item("b", "problema")],
    })

    expect(section.status).toBe("problema")
    expect(section.unavailable).toBeNull()
    expect(section.items[0]?.key).toBe("b")
  })

  it("parte indisponível conta como atenção", () => {
    const section = buildHealthSection({
      key: "s",
      title: "S",
      description: "",
      unavailable: "Configure PLATFORM_SERVER_KEY.",
    })

    expect(section.status).toBe("atencao")
    expect(section.items).toEqual([])
  })
})

describe("summarizeHealth", () => {
  it("conta itens por estado e seções indisponíveis como atenção", () => {
    const summary = summarizeHealth([
      buildHealthSection({
        key: "a",
        title: "A",
        description: "",
        items: [item("1", "ok"), item("2", "ok"), item("3", "atencao")],
      }),
      buildHealthSection({ key: "b", title: "B", description: "", unavailable: "sem chave" }),
    ])

    expect(summary).toEqual({ ok: 2, atencao: 2, problema: 0, status: "atencao" })
  })

  it("tudo ok", () => {
    const summary = summarizeHealth([
      buildHealthSection({ key: "a", title: "A", description: "", items: [item("1", "ok")] }),
    ])

    expect(summary.status).toBe("ok")
  })
})

describe("durações", () => {
  const now = new Date("2026-09-17T12:00:00Z")

  it("formata minutos, horas e dias", () => {
    expect(formatDurationMinutes(0)).toBe("menos de 1 min")
    expect(formatDurationMinutes(5)).toBe("5 min")
    expect(formatDurationMinutes(125)).toBe("2 h")
    expect(formatDurationMinutes(47 * 60)).toBe("47 h")
    expect(formatDurationMinutes(72 * 60)).toBe("3 dias")
  })

  it("idade a partir de texto ou data; inválida vira desconhecida", () => {
    expect(minutesSince("2026-09-17T11:30:00Z", now)).toBe(30)
    expect(minutesSince(new Date("2026-09-17T13:00:00Z"), now)).toBe(0)
    expect(minutesSince("não é data", now)).toBeNull()
    expect(describeAge("2026-09-17T09:00:00Z", now)).toBe("há 3 h")
    expect(describeAge(null, now)).toBe("em data desconhecida")
  })
})
