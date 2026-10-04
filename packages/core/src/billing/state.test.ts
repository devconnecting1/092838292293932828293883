import { afterEach, describe, expect, it, vi } from "vitest"

import {
  BILLING_STATE_LABELS,
  getGraceEndsAt,
  isBillingStatus,
  isBillingWritable,
  resolveBillingState,
  trialDaysRemaining,
  type BillingStateInput,
} from "./state"

const DAY = 24 * 60 * 60 * 1000
const TRIAL_END = "2026-09-29T12:00:00.000Z"
const PERIOD_END = "2026-10-15T03:00:00.000Z"

const at = (iso: string, offsetMs = 0) => new Date(Date.parse(iso) + offsetMs)

const trial = (overrides: Partial<BillingStateInput> = {}): BillingStateInput => ({
  status: "trialing",
  planKey: "trial",
  trialEndsAt: TRIAL_END,
  currentPeriodEnd: null,
  ...overrides,
})

const paid = (status: string, overrides: Partial<BillingStateInput> = {}): BillingStateInput => ({
  status,
  planKey: "imobiliaria",
  trialEndsAt: TRIAL_END,
  currentPeriodEnd: PERIOD_END,
  ...overrides,
})

describe("resolveBillingState: teste grátis", () => {
  it("é trialing até o instante exato do fim do teste", () => {
    expect(resolveBillingState(trial(), at(TRIAL_END, -13 * DAY))).toBe("trialing")
    expect(resolveBillingState(trial(), at(TRIAL_END))).toBe("trialing")
  })

  it("entra em carência logo após o fim, até fim + 7 dias inclusive", () => {
    expect(resolveBillingState(trial(), at(TRIAL_END, 1))).toBe("grace")
    expect(resolveBillingState(trial(), at(TRIAL_END, 3 * DAY))).toBe("grace")
    expect(resolveBillingState(trial(), at(TRIAL_END, 7 * DAY))).toBe("grace")
  })

  it("vira somente leitura depois de 7 dias vencido", () => {
    expect(resolveBillingState(trial(), at(TRIAL_END, 7 * DAY + 1))).toBe("read_only")
    expect(resolveBillingState(trial(), at(TRIAL_END, 60 * DAY))).toBe("read_only")
  })

  it("com plano trial usa trial_ends_at mesmo havendo current_period_end", () => {
    const input = trial({ currentPeriodEnd: PERIOD_END })
    expect(resolveBillingState(input, at(TRIAL_END, 8 * DAY))).toBe("read_only")
  })

  it("com trial da Stripe (plano pago) usa current_period_end, ou trial_ends_at sem ela", () => {
    const stripeTrial = paid("trialing")
    expect(resolveBillingState(stripeTrial, at(TRIAL_END, 8 * DAY))).toBe("trialing")
    expect(resolveBillingState(stripeTrial, at(PERIOD_END, 1))).toBe("grace")
    expect(resolveBillingState(stripeTrial, at(PERIOD_END, 7 * DAY + 1))).toBe("read_only")

    const withoutPeriod = paid("trialing", { currentPeriodEnd: null })
    expect(resolveBillingState(withoutPeriod, at(TRIAL_END))).toBe("trialing")
    expect(resolveBillingState(withoutPeriod, at(TRIAL_END, 1))).toBe("grace")
  })

  it("aceita Date além de string ISO", () => {
    const input = trial({ trialEndsAt: new Date(TRIAL_END) })
    expect(resolveBillingState(input, at(TRIAL_END))).toBe("trialing")
    expect(resolveBillingState(input, at(TRIAL_END, 7 * DAY + 1))).toBe("read_only")
  })

  it("trata data inválida como vencida", () => {
    expect(resolveBillingState(trial({ trialEndsAt: "não é data" }), at(TRIAL_END))).toBe(
      "read_only"
    )
    expect(resolveBillingState(trial({ trialEndsAt: "" }), at(TRIAL_END))).toBe("read_only")
  })
})

