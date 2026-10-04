import { ChevronDownIcon, CircleAlertIcon } from "lucide-react"

import type { HealthItem, HealthSection } from "@workspace/core/platform/health"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"

import { HealthStatusBadge } from "@/components/plataforma/health-status-badge"

/** Seção toda ok e curta aparece aberta; senão os itens ok ficam recolhidos. */
const MAX_OPEN_OK_ITEMS = 8

function HealthItemRow({ item }: { item: HealthItem }) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <HealthStatusBadge status={item.status} />
        <span className="text-sm font-medium">{item.label}</span>
      </div>
      {item.reference ? (
        <code className="font-mono text-xs break-all text-muted-foreground">{item.reference}</code>
      ) : null}
      <p className="text-sm break-words text-muted-foreground">{item.detail}</p>
      {item.action ? (
        <p className="text-sm break-words">
          <span className="font-medium">O que fazer: </span>
          {item.action}
        </p>
      ) : null}
    </li>
  )
}

function HealthItemList({ items }: { items: readonly HealthItem[] }) {
  return (
    <ul className="flex flex-col divide-y">
      {items.map((item) => (
        <HealthItemRow key={item.key} item={item} />
      ))}
    </ul>
  )
}

export function HealthSectionCard({ section }: { section: HealthSection }) {
  const pending = section.items.filter((item) => item.status !== "ok")
  const ok = section.items.filter((item) => item.status === "ok")
  const showOkOpen = pending.length === 0 && ok.length <= MAX_OPEN_OK_ITEMS

  return (
    <Card id={section.key} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{section.title}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
        <CardAction>
          <HealthStatusBadge status={section.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {section.unavailable ? (
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>Não foi possível verificar esta parte</AlertTitle>
            <AlertDescription>{section.unavailable}</AlertDescription>
          </Alert>
        ) : null}
        {pending.length > 0 ? <HealthItemList items={pending} /> : null}
        {ok.length > 0 && showOkOpen ? <HealthItemList items={ok} /> : null}
        {ok.length > 0 && !showOkOpen ? (
          <Collapsible className="flex flex-col gap-3">
            <CollapsibleTrigger
              render={<Button variant="ghost" size="sm" className="group/trigger self-start" />}
            >
              <ChevronDownIcon
                data-icon="inline-start"
                className="transition-transform group-data-[panel-open]/trigger:rotate-180"
              />
              {pending.length === 0
                ? `Todos os ${ok.length} itens estão ok: mostrar`
                : `Mostrar os ${ok.length} itens ok`}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <HealthItemList items={ok} />
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        {section.items.length === 0 && !section.unavailable ? (
          <p className="text-sm text-muted-foreground">Nada a verificar.</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
