import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { CondominiumDetailActions } from "@/components/condominios/condominium-detail-actions"
import { LinkedProperties } from "@/components/condominios/linked-properties"
import { PageHeading } from "@/components/crm/page-placeholder"
import { requireMembership } from "@/lib/auth/session"
import {
  formatAmenitiesCount,
  formatCondominiumAddressLines,
  formatCondominiumLocation,
} from "@/lib/condominios/format"
import { getCondominium, getLinkedProperties } from "@/lib/condominios/queries"
import type { CondominiumFormSource } from "@/lib/condominios/schema"
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format"
import { getAmenityLabel } from "@/lib/imoveis/amenities"
import { isUuid } from "@/lib/imoveis/ids"
import {
  canCreateProperty,
  canDeleteCondominium,
  canEditCondominium,
} from "@/lib/imoveis/permissions"
import { createClient } from "@/lib/supabase/server"

type CondominioPageProps = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: CondominioPageProps): Promise<Metadata> {
  const [{ id }, { membership }] = await Promise.all([params, requireMembership()])
  const condominium = await getCondominium(membership.organizationId, id)

  return { title: condominium ? condominium.name : "Condomínio não encontrado" }
}

export default async function CondominioPage({ params }: CondominioPageProps) {
  const [{ id }, { user, membership }] = await Promise.all([params, requireMembership()])

  if (!isUuid(id)) {
    notFound()
  }

  const organizationId = membership.organizationId
  const supabase = await createClient()
  const [condominium, linked] = await Promise.all([
    getCondominium(organizationId, id),
    getLinkedProperties(supabase, organizationId, id),
  ])

  if (!condominium) {
    notFound()
  }

  const { role } = membership
  const location = formatCondominiumLocation(condominium)
  const addressLines = formatCondominiumAddressLines(condominium)
  const avgCondoFee = condominium.avg_condo_fee
  const formSource: CondominiumFormSource = {
    id: condominium.id,
    name: condominium.name,
    postal_code: condominium.postal_code,
    street: condominium.street,
    street_number: condominium.street_number,
    complement: condominium.complement,
    neighborhood: condominium.neighborhood,
    city: condominium.city,
    state: condominium.state,
    amenities: condominium.amenities,
    avg_condo_fee: condominium.avg_condo_fee,
    notes: condominium.notes,
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          render={<Link href="/condominios" />}
          nativeButton={false}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Condomínios
        </Button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PageHeading
            title={condominium.name}
            description={location ?? "Endereço não informado"}
          />
          <CondominiumDetailActions
            condominium={formSource}
            canEdit={canEditCondominium(role, user.id, condominium.created_by)}
            canDelete={canDeleteCondominium(role)}
            linkedPropertiesCount={linked.total}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Endereço</CardTitle>
          </CardHeader>
          <CardContent>
            {addressLines.length > 0 ? (
              <address className="flex flex-col gap-0.5 not-italic">
                {addressLines.map((line, index) => (
                  <span key={index}>{line}</span>
                ))}
              </address>
            ) : (
              <p className="text-muted-foreground">Endereço não informado.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Taxa média de condomínio</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatCurrency(avgCondoFee)}
              {avgCondoFee != null ? (
                <span className="text-sm font-normal text-muted-foreground">/mês</span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Imóveis vinculados</dt>
                <dd className="tabular-nums">{formatNumber(linked.total)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Cadastrado em</dt>
                <dd>
                  <time dateTime={condominium.created_at}>
                    {formatDate(condominium.created_at)}
                  </time>
                </dd>
              </div>
              <div className="col-span-2 flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Última atualização</dt>
                <dd>
                  <time dateTime={condominium.updated_at}>
                    {formatDateTime(condominium.updated_at)}
                  </time>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Infraestrutura</CardTitle>
          <CardDescription>
            {condominium.amenities.length > 0
              ? formatAmenitiesCount(condominium.amenities.length)
              : "Nenhum item de infraestrutura informado."}
          </CardDescription>
        </CardHeader>
        {condominium.amenities.length > 0 ? (
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {condominium.amenities.map((amenity) => (
                <li key={amenity}>
                  <Badge variant="secondary">{getAmenityLabel(amenity)}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Observações</CardTitle>
          {condominium.notes ? null : <CardDescription>Sem observações.</CardDescription>}
        </CardHeader>
        {condominium.notes ? (
          <CardContent>
            <p className="wrap-break-word whitespace-pre-line">{condominium.notes}</p>
          </CardContent>
        ) : null}
      </Card>

      <LinkedProperties
        properties={linked.rows}
        total={linked.total}
        canCreateProperty={canCreateProperty(role)}
      />
    </div>
  )
}
