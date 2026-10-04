import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon, CircleAlertIcon, ShieldAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
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
import { PropertyForm } from "@/components/imoveis/property-form/property-form"
import { toMemberOptions, type CaptureSummary } from "@/components/imoveis/property-form/types"
import { requireMembership } from "@/lib/auth/session"
import { captureToFormValues, emptyPropertyFormValues } from "@/lib/imoveis/form-values"
import { isUuid } from "@/lib/imoveis/ids"
import { canCreateProperty, canReadCaptureRequests } from "@/lib/imoveis/permissions"
import { getCondominiumOptions, getOrganizationMembers } from "@/lib/imoveis/queries"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Novo imóvel",
}

type NovoImovelPageProps = {
  searchParams: Promise<{ captacao?: string | string[] }>
}

type CaptureNotice = {
  title: string
  message: string
  href?: string
  hrefLabel?: string
}

export default async function NovoImovelPage({ searchParams }: NovoImovelPageProps) {
  const [{ user, membership }, params] = await Promise.all([requireMembership(), searchParams])
  const organizationId = membership.organizationId

  if (!canCreateProperty(membership.role)) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        <PageHeading title="Novo imóvel" />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldAlertIcon />
            </EmptyMedia>
            <EmptyTitle>Acesso restrito</EmptyTitle>
            <EmptyDescription>
              Seu papel nesta imobiliária não permite cadastrar imóveis.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link href="/imoveis" />} nativeButton={false}>
              Voltar para imóveis
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const supabase = await createClient()
  const [members, condominiums] = await Promise.all([
    getOrganizationMembers(supabase, organizationId),
    getCondominiumOptions(supabase, organizationId),
  ])

  let initialValues = emptyPropertyFormValues(membership.role, user.id)
  let capture: CaptureSummary | null = null
  let captureNotice: CaptureNotice | null = null

  const rawCaptureId = Array.isArray(params.captacao) ? params.captacao[0] : params.captacao

  if (rawCaptureId) {
    if (!isUuid(rawCaptureId)) {
      captureNotice = {
        title: "Captação inválida",
        message: "O link da captação está incompleto.",
      }
    } else if (!canReadCaptureRequests(membership.role)) {
      captureNotice = {
        title: "Sem acesso à captação",
        message: "Seu papel não permite abrir captações. O imóvel pode ser cadastrado normalmente.",
      }
    } else {
      const { data, error } = await supabase
        .from("capture_requests")
        .select(
          "id, owner_name, owner_email, owner_phone, purpose, type, postal_code, neighborhood, city, state, expected_price, message, status, converted_property_id"
        )
        .eq("organization_id", organizationId)
        .eq("id", rawCaptureId)
        .maybeSingle()

      if (error) {
        throw new Error(`Não foi possível carregar a captação (${error.code ?? "erro"}).`)
      }

      if (!data) {
        captureNotice = {
          title: "Captação não encontrada",
          message: "Ela pode ter sido removida.",
        }
      } else if (data.status === "converted" && data.converted_property_id) {
        captureNotice = {
          title: "Captação já convertida",
          message:
            "Esta captação já virou um imóvel. Cadastrar de novo criaria um anúncio duplicado.",
          href: `/imoveis/${data.converted_property_id}`,
          hrefLabel: "Abrir o imóvel",
        }
      } else {
        initialValues = captureToFormValues(initialValues, data)
        capture = {
          id: data.id,
          ownerName: data.owner_name,
          ownerEmail: data.owner_email,
          ownerPhone: data.owner_phone,
        }
      }
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeading
          title="Novo imóvel"
          description="Preencha as etapas na ordem que preferir. Salve como rascunho a qualquer momento."
        />
        <Button variant="ghost" render={<Link href="/imoveis" />} nativeButton={false}>
          <ArrowLeftIcon data-icon="inline-start" />
          Imóveis
        </Button>
      </div>

      {captureNotice ? (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>{captureNotice.title}</AlertTitle>
          <AlertDescription>
            {captureNotice.message}{" "}
            {captureNotice.href ? (
              <Link href={captureNotice.href}>{captureNotice.hrefLabel}</Link>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <PropertyForm
        organizationId={organizationId}
        userId={user.id}
        role={membership.role}
        property={null}
        initialValues={initialValues}
        initialStep="dados"
        media={[]}
        authorizations={[]}
        members={toMemberOptions(members)}
        condominiums={condominiums}
        capture={capture}
        canDeleteMedia={false}
      />
    </div>
  )
}
