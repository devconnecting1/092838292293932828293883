import { describe, expect, it } from "vitest"

import {
  FEATURE_GROUPS,
  FEATURE_KEYS,
  FEATURES,
  featuresForPlan,
  isFeatureKey,
  planHasFeature,
  TRIAL_EXCLUDED_FEATURES,
  type FeatureKey,
} from "./features"
import { PLAN_KEYS, type BillingPlanKey } from "./plans"

// Lista literal da pesquisa de preços, §5.3.
const RESEARCH_FEATURE_KEYS = [
  "feature_properties",
  "feature_condominiums",
  "feature_listing_score",
  "feature_capture_public_form",
  "feature_keys",
  "feature_proposals",
  "feature_clients",
  "feature_calendar_tasks",
  "feature_leads_kanban",
  "feature_multiple_pipelines",
  "feature_landing_pages",
  "feature_portal_feed_vrsync",
  "feature_team_roles_invites",
  "feature_tenant_subdomain",
  "feature_multi_branch",
  "feature_data_export",
  "feature_assisted_migration",
  "feature_ai_whatsapp",
  "feature_whatsapp_official_inbox",
  "feature_lead_roulette_sla",
  "feature_portal_leads_ingest",
  "feature_meta_lead_ads",
  "feature_portal_health",
  "feature_portal_health_alerts",
  "feature_pwa_push",
  "feature_instagram_publish",
  "feature_instagram_inbox",
  "feature_whatsapp_broadcast",
  "feature_document_inbox_email",
  "feature_maps",
  "feature_esignature",
  "feature_property_client_match",
  "feature_bi_goals",
  "feature_launches",
  "feature_api_read",
  "feature_api_full",
  "feature_webhooks",
  "feature_rental_contracts",
  "feature_rental_billing_boleto_pix",
  "feature_rental_owner_payout",
  "feature_rental_adjustment",
  "feature_dimob",
  "feature_nfse",
  "feature_creci_compliance",
  "feature_lgpd_consent_audit",
  "feature_priority_support",
  "feature_success_manager",
  "feature_sla_credit",
]

// Entregues depois da pesquisa e anunciados como prontos (16/09/2026).
const DELIVERED_FEATURE_KEYS = [
  "feature_authorization_expiry_alerts",
  "feature_property_sheet_pdf",
  "feature_property_public_page",
  "feature_spreadsheet_import",
  // Entregues em 17/09/2026: e-mails automáticos em /perfil.
  "feature_email_reminders",
  "feature_weekly_report_email",
]

