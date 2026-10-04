import { describe, expect, it } from "vitest"

// Import pelo nome do pacote, como o app faz: "./*" → "./src/*.ts" resolve para src/billing.ts.
import * as billing from "@workspace/core/billing"
import type { BillingState, FeatureKey, LimitKey, PlanKey } from "@workspace/core/billing"

describe("@workspace/core/billing", () => {
  it("expõe a interface combinada do contrato (§10)", () => {
    const plan: PlanKey = "equipe"
    const feature: FeatureKey = "feature_landing_pages"
    const limit: LimitKey = "users"
    const state: BillingState = "grace"

    expect(billing.PLANS[plan].limits[limit]).toBe(5)
    expect(billing.FEATURES[feature].status).toBe("available")
    expect(billing.BILLING_STATE_LABELS[state]).toBe("Em carência")
    expect(billing.TRIAL_DAYS).toBe(14)
    expect(billing.GRACE_DAYS).toBe(7)
    expect(billing.TRIAL_LIMITS.ai_conversations).toBe(0)
    expect(billing.ADDONS.length).toBeGreaterThan(0)

    for (const name of [
      "priceLookupKey",
      "seatLookupKey",
      "parseLookupKey",
      "computeLimits",
      "planHasFeature",
      "resolveBillingState",
      "isOverLimit",
      "usageRatio",
      "recommendPlan",
      "formatBRL",
    ] as const) {
      expect(typeof billing[name], name).toBe("function")
    }
  })
})
