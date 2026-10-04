import type { Metadata } from "next"
import Link from "next/link"
import { HousePlusIcon, SearchXIcon } from "lucide-react"

import { CAPTURE_STATUS_LABELS, CAPTURE_STATUS_VALUES } from "@workspace/core/properties/enums"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { CaptureInbox } from "@/components/captacao/capture-inbox"
import { PublicLinkCard } from "@/components/captacao/public-link-card"
import { PageHeading } from "@/components/crm/page-placeholder"
import { StatusTabs } from "@/components/propostas/status-tabs"
import { PageShell } from "@/components/shared/page-shell"
import { requireRole } from "@/lib/auth/session"
import { listCaptureRequests } from "@/lib/captacao/queries"
import { CAPTURE_INBOX_ROLES } from "@/lib/propostas/permissions"
import { createClient } from "@/lib/supabase/server"
import { buildCaptureUrl } from "@/lib/tenant/urls"

export const metadata: Metadata = {
  title: "Captações",
}

type SearchParams = Record<string, string | string[] | undefined>

export default async function CaptacaoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const [{ membership }, params] = await Promise.all([
    requireRole(CAPTURE_INBOX_ROLES),
    searchParams,
  ])

  const statusParam = Array.isArray(params.status) ? params.status[0] : params.status
  const status = CAPTURE_STATUS_VALUES.find((value) => value === statusParam) ?? null

  const supabase = await createClient()
  const { rows, counts } = await listCaptureRequests(supabase, membership.organizationId, status)

  // Formulário público no subdomínio da imobiliária ({slug}.raiz/captar).
  const publicUrl = buildCaptureUrl(membership.organization.slug)

  const statusItems = CAPTURE_STATUS_VALUES.map((value) => ({
    value,
    label: CAPTURE_STATUS_LABELS[value],
    count: counts[value],
  }))

  return (
    <PageShell>
      <PageHeading
        title="Captações"
        description="Imóveis oferecidos por proprietários no formulário público de captação."
      />

      <PublicLinkCard url={publicUrl} />

      <StatusTabs items={statusItems} allLabel="Todas" allCount={counts.all} />

      {rows.length > 0 ? (
        <CaptureInbox rows={rows} />
      ) : status ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma captação com este status</EmptyTitle>
            <EmptyDescription>Escolha outro status para ver as demais captações.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link href="/captacao" />} nativeButton={false}>
              Ver todas
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HousePlusIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma captação recebida</EmptyTitle>
            <EmptyDescription>
              Compartilhe o link público acima. Cada proprietário que enviar o formulário aparece
              aqui para a equipe entrar em contato.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </PageShell>
  )
}