describe("FEATURES", () => {
  it("usa as chaves da §5.3 mais as entregues depois, e nenhuma outra", () => {
    expect([...FEATURE_KEYS].sort()).toEqual(
      [...RESEARCH_FEATURE_KEYS, ...DELIVERED_FEATURE_KEYS].sort()
    )
    expect(Object.keys(FEATURES)).toEqual([...FEATURE_KEYS])
  })

  it("tem textos, grupo válido e ao menos um plano em cada recurso", () => {
    for (const key of FEATURE_KEYS) {
      const feature = FEATURES[key]
      expect(feature.label.trim(), key).not.toBe("")
      expect(feature.description.trim(), key).not.toBe("")
      expect(FEATURE_GROUPS, key).toContain(feature.group)
      expect(["available", "soon"], key).toContain(feature.status)
      expect(feature.plans.length, key).toBeGreaterThan(0)
      for (const plan of feature.plans) {
        expect(PLAN_KEYS, key).toContain(plan)
      }
    }
  })

  it("agrupa os recursos na ordem de FEATURE_GROUPS", () => {
    const groupOrder = FEATURE_KEYS.map((key) => FEATURE_GROUPS.indexOf(FEATURES[key].group))
    expect(groupOrder).toEqual([...groupOrder].sort((a, b) => a - b))
  })

  it("marca como disponível o que já tem tela no app", () => {
    const available: FeatureKey[] = [
      "feature_properties",
      "feature_condominiums",
      "feature_listing_score",
      "feature_capture_public_form",
      "feature_keys",
      // Painel, filtro de /imoveis e fila de e-mails; /api/imoveis/[id]/ficha
      "feature_authorization_expiry_alerts",
      "feature_property_sheet_pdf",
      "feature_clients",
      "feature_calendar_tasks",
      // /perfil: resumo diário e lembrete de visita (lib/lembretes)
      "feature_email_reminders",
      "feature_leads_kanban",
      "feature_proposals",
      "feature_property_client_match",
      "feature_landing_pages",
      // app/imovel/[org]/[codigo]
      "feature_property_public_page",
      "feature_portal_feed_vrsync",
      "feature_team_roles_invites",
      "feature_tenant_subdomain",
      // /configuracoes/rodizio
      "feature_lead_roulette_sla",
      // /perfil: avisos no celular (app/manifest.ts, public/sw.js e lib/push)
      "feature_pwa_push",
      // /configuracoes/integracoes + app/api/webhooks (conta do cliente no fornecedor)
      "feature_portal_leads_ingest",
      "feature_meta_lead_ads",
      // /relatorios e /api/relatorios/[recurso]
      "feature_bi_goals",
      "feature_weekly_report_email",
      "feature_data_export",
      // /configuracoes/importacao
      "feature_spreadsheet_import",
      // /configuracoes/equipe e histórico do cliente
      "feature_creci_compliance",
      "feature_lgpd_consent_audit",
    ]
    for (const key of available) {
      expect(FEATURES[key].status, key).toBe("available")
    }
  })

  it("marca como em breve o que ainda não tem tela", () => {
    const soon: FeatureKey[] = [
      "feature_ai_whatsapp",
      // Conectar o número existe; atender pela caixa, não (sendWhatsappMessage sem tela).
      "feature_whatsapp_official_inbox",
      "feature_whatsapp_broadcast",
      "feature_portal_health",
      "feature_portal_health_alerts",
      "feature_instagram_publish",
      "feature_instagram_inbox",
      "feature_document_inbox_email",
      "feature_maps",
      "feature_esignature",
      "feature_launches",
      "feature_api_read",
      "feature_api_full",
      "feature_webhooks",
      "feature_rental_contracts",
      "feature_rental_billing_boleto_pix",
      "feature_rental_owner_payout",
      "feature_rental_adjustment",
      "feature_dimob",
      "feature_nfse",
      "feature_multiple_pipelines",
      "feature_multi_branch",
      "feature_sla_credit",
    ]
    for (const key of soon) {
      expect(FEATURES[key].status, key).toBe("soon")
    }
  })

  it("integração que depende da conta do cliente diz isso na descrição e na tabela", () => {
    for (const key of ["feature_portal_leads_ingest", "feature_meta_lead_ads"] as const) {
      const feature = FEATURES[key]
      expect(feature.description, key).toMatch(/Exige .* da imobiliária/)
      for (const plan of feature.plans) {
        expect(feature.notes?.[plan], `${key} ${plan}`).toMatch(/^Com a sua conta/)
      }
    }
  })

  it("os recursos entregues depois da pesquisa valem em todos os planos (nada trava por plano)", () => {
    for (const key of DELIVERED_FEATURE_KEYS as FeatureKey[]) {
      expect(FEATURES[key].status, key).toBe("available")
      for (const plan of PLAN_KEYS) {
        expect(planHasFeature(plan, key), `${key} ${plan}`).toBe(true)
      }
    }
  })

  it("a página pública do imóvel diz que é grátis e fica fora do limite de landing pages", () => {
    const feature = FEATURES.feature_property_public_page
    expect(feature.description).toMatch(/grátis/i)
    expect(feature.description).toContain("não conta no limite de landing pages")
    for (const plan of PLAN_KEYS) {
      expect(feature.notes?.[plan], plan).toMatch(/fora do limite/)
    }
  })

  it("o aviso no celular diz o que aparece na tela e a exigência do iPhone", () => {
    const { description } = FEATURES.feature_pwa_push
    expect(description).toMatch(/só o nome e a origem do lead/)
    expect(description).toMatch(/No iPhone e no iPad, exige o CRM adicionado à tela de início/)
  })

  it("o relatório semanal por e-mail diz que chega só para dono e gerente", () => {
    expect(FEATURES.feature_weekly_report_email.description).toMatch(
      /Chega só para o dono e o gerente/
    )
  })

  it("a exportação cita a permissão por papel e o registro de quem exportou", () => {
    const { description } = FEATURES.feature_data_export
    expect(description).toMatch(/papéis exportam/)
    expect(description).toMatch(/registrada com quem exportou/)
  })

  it("a migração assistida lembra que a planilha a própria imobiliária importa", () => {
    expect(FEATURES.feature_assisted_migration.description).toMatch(
      /Planilhas de clientes, leads e imóveis a própria imobiliária já importa sozinha/
    )
  })

  it("não usa termos em inglês no rótulo nem nas observações da tabela", () => {
    for (const key of FEATURE_KEYS) {
      const { label, notes } = FEATURES[key]
      expect(label, key).not.toMatch(/\bmatch\b|add-on/i)
      for (const note of Object.values(notes ?? {})) {
        expect(note, key).not.toMatch(/add-on/i)
      }
    }
  })

  it("não promete imóvel ilimitado", () => {
    for (const key of FEATURE_KEYS) {
      const { label, description } = FEATURES[key]
      const text = `${label} ${description}`
      if (/imóve/i.test(text)) {
        expect(text, key).not.toMatch(/imóveis ilimitados|sem limite de quantidade/i)
      }
    }
    expect(FEATURES.feature_properties.description).toContain("seguem o limite do plano")
  })
})

