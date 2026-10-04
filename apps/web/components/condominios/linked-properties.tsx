import Link from "next/link"
import { HouseIcon, PlusIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { ImobScoreBadge } from "@/components/imoveis/imob-score-badge"
import { PropertyCover } from "@/components/imoveis/property-cover"
import { PropertyStatusBadge } from "@/components/imoveis/property-status-badge"
import { formatPropertiesCount } from "@/lib/condominios/format"
import type { LinkedProperty } from "@/lib/condominios/queries"
import { formatCurrency, formatNumber } from "@/lib/format"
import { getDisplayPrices } from "@/lib/imoveis/mappers"

function formatPriceSummary(property: LinkedProperty) {
  const prices = getDisplayPrices(property)
  if (prices.length === 0) return "Preço não informado"

  return prices
    .map((price) =>
      price.value == null
        ? `${price.label}: sem preço`
        : `${price.label} ${formatCurrency(price.value)}${price.suffix ?? ""}`
    )
    .join(" · ")
}

type LinkedPropertiesProps = {
  properties: LinkedProperty[]
  total: number
  canCreateProperty: boolean
}

export function LinkedProperties({ properties, total, canCreateProperty }: LinkedPropertiesProps) {
  return (
    <section aria-labelledby="condominio-imoveis-vinculados" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="condominio-imoveis-vinculados" className="text-lg font-semibold tracking-tight">
          Imóveis vinculados
        </h2>
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? "Nenhum imóvel usa este condomínio."
            : `${formatPropertiesCount(total)} ${total === 1 ? "vinculado" : "vinculados"} a este condomínio.`}
        </p>
      </div>

      {properties.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HouseIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum imóvel vinculado</EmptyTitle>
            <EmptyDescription>
              Ao cadastrar ou editar um imóvel, selecione este condomínio para vinculá-lo.
            </EmptyDescription>
          </EmptyHeader>
          {canCreateProperty ? (
            <EmptyContent>
              <Button render={<Link href="/imoveis/novo" />} nativeButton={false}>
                <PlusIcon data-icon="inline-start" />
                Novo imóvel
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {properties.map((property) => (
            <div role="listitem" key={property.id}>
              <Item variant="outline" render={<Link href={`/imoveis/${property.id}`} />}>
                <ItemMedia variant="image">
                  <PropertyCover storagePath={property.coverPath} alt="" className="size-full" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full">
                    <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                      {property.code}
                    </span>
                    <span className="truncate">{property.title}</span>
                  </ItemTitle>
                  <ItemDescription className="tabular-nums">
                    {formatPriceSummary(property)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <PropertyStatusBadge status={property.status} />
                  <ImobScoreBadge score={property.imob_score} />
                </ItemActions>
              </Item>
            </div>
          ))}
        </ItemGroup>
      )}

      {total > properties.length ? (
        <p className="text-sm text-muted-foreground">
          Mostrando os {formatNumber(properties.length)} primeiros de {formatNumber(total)} imóveis.
        </p>
      ) : null}
    </section>
  )
}
