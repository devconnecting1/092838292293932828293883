import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, ShieldAlertIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { PageHeading } from "@/components/crm/page-placeholder"
import { PropertyStatusBadge } from "@/components/imoveis/property-status-badge"
import { PropertyForm } from "@/components/imoveis/property-form/property-form"
import { toMemberOptions } from "@/components/imoveis/property-form/types"
import { requireMembership } from "@/lib/auth/session"
import { getBillingOverview } from "@/lib/billing/queries"
import { isPropertyFormStepKey } from "@/lib/imoveis/form-steps"
import { propertyRowToFormValues } from "@/lib/imoveis/form-values"
import { summarizeMedia } from "@/lib/imoveis/mappers"
import { canDeletePropertyRecords, canEditProperty } from "@/lib/imoveis/permissions"
import {
  getAuthorizationPeriods,
  getCondominiumOptions,
  getOrganizationMembers,
  getPropertyMediaRows,
  getPropertyRow,
} from "@/lib/imoveis/queries"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Editar imóvel",
}

type EditarImovelPageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ etapa?: string | string[] }>
}

export default async function EditarImovelPage({ params, searchParams }: EditarImovelPageProps) {
  const [{ user, membership }, { id }, query] = await Promise.all([
    requireMembership(),
    params,
    searchParams,
  ])
  const organizationId = membership.organizationId
  const supabase = await createClient()

  const property = await getPropertyRow(supabase, organizationId, id)
  if (!property) {
    notFound()
  }

  if (!canEditProperty(membership.role, user.id, property)) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        <PageHeading title={`Editar ${property.code}`} description={property.title} />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldAlertIcon />
            </EmptyMedia>
            <EmptyTitle>Você não pode editar este imóvel</EmptyTitle>
            <EmptyDescription>
              Corretores e captadores editam só os imóveis em que são o captador ou o corretor
              responsável. Peça para a gestão ajustar, se necessário.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              render={<Link href={`/imoveis/${property.id}`} />}
              nativeButton={false}
            >
              Ver ficha do imóvel
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const [media, authorizations, members, condominiums, billing] = await Promise.all([
    getPropertyMediaRows(supabase, organizationId, property.id),
    getAuthorizationPeriods(supabase, organizationId, property.id),
    getOrganizationMembers(supabase, organizationId),
    getCondominiumOptions(supabase, organizationId),
    getBillingOverview(organizationId),
  ])

  const rawStep = Array.isArray(query.etapa) ? query.etapa[0] : query.etapa
  const initialStep = isPropertyFormStepKey(rawStep) ? rawStep : "dados"

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{property.code}</span>
            <PropertyStatusBadge status={property.status} />
          </div>
          <PageHeading title="Editar imóvel" description={property.title} />
        </div>
        <Button
          variant="ghost"
          render={<Link href={`/imoveis/${property.id}`} />}
          nativeButton={false}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Voltar para a ficha
        </Button>
      </div>

      <PropertyForm
        organizationId={organizationId}
        userId={user.id}
        role={membership.role}
        property={{
          id: property.id,
          code: property.code,
          status: property.status,
        }}
        initialValues={propertyRowToFormValues(property, summarizeMedia(media))}
        initialStep={initialStep}
        media={media}
        authorizations={authorizations}
        members={toMemberOptions(members, [property.captured_by, property.broker_id])}
        condominiums={condominiums}
        capture={null}
        canDeleteMedia={canDeletePropertyRecords(membership.role)}
        uploadsBlocked={billing?.state === "read_only"}
      />
    </div>
  )
}