describe("resolveBillingState: assinatura", () => {
  it("active é sempre active", () => {
    expect(resolveBillingState(paid("active"), at(PERIOD_END, -DAY))).toBe("active")
    expect(resolveBillingState(paid("active"), at(PERIOD_END, 90 * DAY))).toBe("active")
    expect(resolveBillingState(paid("active", { currentPeriodEnd: null }))).toBe("active")
  })

  it.each(["past_due", "unpaid", "incomplete"])(
    "%s fica em carência até current_period_end + 7 dias inclusive",
    (status) => {
      expect(resolveBillingState(paid(status), at(PERIOD_END, -10 * DAY))).toBe("grace")
      expect(resolveBillingState(paid(status), at(PERIOD_END))).toBe("grace")
      expect(resolveBillingState(paid(status), at(PERIOD_END, 7 * DAY))).toBe("grace")
      expect(resolveBillingState(paid(status), at(PERIOD_END, 7 * DAY + 1))).toBe("read_only")
    }
  )

  it("pagamento pendente sem current_period_end é somente leitura", () => {
    expect(resolveBillingState(paid("past_due", { currentPeriodEnd: null }), at(PERIOD_END))).toBe(
      "read_only"
    )
  })

  it.each(["canceled", "incomplete_expired", "paused", "desconhecido", ""])(
    "%s é somente leitura mesmo dentro do período",
    (status) => {
      expect(resolveBillingState(paid(status), at(PERIOD_END, -10 * DAY))).toBe("read_only")
    }
  )

  it("não usa trial_ends_at para pagamento pendente", () => {
    const input = paid("past_due", { trialEndsAt: "2030-01-01T00:00:00.000Z" })
    expect(resolveBillingState(input, at(PERIOD_END, 8 * DAY))).toBe("read_only")
  })
})

describe("resolveBillingState: relógio", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("usa a hora atual quando now não é informado", () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(TRIAL_END, 2 * DAY))
    expect(resolveBillingState(trial())).toBe("grace")
  })
})

describe("getGraceEndsAt", () => {
  it("devolve o fim da carência do teste ou do ciclo pendente", () => {
    expect(getGraceEndsAt(trial())?.toISOString()).toBe("2026-10-06T12:00:00.000Z")
    expect(getGraceEndsAt(paid("past_due"))?.toISOString()).toBe("2026-10-22T03:00:00.000Z")
  })

  it("devolve null quando não há carência possível", () => {
    expect(getGraceEndsAt(paid("active"))).toBeNull()
    expect(getGraceEndsAt(paid("canceled"))).toBeNull()
    expect(getGraceEndsAt(paid("unpaid", { currentPeriodEnd: null }))).toBeNull()
  })
})

describe("trialDaysRemaining", () => {
  it("arredonda os dias restantes para cima", () => {
    expect(trialDaysRemaining(TRIAL_END, at(TRIAL_END, -14 * DAY))).toBe(14)
    expect(trialDaysRemaining(TRIAL_END, at(TRIAL_END, -2 * DAY - 1))).toBe(3)
    expect(trialDaysRemaining(TRIAL_END, at(TRIAL_END, -1))).toBe(1)
  })

  it("devolve 0 no fim, depois dele ou com data inválida", () => {
    expect(trialDaysRemaining(TRIAL_END, at(TRIAL_END))).toBe(0)
    expect(trialDaysRemaining(TRIAL_END, at(TRIAL_END, DAY))).toBe(0)
    expect(trialDaysRemaining("inválida", at(TRIAL_END))).toBe(0)
  })
})

describe("auxiliares", () => {
  it("só bloqueia escrita no modo leitura", () => {
    expect(isBillingWritable("trialing")).toBe(true)
    expect(isBillingWritable("active")).toBe(true)
    expect(isBillingWritable("grace")).toBe(true)
    expect(isBillingWritable("read_only")).toBe(false)
  })

  it("reconhece os status do banco e rotula os estados", () => {
    expect(isBillingStatus("incomplete_expired")).toBe(true)
    expect(isBillingStatus("expired")).toBe(false)
    expect(BILLING_STATE_LABELS.read_only).toBe("Somente leitura")
  })
})
