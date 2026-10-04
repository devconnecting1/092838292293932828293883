import { describe, expect, it } from "vitest"

import {
  aiUsageRatio,
  buildOrganizationListHref,
  checkActionReason,
  extendedTrialEnd,
  hasActiveOrganizationFilters,
  isPlatformAccountActionErrorCode,
  parseOrganizationListFilters,
  platformPlanLabel,
  resolveAccountMilestone,
  resolveAccountSituation,
  trialExtensionBlocker,
} from "./accounts"

const NOW = new Date("2026-09-17T12:00:00Z")

describe("resolveAccountSituation", () => {
  it("segue o status da Stripe, igual ao SQL", () => {
    expect(resolveAccountSituation("trialing", null)).toBe("teste")
    expect(resolveAccountSituation("active", null)).toBe("ativa")
    expect(resolveAccountSituation("past_due", null)).toBe("em_atraso")
    expect(resolveAccountSituation("unpaid", null)).toBe("em_atraso")
    expect(resolveAccountSituation("incomplete", null)).toBe("em_atraso")
    expect(resolveAccountSituation("canceled", null)).toBe("cancelada")
    expect(resolveAccountSituation("paused", null)).toBe("cancelada")
    expect(resolveAccountSituation(null, null)).toBe("cancelada")
  })

  it("o bloqueio da plataforma vence qualquer status", () => {
    expect(resolveAccountSituation("active", "2026-09-16T10:00:00Z")).toBe("bloqueada")
    expect(resolveAccountSituation("trialing", new Date())).toBe("bloqueada")
  })
})

describe("platformPlanLabel", () => {
  it("usa os nomes do catálogo e o teste grátis", () => {
    expect(platformPlanLabel("trial")).toBe("Teste grátis")
    expect(platformPlanLabel("imobiliaria")).toBe("Imobiliária")
    expect(platformPlanLabel("desconhecido")).toBe("desconhecido")
    expect(platformPlanLabel(null)).toBe("Sem plano")
  })
})

describe("resolveAccountMilestone", () => {
  const base = { cancelAtPeriodEnd: false }

  it("teste local usa trial_ends_at; teste da Stripe usa o fim do período", () => {
    expect(
      resolveAccountMilestone({
        ...base,
        status: "trialing",
        planKey: "trial",
        trialEndsAt: "2026-09-20T12:00:00Z",
        currentPeriodEnd: "2026-09-25T12:00:00Z",
      })
    ).toEqual({ kind: "fim_do_teste", at: "2026-09-20T12:00:00Z" })

    expect(
      resolveAccountMilestone({
        ...base,
        status: "trialing",
        planKey: "equipe",
        trialEndsAt: "2026-09-20T12:00:00Z",
        currentPeriodEnd: "2026-09-25T12:00:00Z",
      })
    ).toEqual({ kind: "fim_do_teste", at: "2026-09-25T12:00:00Z" })
  })

  it("ativa mostra a próxima cobrança ou o cancelamento agendado", () => {
    const active = {
      status: "active",
      planKey: "equipe",
      trialEndsAt: null,
      currentPeriodEnd: "2026-10-01T12:00:00Z",
    }

    expect(resolveAccountMilestone({ ...active, cancelAtPeriodEnd: false })?.kind).toBe(
      "proxima_cobranca"
    )
    expect(resolveAccountMilestone({ ...active, cancelAtPeriodEnd: true })?.kind).toBe(
      "fim_do_acesso"
    )
  })

  it("em atraso mostra o fim da carência (+7 dias); cancelada não tem marco", () => {
    expect(
      resolveAccountMilestone({
        ...base,
        status: "past_due",
        planKey: "equipe",
        trialEndsAt: null,
        currentPeriodEnd: "2026-09-12T12:00:00Z",
      })
    ).toEqual({ kind: "fim_da_carencia", at: "2026-09-19T12:00:00.000Z" })

    expect(
      resolveAccountMilestone({
        ...base,
        status: "canceled",
        planKey: "equipe",
        trialEndsAt: null,
        currentPeriodEnd: "2026-09-12T12:00:00Z",
      })
    ).toBeNull()
  })
})

