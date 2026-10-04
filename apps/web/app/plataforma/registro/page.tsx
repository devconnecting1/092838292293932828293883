import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRightIcon, HistoryIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { PageHeading } from "@/components/crm/page-placeholder"
import { PlatformRpcFailureAlert } from "@/components/plataforma/platform-rpc-failure-alert"
import { RefreshButton } from "@/components/plataforma/refresh-button"
import { AuditEventItem } from "@/components/plataforma/registro/audit-event-item"
import { AuditLogFilters } from "@/components/plataforma/registro/audit-log-filters"
import { requirePlatformAdmin } from "@/lib/plataforma/admin"
import { listPlatformAuditEvents } from "@/lib/plataforma/audit"
import {
  auditActionLabel,
  buildAuditLogHref,
  getAuditFilterOptions,
  parseAuditLogFilters,
  PLATFORM_AUDIT_PAGE_SIZE,
} from "@/lib/plataforma/registro"

export const metadata: Metadata = {
  title: "Registro do console",
}

type PlatformAuditLogPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Registro do console: quem fez o quê, quando e por quê, com o antes/depois.
 * Somente leitura (a tabela é só de acréscimo). Guardado por 2 anos (LGPD);
 * a rotina semanal retencao-registro-console apaga o que passou disso.
 */
export default async function PlatformAuditLogPage({ searchParams }: PlatformAuditLogPageProps) {
  await requirePlatformAdmin()

  const filters = parseAuditLogFilters(await searchParams)
  const [events, options] = await Promise.all([
    listPlatformAuditEvents({
      limit: PLATFORM_AUDIT_PAGE_SIZE + 1,
      beforeId: filters.antes ?? undefined,
      organizationId: filters.imobiliaria || undefined,
      action: filters.acao || undefined,
    }),
    getAuditFilterOptions(),
  ])

  const names = new Map(
    (options.ok ? options.data.organizations : []).map((organization) => [
      organization.organizationId,
      organization.name,
    ])
  )
  const actionOptions = (options.ok ? options.data.actions : []).map((item) => ({
    value: item.action,
    label: `${auditActionLabel(item.action)} (${item.total})`,
  }))
  const organizationOptions = (options.ok ? options.data.organizations : []).map((item) => ({
    value: item.organizationId,
    label: `${item.name ?? "Imobiliária apagada"} (${item.total})`,
  }))

  // Filtro vindo de link, sem evento nas opções: continua selecionável.
  if (filters.acao && !actionOptions.some((item) => item.value === filters.acao)) {
    actionOptions.unshift({ value: filters.acao, label: auditActionLabel(filters.acao) })
  }

  if (
    filters.imobiliaria &&
    !organizationOptions.some((item) => item.value === filters.imobiliaria)
  ) {
    organizationOptions.unshift({ value: filters.imobiliaria, label: "Imobiliária sem eventos" })
  }

  const rows = events.ok ? events.data.slice(0, PLATFORM_AUDIT_PAGE_SIZE) : []
  const hasOlder = events.ok && events.data.length > PLATFORM_AUDIT_PAGE_SIZE
  const oldestShown = rows.at(-1)?.id ?? null
  const hasFilters = Boolean(filters.acao || filters.imobiliaria)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          title="Registro do console"
          description="Quem fez o quê no console, quando, em quem e por quê. Somente leitura, guardado por 2 anos."
        />
        <RefreshButton />
      </div>

      {!events.ok ? <PlatformRpcFailureAlert failure={events} /> : null}

      {events.ok ? (
        <AuditLogFilters
          action={filters.acao}
          organization={filters.imobiliaria}
          actions={actionOptions}
          organizations={organizationOptions}
        />
      ) : null}

      {events.ok && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>
              {hasFilters || filters.antes ? "Nada encontrado" : "Nenhuma ação registrada"}
            </EmptyTitle>
            <EmptyDescription>
              {hasFilters || filters.antes
                ? "Nenhum evento com esses filtros. Limpe os filtros ou volte aos mais recentes."
                : "Toda ação do console que altera algo aparece aqui: comunicados, bloqueios, prorrogações de teste."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {rows.length > 0 ? (
        <Card>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {rows.map((event) => (
                <AuditEventItem
                  key={event.id}
                  event={event}
                  organizationName={
                    event.organizationId ? (names.get(event.organizationId) ?? null) : null
                  }
                  filters={filters}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {events.ok && (filters.antes || hasOlder) ? (
        <nav
          aria-label="Páginas do registro"
          className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-between"
        >
          {filters.antes ? (
            <Button
              variant="outline"
              render={<Link href={buildAuditLogHref({ ...filters, antes: null })} />}
              nativeButton={false}
            >
              Voltar aos mais recentes
            </Button>
          ) : (
            <span />
          )}
          {hasOlder && oldestShown ? (
            <Button
              variant="outline"
              render={<Link href={buildAuditLogHref({ ...filters, antes: oldestShown })} />}
              nativeButton={false}
            >
              Mais antigos
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