describe("planHasFeature", () => {
  it("inclui os módulos básicos em todos os planos", () => {
    for (const plan of PLAN_KEYS) {
      expect(planHasFeature(plan, "feature_properties")).toBe(true)
      expect(planHasFeature(plan, "feature_landing_pages")).toBe(true)
      expect(planHasFeature(plan, "feature_portal_feed_vrsync")).toBe(true)
    }
  })

  it("respeita a inclusão por plano da §3.3", () => {
    expect(planHasFeature("corretor", "feature_lead_roulette_sla")).toBe(false)
    expect(planHasFeature("imobiliaria", "feature_lead_roulette_sla")).toBe(true)
    expect(planHasFeature("corretor", "feature_rental_contracts")).toBe(false)
    expect(planHasFeature("imobiliaria", "feature_rental_contracts")).toBe(true)
    expect(planHasFeature("imobiliaria", "feature_bi_goals")).toBe(false)
    expect(planHasFeature("equipe", "feature_bi_goals")).toBe(true)
    expect(planHasFeature("equipe", "feature_api_read")).toBe(true)
    expect(planHasFeature("equipe", "feature_api_full")).toBe(false)
    expect(planHasFeature("equipe", "feature_launches")).toBe(false)
    expect(planHasFeature("rede", "feature_launches")).toBe(true)
    expect(planHasFeature("equipe", "feature_multi_branch")).toBe(false)
    expect(planHasFeature("rede", "feature_multi_branch")).toBe(true)
  })

  it("dá ao teste grátis os recursos do Equipe, menos a IA", () => {
    expect(TRIAL_EXCLUDED_FEATURES).toEqual(["feature_ai_whatsapp"])
    expect(planHasFeature("equipe", "feature_ai_whatsapp")).toBe(true)
    expect(planHasFeature("trial", "feature_ai_whatsapp")).toBe(false)

    for (const key of FEATURE_KEYS) {
      const expected = TRIAL_EXCLUDED_FEATURES.includes(key) ? false : planHasFeature("equipe", key)
      expect(planHasFeature("trial", key), key).toBe(expected)
    }
    expect(featuresForPlan("trial")).toEqual(
      featuresForPlan("equipe").filter((key) => !TRIAL_EXCLUDED_FEATURES.includes(key))
    )
  })

  it("é cumulativo: cada plano tem tudo do plano anterior", () => {
    for (let index = 1; index < PLAN_KEYS.length; index++) {
      const lower = featuresForPlan(PLAN_KEYS[index - 1] as BillingPlanKey)
      const higher = featuresForPlan(PLAN_KEYS[index] as BillingPlanKey)
      expect(higher).toEqual(expect.arrayContaining(lower))
      expect(higher.length).toBeGreaterThan(lower.length)
    }
  })

  it("devolve false para plano ou recurso desconhecido", () => {
    expect(planHasFeature("ouro" as BillingPlanKey, "feature_properties")).toBe(false)
    expect(planHasFeature("rede", "feature_teleporte" as FeatureKey)).toBe(false)
    expect(planHasFeature("rede", "toString" as FeatureKey)).toBe(false)
  })
})

describe("isFeatureKey", () => {
  it("aceita só chaves do catálogo", () => {
    expect(isFeatureKey("feature_maps")).toBe(true)
    expect(isFeatureKey("feature_inexistente")).toBe(false)
    expect(isFeatureKey("constructor")).toBe(false)
    expect(isFeatureKey(42)).toBe(false)
  })
})