describe("aiUsageRatio", () => {
  it("calcula a fração do teto e ignora teto zero", () => {
    expect(aiUsageRatio(300, 600)).toBe(0.5)
    expect(aiUsageRatio(900, 600)).toBe(1.5)
    expect(aiUsageRatio(0, 0)).toBeNull()
    expect(aiUsageRatio(null, 600)).toBeNull()
  })
})

describe("checkActionReason", () => {
  it("exige de 3 a 1.000 caracteres sem os espaços das pontas", () => {
    expect(checkActionReason("")).toMatchObject({ ok: false })
    expect(checkActionReason("   ab   ")).toMatchObject({ ok: false })
    expect(checkActionReason(null)).toMatchObject({ ok: false })
    expect(checkActionReason("x".repeat(1001))).toMatchObject({ ok: false })
    expect(checkActionReason("  Pedido do cliente  ")).toEqual({
      ok: true,
      reason: "Pedido do cliente",
    })
  })
})

describe("prorrogação do teste", () => {
  const localTrial = {
    status: "trialing",
    planKey: "trial",
    hasSubscription: false,
    trialEndsAt: "2026-09-20T12:00:00Z",
  }

  it("conta do fim atual ou de agora, o que for maior", () => {
    expect(extendedTrialEnd("2026-09-20T12:00:00Z", 7, NOW).toISOString()).toBe(
      "2026-09-27T12:00:00.000Z"
    )
    expect(extendedTrialEnd("2026-09-01T12:00:00Z", 14, NOW).toISOString()).toBe(
      "2026-10-01T12:00:00.000Z"
    )
  })

  it("só o teste grátis local, até agora + 45 dias", () => {
    expect(trialExtensionBlocker(localTrial, 14, NOW)).toBeNull()
    expect(trialExtensionBlocker({ ...localTrial, status: "active" }, 7, NOW)).toBe(
      "conta_fora_do_teste"
    )
    expect(trialExtensionBlocker({ ...localTrial, planKey: "equipe" }, 7, NOW)).toBe(
      "teste_controlado_pela_stripe"
    )
    expect(trialExtensionBlocker({ ...localTrial, hasSubscription: true }, 7, NOW)).toBe(
      "teste_controlado_pela_stripe"
    )
    expect(
      trialExtensionBlocker({ ...localTrial, trialEndsAt: "2026-10-20T12:00:00Z" }, 14, NOW)
    ).toBe("limite_de_prorrogacao")
  })

  it("reconhece só os códigos de erro conhecidos das RPCs", () => {
    expect(isPlatformAccountActionErrorCode("conta_ja_bloqueada")).toBe(true)
    expect(isPlatformAccountActionErrorCode("Acesso negado.")).toBe(false)
    expect(isPlatformAccountActionErrorCode("toString")).toBe(false)
  })
})

describe("filtros da lista", () => {
  it("lê a URL e descarta valores inválidos", () => {
    expect(
      parseOrganizationListFilters({
        busca: "  Casa   Nova ",
        situacao: "bloqueada",
        plano: "equipe",
        pagina: "3",
      })
    ).toEqual({ busca: "Casa Nova", situacao: "bloqueada", plano: "equipe", pagina: 3 })

    expect(
      parseOrganizationListFilters({ situacao: "vencida", plano: "ouro", pagina: "-2" })
    ).toEqual({ busca: "", situacao: "", plano: "", pagina: 1 })
  })

  it("monta a URL sem página 1 nem vazios", () => {
    expect(buildOrganizationListHref({ busca: "", situacao: "", plano: "", pagina: 1 })).toBe(
      "/plataforma/imobiliarias"
    )
    expect(buildOrganizationListHref({ busca: "casa nova", situacao: "teste", pagina: 2 })).toBe(
      "/plataforma/imobiliarias?busca=casa+nova&situacao=teste&pagina=2"
    )
    expect(
      hasActiveOrganizationFilters({ busca: "", situacao: "", plano: "trial", pagina: 1 })
    ).toBe(true)
  })
})
