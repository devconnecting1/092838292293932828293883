import Link from "next/link"
import { CalendarClockIcon, LockIcon, UserIcon } from "lucide-react"

import {
  daysBetweenDates,
  describeAuthorizationDeadline,
  isAuthorizationTrackedStatus,
} from "@workspace/core/properties/authorization-alerts"
import { PROPERTY_TYPE_LABELS } from "@workspace/core/properties/enums"
import { Badge } from "@workspace/ui/components/badge"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { ImobScoreBadge } from "@/components/imoveis/imob-score-badge"
import { PropertyCover } from "@/components/imoveis/property-cover"
import { PropertyStatusBadge } from "@/components/imoveis/property-status-badge"
import { formatCurrency } from "@/lib/format"
import type { PropertyListItem } from "@/lib/imoveis/list-queries"
import { getDisplayPrices, todayInSaoPaulo } from "@/lib/imoveis/mappers"

function location(item: PropertyListItem) {
  const city = [item.city, item.state].filter(Boolean).join("/")
  return [item.neighborhood, city].filter(Boolean).join(" · ") || "Endereço não informado"
}

/** Explica um resultado que casou pelo proprietário, e não pelo texto do imóvel. */
function MatchedOwner({ item }: { item: PropertyListItem }) {
  if (!item.matchedOwner) return null

  return (
    <span className="truncate text-xs text-muted-foreground">
      <UserIcon className="inline size-3 align-text-bottom" aria-hidden="true" /> Proprietário:{" "}
      {item.matchedOwner}
    </span>
  )
}

/** Autorização vencendo (30 dias) ou vencida, só para imóvel em carteira. */
function AuthorizationBadge({ item, today }: { item: PropertyListItem; today: string }) {
  if (!isAuthorizationTrackedStatus(item.status)) return null

  if (item.authorizationState === "expired") {
    return (
      <Badge variant="destructive">
        <CalendarClockIcon data-icon="inline-start" />
        Autorização vencida
      </Badge>
    )
  }

  if (item.authorizationState !== "expiring" || !item.authorizationEndsOn) return null

  const daysLeft = daysBetweenDates(today, item.authorizationEndsOn)

  return (
    <Badge variant="outline">
      <CalendarClockIcon data-icon="inline-start" />
      {daysLeft == null
        ? "Autorização vencendo"
        : `Autorização ${describeAuthorizationDeadline(daysLeft)}`}
    </Badge>
  )
}

/** Imóvel em sigilo: só dono, gerente, captador, corretor responsável e quem recebeu acesso veem. */
function RestrictedBadge({ item }: { item: PropertyListItem }) {
  if (!item.is_restricted) return null

  return (
    <Badge variant="secondary">
      <LockIcon data-icon="inline-start" />
      Restrito
    </Badge>
  )
}

function Prices({ item }: { item: PropertyListItem }) {
  return (
    <div className="flex flex-col gap-0.5">
      {getDisplayPrices(item).map((price) => (
        <span key={price.label} className="tabular-nums">
          <span className="text-xs text-muted-foreground">{price.label} </span>
          {formatCurrency(price.value)}
          {price.suffix && price.value != null ? (
            <span className="text-xs text-muted-foreground">{price.suffix}</span>
          ) : null}
        </span>
      ))}
    </div>
  )
}

function People({
  item,
  memberNames,
}: {
  item: PropertyListItem
  memberNames: Record<string, string>
}) {
  const capturer = item.captured_by ? (memberNames[item.captured_by] ?? "Ex-membro") : "—"
  const broker = item.broker_id ? (memberNames[item.broker_id] ?? "Ex-membro") : "—"

  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className="truncate">
        <span className="text-muted-foreground">Captador: </span>
        {capturer}
      </span>
      <span className="truncate">
        <span className="text-muted-foreground">Corretor: </span>
        {broker}
      </span>
    </div>
  )
}

export function PropertiesList({
  items,
  memberNames,
}: {
  items: PropertyListItem[]
  memberNames: Record<string, string>
}) {
  const today = todayInSaoPaulo()

  return (
    <>
      <div className="hidden overflow-hidden rounded-xl ring-1 ring-foreground/10 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 ps-4">
                <span className="sr-only">Foto</span>
              </TableHead>
              <TableHead>Imóvel</TableHead>
              <TableHead>Preço</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Nota do Anúncio</TableHead>
              <TableHead className="pe-4">Responsáveis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="ps-4">
                  <PropertyCover
                    storagePath={item.coverPath}
                    alt={`Capa de ${item.title}`}
                    className="h-14 w-20"
                  />
                </TableCell>
                <TableCell className="max-w-80 whitespace-normal">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.code} · {PROPERTY_TYPE_LABELS[item.type]}
                    </span>
                    <Link
                      href={`/imoveis/${item.id}`}
                      className="line-clamp-2 font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    <span className="truncate text-xs text-muted-foreground">{location(item)}</span>
                    <MatchedOwner item={item} />
                  </div>
                </TableCell>
                <TableCell>
                  <Prices item={item} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <PropertyStatusBadge status={item.status} />
                    <RestrictedBadge item={item} />
                    {item.published_to_portals ? (
                      <Badge variant="outline">Nos portais</Badge>
                    ) : null}
                    <AuthorizationBadge item={item} today={today} />
                  </div>
                </TableCell>
                <TableCell>
                  <ImobScoreBadge score={item.imob_score} />
                </TableCell>
                <TableCell className="max-w-56 pe-4">
                  <People item={item} memberNames={memberNames} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ItemGroup className="gap-2 md:hidden">
        {items.map((item) => (
          <Item key={item.id} variant="outline" render={<Link href={`/imoveis/${item.id}`} />}>
            <ItemMedia variant="image" className="size-20">
              <PropertyCover
                storagePath={item.coverPath}
                alt={`Capa de ${item.title}`}
                className="size-20"
              />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <span className="font-mono text-xs text-muted-foreground">
                {item.code} · {PROPERTY_TYPE_LABELS[item.type]}
              </span>
              <ItemTitle className="line-clamp-2">{item.title}</ItemTitle>
              <ItemDescription className="truncate">{location(item)}</ItemDescription>
              <MatchedOwner item={item} />
              <Prices item={item} />
            </ItemContent>
            <ItemFooter className="flex-wrap justify-start">
              <PropertyStatusBadge status={item.status} />
              <ImobScoreBadge score={item.imob_score} />
              <RestrictedBadge item={item} />
              {item.published_to_portals ? <Badge variant="outline">Nos portais</Badge> : null}
              <AuthorizationBadge item={item} today={today} />
            </ItemFooter>
          </Item>
        ))}
      </ItemGroup>
    </>
  )
}
