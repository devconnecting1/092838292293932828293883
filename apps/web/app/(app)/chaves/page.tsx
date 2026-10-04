import type { Metadata } from "next"
import Link from "next/link"
import { HousePlusIcon, KeyRoundIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react"
import { z } from "zod"

import { KEY_STATUS_VALUES, type KeyStatus } from "@workspace/core/properties/enums"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { KeysFilters } from "@/components/chaves/keys-filters"
import { KeysTable, type KeyTableRow } from "@/components/chaves/keys-table"
import { NewKeyButton } from "@/components/chaves/new-key-button"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { requireMembership } from "@/lib/auth/session"
import { listKeys } from "@/lib/chaves/queries"
import { getClientOptions, getPropertyOptions, getTeamMembers } from "@/lib/propostas/options"
import { canEditProperty, canReturnKey, COMMERCIAL_ROLES } from "@/lib/propostas/permissions"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Chaves",
}

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function ChavesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const [{ user, membership }, params] = await Promise.all([requireMembership(), searchParams])

  const statusParam = firstValue(params.status)
  const status = KEY_STATUS_VALUES.find((value) => value === statusParam) ?? null
  const propertyParam = firstValue(params.imovel)
  const propertyId = z.guid().safeParse(propertyParam).success ? (propertyParam ?? null) : null
  const overdue = firstValue(params.vencidas) === "1"
  const hasFilters = Boolean(status || propertyId || overdue)

  const organizationId = membership.organizationId
  const role = membership.role
  const isCommercial = COMMERCIAL_ROLES.includes(role)
  const supabase = await createClient()

  const [keys, properties, members, clients] = await Promise.all([
    listKeys(supabase, organizationId, {
      status: status as KeyStatus | null,
      propertyId,
      overdue,
    }),
    getPropertyOptions(supabase, organizationId),
    isCommercial ? getTeamMembers(supabase, organizationId) : Promise.resolve([]),
    isCommercial ? getClientOptions(supabase, organizationId) : Promise.resolve([]),
  ])

  const propertyOptions = properties.map(({ value, label }) => ({
    value,
    label,
  }))
  const editableProperties = properties
    .filter((property) => canEditProperty(role, user.id, property))
    .map(({ value, label }) => ({ value, label }))
  const selectedProperty = properties.find((property) => property.value === propertyId)

  const rows: KeyTableRow[] = keys.map((key) => {
    const ownership = key.property ?? { capturedBy: null, brokerId: null }

    return {
      ...key,
      canEdit: key.property ? canEditProperty(role, user.id, key.property) : false,
      canCheckout: isCommercial && key.status === "available",
      canReturn: key.openMovement
        ? canReturnKey(role, user.id, key.openMovement, ownership)
        : false,
    }
  })

  const overdueCount = rows.filter((row) => row.openMovement?.isOverdue).length
  const defaultPropertyId =
    propertyId && editableProperties.some((property) => property.value === propertyId)
      ? propertyId
      : undefined

  return (
    <PageShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          title="Chaves"
          description={
            selectedProperty
              ? `Chaves do imóvel ${selectedProperty.label}.`
              : "Onde está cada chave, quem retirou e o prazo de devolução."
          }
        />
        {editableProperties.length > 0 ? (
          <NewKeyButton properties={editableProperties} defaultPropertyId={defaultPropertyId} />
        ) : null}
      </div>

      <KeysFilters properties={propertyOptions} />

      {overdueCount > 0 && !overdue ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            {overdueCount === 1
              ? "1 chave com devolução vencida"
              : `${overdueCount} chaves com devolução vencida`}
          </AlertTitle>
          <AlertDescription>
            Fale com quem está com a chave e registre a devolução assim que ela voltar.
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/chaves?vencidas=1" />}
              nativeButton={false}
            >
              Ver vencidas
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {rows.length > 0 ? (
        <KeysTable
          rows={rows}
          members={members.map(({ value, label }) => ({ value, label }))}
          clients={clients}
          editableProperties={editableProperties}
          currentUserId={user.id}
        />
      ) : hasFilters ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma chave encontrada</EmptyTitle>
            <EmptyDescription>Nenhuma chave corresponde aos filtros escolhidos.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link href="/chaves" />} nativeButton={false}>
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : properties.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HousePlusIcon />
            </EmptyMedia>
            <EmptyTitle>Cadastre um imóvel primeiro</EmptyTitle>
            <EmptyDescription>
              As chaves ficam vinculadas a um imóvel. Cadastre o primeiro imóvel para controlar as
              chaves dele.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href="/imoveis" />} nativeButton={false}>
              Ir para imóveis
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma chave cadastrada</EmptyTitle>
            <EmptyDescription>
              Cadastre as chaves dos imóveis para saber onde cada uma está e quem retirou.
            </EmptyDescription>
          </EmptyHeader>
          {editableProperties.length > 0 ? (
            <EmptyContent>
              <NewKeyButton properties={editableProperties} />
            </EmptyContent>
          ) : null}
        </Empty>
      )}
    </PageShell>
  )
}
