import Link from "next/link"
import { ChevronDownIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"

import { formatDateTime } from "@/lib/format"
import type { PlatformAuditEvent } from "@/lib/plataforma/audit"
import {
  auditActionLabel,
  auditTargetLabel,
  buildAuditLogHref,
  diffAuditData,
  type AuditLogFilters,
} from "@/lib/plataforma/registro"

function EmptyValue() {
  return <span className="text-muted-foreground">—</span>
}

function AuditChanges({ event }: { event: PlatformAuditEvent }) {
  const changes = diffAuditData(event.before, event.after)

  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem antes/depois registrado.</p>
  }

  return (
    <div className="flex flex-col rounded-lg border text-sm">
      <div
        aria-hidden="true"
        className="hidden border-b p-2 text-xs text-muted-foreground sm:grid sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-3"
      >
        <span>Campo</span>
        <span>Antes</span>
        <span>Depois</span>
      </div>
      <dl className="flex flex-col divide-y">
        {changes.map((change) => (
          <div
            key={change.field}
            className="grid min-w-0 gap-1 p-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-3"
          >
            <dt className="flex flex-wrap items-center gap-1.5">
              <code className="font-mono text-xs break-all">{change.field}</code>
              {change.changed ? <Badge variant="secondary">mudou</Badge> : null}
            </dt>
            <dd className="min-w-0 break-words">
              <span className="text-xs text-muted-foreground sm:sr-only">Antes: </span>
              {change.before === null ? <EmptyValue /> : change.before}
            </dd>
            <dd className="min-w-0 break-words">
              <span className="text-xs text-muted-foreground sm:sr-only">Depois: </span>
              {change.after === null ? <EmptyValue /> : change.after}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Uma linha do registro do console, com o antes/depois recolhido. */
export function AuditEventItem({
  event,
  organizationName,
  filters,
}: {
  event: PlatformAuditEvent
  /** Nome atual da imobiliária; null se foi apagada ou não há imobiliária. */
  organizationName: string | null
  filters: AuditLogFilters
}) {
  const hasData = event.before !== null || event.after !== null

  return (
    <li className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{auditActionLabel(event.action)}</Badge>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatDateTime(event.occurredAt)}
        </span>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Quem</dt>
        <dd className="min-w-0 break-all">{event.actorEmail}</dd>
        {event.targetType ? (
          <>
            <dt className="text-muted-foreground">Alvo</dt>
            <dd className="min-w-0 break-all">
              {auditTargetLabel(event.targetType)}
              {event.targetId ? (
                <code className="ms-1 font-mono text-xs text-muted-foreground">
                  {event.targetId}
                </code>
              ) : null}
            </dd>
          </>
        ) : null}
        {event.organizationId ? (
          <>
            <dt className="text-muted-foreground">Imobiliária</dt>
            <dd className="min-w-0 break-words">
              {filters.imobiliaria === event.organizationId ? (
                (organizationName ?? "Imobiliária apagada")
              ) : (
                <Link
                  href={buildAuditLogHref({
                    acao: filters.acao,
                    imobiliaria: event.organizationId,
                  })}
                  className="underline underline-offset-3"
                >
                  {organizationName ?? "Imobiliária apagada"}
                </Link>
              )}
            </dd>
          </>
        ) : null}
        {event.reason ? (
          <>
            <dt className="text-muted-foreground">Motivo</dt>
            <dd className="min-w-0 break-words">{event.reason}</dd>
          </>
        ) : null}
      </dl>
      {hasData ? (
        <Collapsible className="flex flex-col gap-2">
          <CollapsibleTrigger
            render={<Button variant="ghost" size="sm" className="group/trigger self-start" />}
          >
            <ChevronDownIcon
              data-icon="inline-start"
              className="transition-transform group-data-[panel-open]/trigger:rotate-180"
            />
            Ver antes e depois
          </CollapsibleTrigger>
          <CollapsibleContent>
            <AuditChanges event={event} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </li>
  )
}
