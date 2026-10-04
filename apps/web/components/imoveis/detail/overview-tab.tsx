import Link from "next/link"

import {
  ADDRESS_DISPLAY_LABELS,
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_USAGE_LABELS,
} from "@workspace/core/properties/enums"
import type { ImobScoreResult } from "@workspace/core/properties/imob-score"
import type { Tables } from "@workspace/database/types"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { DetailItem, DetailList } from "@/components/imoveis/detail/detail-list"
import { formatFloor, formatPostalCode, formatYesNo } from "@/components/imoveis/detail/format"
import type { CondominiumSummary } from "@/components/imoveis/detail/types"
import { ImobScoreCard } from "@/components/imoveis/imob-score-card"
import { formatArea, formatCurrency, formatDateTime } from "@/lib/format"
import { getAmenityLabel } from "@/lib/imoveis/amenities"
import { ADDRESS_DISPLAY_HINTS } from "@/lib/imoveis/constants"

function formatCount(value: number | null) {
  return value == null ? "—" : String(value)
}

export function OverviewTab({
  property,
  condominium,
  capturedByName,
  brokerName,
  score,
  aside,
}: {
  property: Tables<"properties">
  condominium: CondominiumSummary | null
  capturedByName: string
  brokerName: string
  score: ImobScoreResult
  /** Cartões da coluna lateral, acima da Nota do Anúncio (ex.: sigilo). */
  aside?: React.ReactNode
}) {
  const streetLine = [property.street, property.street_number].filter(Boolean).join(", ")
  const cityLine = [property.city, property.state].filter(Boolean).join("/")

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Dados do anúncio</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList>
              <DetailItem label="Finalidade">{LISTING_PURPOSE_LABELS[property.purpose]}</DetailItem>
              <DetailItem label="Uso">{PROPERTY_USAGE_LABELS[property.usage]}</DetailItem>
              <DetailItem label="Tipo">{PROPERTY_TYPE_LABELS[property.type]}</DetailItem>
              <DetailItem label="Condomínio">
                {condominium ? (
                  <Link
                    href={`/condominios/${condominium.id}`}
                    className="underline underline-offset-4 hover:text-primary"
                  >
                    {condominium.name}
                  </Link>
                ) : (
                  "—"
                )}
              </DetailItem>
              <DetailItem label="Captador">{capturedByName}</DetailItem>
              <DetailItem label="Corretor">{brokerName}</DetailItem>
              <DetailItem label="Matrícula">{property.registry_number || "—"}</DetailItem>
            </DetailList>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Características</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DetailList>
              <DetailItem label="Área útil">{formatArea(property.living_area)}</DetailItem>
              <DetailItem label="Área total">{formatArea(property.lot_area)}</DetailItem>
              <DetailItem label="Quartos">{formatCount(property.bedrooms)}</DetailItem>
              <DetailItem label="Suítes">{formatCount(property.suites)}</DetailItem>
              <DetailItem label="Banheiros">{formatCount(property.bathrooms)}</DetailItem>
              <DetailItem label="Vagas">{formatCount(property.parking_spaces)}</DetailItem>
              <DetailItem label="Andar">{formatFloor(property.floor)}</DetailItem>
              <DetailItem label="Total de andares">{formatCount(property.total_floors)}</DetailItem>
              <DetailItem label="Ano de construção">{formatCount(property.year_built)}</DetailItem>
              <DetailItem label="Mobiliado">{formatYesNo(property.furnished)}</DetailItem>
              <DetailItem label="Aceita pet">{formatYesNo(property.accepts_pets)}</DetailItem>
              <DetailItem label="Aceita permuta">
                {formatYesNo(property.accepts_exchange)}
              </DetailItem>
            </DetailList>
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">Comodidades</span>
              {property.features.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {property.features.map((feature) => (
                    <Badge key={feature} variant="secondary">
                      {getAmenityLabel(feature)}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma comodidade informada.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Endereço</CardTitle>
            <CardDescription>
              Nos portais: {ADDRESS_DISPLAY_LABELS[property.address_display]}.{" "}
              {ADDRESS_DISPLAY_HINTS[property.address_display]}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList>
              <DetailItem label="Logradouro" className="col-span-2">
                {streetLine || "—"}
              </DetailItem>
              <DetailItem label="Complemento">{property.complement || "—"}</DetailItem>
              <DetailItem label="Bairro">{property.neighborhood || "—"}</DetailItem>
              <DetailItem label="Cidade/UF">{cityLine || "—"}</DetailItem>
              <DetailItem label="CEP">{formatPostalCode(property.postal_code)}</DetailItem>
              {property.latitude != null && property.longitude != null ? (
                <DetailItem label="Coordenadas" className="col-span-2">
                  <span className="tabular-nums">
                    {property.latitude}, {property.longitude}
                  </span>
                </DetailItem>
              ) : null}
            </DetailList>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Valores</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList>
              {property.purpose !== "rent" ? (
                <DetailItem label="Venda">{formatCurrency(property.sale_price)}</DetailItem>
              ) : null}
              {property.purpose !== "sale" ? (
                <DetailItem label="Locação (mês)">{formatCurrency(property.rent_price)}</DetailItem>
              ) : null}
              <DetailItem label="Condomínio (mês)">{formatCurrency(property.condo_fee)}</DetailItem>
              <DetailItem label="IPTU anual">{formatCurrency(property.iptu_yearly)}</DetailItem>
            </DetailList>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Descrição</CardTitle>
          </CardHeader>
          <CardContent>
            {property.description?.trim() ? (
              <p className="text-sm leading-relaxed wrap-break-word whitespace-pre-line">
                {property.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Sem descrição.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registro</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList>
              <DetailItem label="Cadastrado em">{formatDateTime(property.created_at)}</DetailItem>
              <DetailItem label="Atualizado em">{formatDateTime(property.updated_at)}</DetailItem>
              <DetailItem label="Publicado em">
                {property.published_at ? formatDateTime(property.published_at) : "Não publicado"}
              </DetailItem>
            </DetailList>
          </CardContent>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {aside}
        <ImobScoreCard result={score} title="Nota do Anúncio" />
      </div>
    </div>
  )
}
