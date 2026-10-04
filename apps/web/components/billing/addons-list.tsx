import { ADDONS, PLAN_KEYS, PLANS } from "@workspace/core/billing"
import { Badge } from "@workspace/ui/components/badge"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemTitle,
} from "@workspace/ui/components/item"

import { AddonPurchaseButton } from "@/components/billing/addon-purchase-button"

/**
 * Adicionais com preço e planos no rodapé. Os "em breve" não têm compra; o
 * contratável (pacotes de +10 imóveis) ganha a ação de contratar.
 */
export function AddonsList() {
  return (
    <div className="flex flex-col gap-4">
      <ItemGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ADDONS.map((addon) => (
          <Item
            key={addon.key}
            variant="outline"
            role="listitem"
            className="flex-col flex-nowrap items-stretch gap-3 p-4"
          >
            <ItemHeader className="basis-auto items-start">
              <ItemTitle className="line-clamp-none">{addon.name}</ItemTitle>
              {addon.status === "available" ? (
                <Badge variant="secondary">Disponível</Badge>
              ) : (
                <Badge variant="outline">Em breve</Badge>
              )}
            </ItemHeader>
            <ItemContent>
              <ItemDescription className="line-clamp-none">{addon.description}</ItemDescription>
            </ItemContent>
            <ItemFooter className="basis-auto flex-col items-start gap-2 border-t pt-3">
              <div className="flex flex-col gap-1">
                <p className="font-medium tabular-nums">{addon.priceLabel}</p>
                <p className="text-muted-foreground">
                  {addon.plans.length < PLAN_KEYS.length
                    ? `${addon.plans.length === 1 ? "Plano" : "Planos"}: ${addon.plans.map((plan) => PLANS[plan].name).join(", ")}`
                    : "Todos os planos"}
                </p>
              </div>
              {addon.status === "available" ? <AddonPurchaseButton addonKey={addon.key} /> : null}
            </ItemFooter>
          </Item>
        ))}
      </ItemGroup>
      <p className="text-sm text-muted-foreground">
        Todo plano já vem com um endereço exclusivo da imobiliária, sem custo. O adicional é
        opcional e cobrado só se você contratar: não cobramos implantação nem hora técnica.
      </p>
    </div>
  )
}
