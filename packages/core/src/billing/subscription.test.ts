import { describe, expect, it } from "vitest"

import { PLANS } from "./plans"
import { describeSubscriptionItems, subscriptionBillingFields } from "./subscription"

/**
 * Evento de exemplo `customer.subscription.updated` (formato da API
 * 2026-08-26.dahlia, só os campos lidos): plano Corretor mensal, 1 usuário
 * extra e 2 pacotes de +10 imóveis. O webhook relê a assinatura na API e passa
 * `items.data` por subscriptionBillingFields — é essa conversão que o teste cobre.
 */
const PERIOD_END = 1_792_195_200 // 2026-10-17T00:00:00Z

const sampleEvent = {
  id: "evt_test_owned_listings",
  object: "event",
  type: "customer.subscription.updated",
  livemode: false,
  data: {
    object: {
      id: "sub_test123",
      object: "subscription",
      customer: "cus_test123",
      status: "active",
      metadata: { organization_id: "00000000-0000-4000-8000-000000000001" },
      items: {
        object: "list",
        data: [
          {
            id: "si_plan",
            object: "subscription_item",
            quantity: 1,
            current_period_end: PERIOD_END,
            price: { id: "price_plan", lookup_key: "plan_corretor_monthly", unit_amount: 11500 },
          },
          {
            id: "si_seat",
            object: "subscription_item",
            quantity: 1,
            current_period_end: PERIOD_END,
            price: { id: "price_seat", lookup_key: "seat_corretor_monthly", unit_amount: 4900 },
          },
          {
            id: "si_listings",
            object: "subscription_item",
            quantity: 2,
            current_period_end: PERIOD_END,
            price: {
              id: "price_listings",
              lookup_key: "addon_owned_listings_monthly",
              unit_amount: 1900,
            },
          },
          {
            id: "si_other",
            object: "subscription_item",
            quantity: 7,
            current_period_end: PERIOD_END - 10,
            price: { id: "price_other", lookup_key: null, unit_amount: 100 },
          },
        ],
      },
    },
  },
} as const

type SampleItem = (typeof sampleEvent.data.object.items.data)[number]

function withItems(items: SampleItem[]) {
  return items
}

describe("describeSubscriptionItems", () => {
  it("separa plano, usuários extras e pacotes de imóveis pelas lookup keys", () => {
    const composition = describeSubscriptionItems(sampleEvent.data.object.items.data)

    expect(composition.plan).toMatchObject({ key: "corretor", interval: "month" })
    expect(composition.plan?.item.id).toBe("si_plan")
    expect(composition.extraSeats).toBe(1)
    expect(composition.seatItems.map((item) => item.id)).toEqual(["si_seat"])
    expect(composition.ownedListingPacks).toBe(2)
    expect(composition.ownedListingItems.map((item) => item.id)).toEqual(["si_listings"])
    expect(composition.periodEnd).toBe(PERIOD_END)
  })

  it("sem item de pacote, zero pacotes", () => {
    const [plan] = sampleEvent.data.object.items.data
    const composition = describeSubscriptionItems(withItems(plan ? [plan] : []))

    expect(composition.ownedListingPacks).toBe(0)
    expect(composition.ownedListingItems).toEqual([])
  })
})

describe("subscriptionBillingFields (webhook com evento de exemplo)", () => {
  it("grava pacotes, adicional e limite somado para o banco", () => {
    const fields = subscriptionBillingFields(sampleEvent.data.object.items.data)

    expect(fields).not.toBeNull()
    expect(fields).toMatchObject({
      plan_key: "corretor",
      billing_interval: "month",
      seats: 2,
      owned_listing_packs: 2,
      addon_keys: ["owned_listings"],
      current_period_end: "2026-10-17T00:00:00.000Z",
    })
    // 5 do Corretor + 2 × 10: é o número que o gatilho do banco lê.
    expect(fields?.limits.owned_listings).toBe(25)
    expect(fields?.limits.photos_per_listing).toBe(PLANS.corretor.limits.photos_per_listing)
    expect(fields?.features).toEqual(PLANS.corretor.features)
  })

  it("remover os pacotes volta ao limite do plano e limpa o adicional", () => {
    const items = sampleEvent.data.object.items.data.filter((item) => item.id !== "si_listings")
    const fields = subscriptionBillingFields(items)

    expect(fields).toMatchObject({ owned_listing_packs: 0, addon_keys: [] })
    expect(fields?.limits.owned_listings).toBe(PLANS.corretor.limits.owned_listings)
  })

  it("capa a quantidade no teto do app e ignora assinatura sem plano", () => {
    const items = sampleEvent.data.object.items.data.map((item) =>
      item.id === "si_listings" ? { ...item, quantity: 5000 } : item
    )

    expect(subscriptionBillingFields(items)?.owned_listing_packs).toBe(200)
    expect(
      subscriptionBillingFields(
        sampleEvent.data.object.items.data.filter((item) => item.id !== "si_plan")
      )
    ).toBeNull()
  })
})
