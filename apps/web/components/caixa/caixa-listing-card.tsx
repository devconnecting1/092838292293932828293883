import Link from "next/link"
import { BedDoubleIcon, CarIcon, ExternalLinkIcon, RulerIcon, UsersIcon } from "lucide-react"

import { CAIXA_GRID_PHOTO_INDEX } from "@workspace/core/caixa/source"
import { PROPERTY_TYPE_LABELS } from "@workspace/core/properties/enums"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardFooter } from "@workspace/ui/components/card"

import { CaixaFavoriteButton } from "@/components/caixa/caixa-favorite-button"
import { CaixaPhoto } from "@/components/caixa/caixa-photo"
import { CAIXA_BASE_PATH } from "@/lib/caixa/constants"
import type { CaixaListingItem } from "@/lib/caixa/list-queries"
import { formatArea, formatCurrency, formatDate } from "@/lib/format"

const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 })

export function caixaListingTitle(item: CaixaListingItem) {
  const place = [item.bairro, `${item.cidade}/${item.uf}`].filter(Boolean).join(", ")

  return `${PROPERTY_TYPE_LABELS[item.tipo]} em ${place}`
}

/** Área mais representativa do que o arquivo informou, sem inventar nada. */
function mainArea(item: CaixaListingItem) {
  const area = item.areaPrivativa ?? item.areaTotal ?? item.areaTerreno

  if (area === null) {
    return null
  }

  const label =
    item.areaPrivativa !== null ? "privativa" : item.areaTotal !== null ? "total" : "do terreno"

  return `${formatArea(area)} ${label}`
}

export function CaixaListingCard({
  item,
  photosEnabled,
}: {
  item: CaixaListingItem
  photosEnabled: boolean
}) {
  const title = caixaListingTitle(item)
  const area = mainArea(item)
  const delisted = item.saiuDaListaEm !== null

  return (
    <Card className="overflow-hidden pt-0">
      <CaixaPhoto
        numero={item.numero}
        // Só o índice 0 na lista: uma requisição por card, nunca uma rajada.
        index={CAIXA_GRID_PHOTO_INDEX}
        enabled={photosEnabled}
        alt={title}
        // 16:9 na lista (mais baixa que a galeria do detalhe, que segue 4:3).
        className="aspect-video w-full"
      />
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {item.modalidade ? <Badge variant="secondary">{item.modalidade}</Badge> : null}
          {/* Desconto é SEMPRE o percentual que a Caixa publica. Nunca calcule
              a partir de preço e avaliação: em 26,7% dos imóveis o preço é
              maior que a avaliação e a conta daria um número inventado. */}
          {item.desconto !== null && item.desconto > 0 ? (
            <Badge>{percentFormat.format(item.desconto)}% de desconto</Badge>
          ) : null}
          {delisted ? (
            <Badge variant="outline">Saiu da lista em {formatDate(item.saiuDaListaEm)}</Badge>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">
            <Link href={`${CAIXA_BASE_PATH}/${item.numero}`} className="hover:underline">
              {title}
            </Link>
          </h3>
          <p className="line-clamp-2 text-xs text-muted-foreground">{item.endereco}</p>
        </div>

        <div className="flex flex-col gap-0.5">
          <p className="text-lg font-semibold">{formatCurrency(item.preco)}</p>
          {item.valorAvaliacao !== null ? (
            <p className="text-xs text-muted-foreground">
              Avaliação da Caixa: {formatCurrency(item.valorAvaliacao)}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {area ? (
            <span className="inline-flex items-center gap-1">
              <RulerIcon className="size-3.5" />
              {area}
            </span>
          ) : null}
          {item.quartos !== null ? (
            <span className="inline-flex items-center gap-1">
              <BedDoubleIcon className="size-3.5" />
              {item.quartos} quarto{item.quartos > 1 ? "s" : ""}
            </span>
          ) : null}
          {item.vagas !== null ? (
            <span className="inline-flex items-center gap-1">
              <CarIcon className="size-3.5" />
              {item.vagas} vaga{item.vagas > 1 ? "s" : ""}
            </span>
          ) : null}
          {item.linkCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <UsersIcon className="size-3.5" />
              {item.linkCount} na carteira
            </span>
          ) : null}
        </div>

        {item.aceitaFinanciamento !== null ? (
          <p className="text-xs text-muted-foreground">
            {item.aceitaFinanciamento
              ? "Aceita financiamento Caixa."
              : "Não aceita financiamento Caixa."}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          render={<a href={item.link} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
        >
          Ver no site da Caixa
          <ExternalLinkIcon data-icon="inline-end" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`${CAIXA_BASE_PATH}/${item.numero}`} />}
          nativeButton={false}
        >
          Detalhes
        </Button>
        <CaixaFavoriteButton
          numero={item.numero}
          isFavorite={item.isFavorite}
          className="ms-auto"
        />
      </CardFooter>
    </Card>
  )
}
