import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { formatCondominiumLocation } from "@/lib/condominios/format"
import type { CondominiumListItem } from "@/lib/condominios/queries"
import { formatCurrency, formatNumber } from "@/lib/format"
import { getAmenityLabel } from "@/lib/imoveis/amenities"

const VISIBLE_AMENITIES = 3

function AmenityBadges({ amenities }: { amenities: readonly string[] }) {
  if (amenities.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }

  const visible = amenities.slice(0, VISIBLE_AMENITIES)
  const hidden = amenities.slice(VISIBLE_AMENITIES)

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((amenity) => (
        <Badge key={amenity} variant="secondary">
          {getAmenityLabel(amenity)}
        </Badge>
      ))}
      {hidden.length > 0 ? (
        <Badge variant="outline" title={hidden.map(getAmenityLabel).join(", ")}>
          +{hidden.length}
          <span className="sr-only">: {hidden.map(getAmenityLabel).join(", ")}</span>
        </Badge>
      ) : null}
    </div>
  )
}

function condominiumHref(id: string) {
  return `/condominios/${id}`
}

/** Tabela da lista (telas médias ou maiores). */
export function CondominiumsTable({ rows }: { rows: CondominiumListItem[] }) {
  return (
    <div className="hidden overflow-hidden rounded-xl border md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-4">Condomínio</TableHead>
            <TableHead>Localização</TableHead>
            <TableHead className="text-end">Taxa média</TableHead>
            <TableHead>Infraestrutura</TableHead>
            <TableHead className="text-end">Imóveis</TableHead>
            <TableHead className="pe-4">
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-72 ps-4">
                <Link
                  href={condominiumHref(row.id)}
                  className="block truncate font-medium hover:underline"
                >
                  {row.name}
                </Link>
              </TableCell>
              <TableCell className="max-w-64 truncate text-muted-foreground">
                {formatCondominiumLocation(row) ?? "—"}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatCurrency(row.avg_condo_fee)}
              </TableCell>
              <TableCell className="min-w-48 whitespace-normal">
                <AmenityBadges amenities={row.amenities} />
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatNumber(row.propertiesCount)}
              </TableCell>
              <TableCell className="w-0 pe-4 text-end">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  render={<Link href={condominiumHref(row.id)} />}
                  nativeButton={false}
                >
                  <ChevronRightIcon />
                  <span className="sr-only">Abrir a ficha de {row.name}</span>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Cards da lista (celular). */
export function CondominiumsCards({ rows }: { rows: CondominiumListItem[] }) {
  return (
    <ul className="flex flex-col gap-3 md:hidden">
      {rows.map((row) => (
        <li key={row.id}>
          <Card size="sm">
            <CardHeader>
              <CardTitle>
                <Link href={condominiumHref(row.id)} className="hover:underline">
                  {row.name}
                </Link>
              </CardTitle>
              <CardDescription>
                {formatCondominiumLocation(row) ?? "Endereço não informado"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">Taxa média</dt>
                  <dd className="tabular-nums">{formatCurrency(row.avg_condo_fee)}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">Imóveis vinculados</dt>
                  <dd className="tabular-nums">{formatNumber(row.propertiesCount)}</dd>
                </div>
              </dl>
              <AmenityBadges amenities={row.amenities} />
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                render={<Link href={condominiumHref(row.id)} />}
                nativeButton={false}
              >
                Ver ficha
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </CardFooter>
          </Card>
        </li>
      ))}
    </ul>
  )
}
