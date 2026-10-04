import Link from "next/link"
import { UserSearchIcon } from "lucide-react"

import { LISTING_PURPOSE_LABELS } from "@workspace/core/properties/enums"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
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

import type { MatchItem } from "@/components/imoveis/detail/types"

function scoreVariant(score: number): "default" | "secondary" | "outline" {
  if (score >= 80) return "default"
  if (score >= 50) return "secondary"
  return "outline"
}

/** A primeira razão (finalidade) vale para todos; mostramos as seguintes. */
function mainReasons(reasons: string[]) {
  return reasons.length > 1 ? reasons.slice(1, 4) : reasons
}

function ClientName({ match }: { match: MatchItem }) {
  if (!match.clientName) {
    return <span className="text-muted-foreground">Cliente sem acesso</span>
  }
  return (
    <Link href={`/clientes/${match.clientId}`} className="font-medium hover:underline">
      {match.clientName}
    </Link>
  )
}

export function MatchesTab({ isActive, matches }: { isActive: boolean; matches: MatchItem[] }) {
  if (!isActive) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserSearchIcon />
          </EmptyMedia>
          <EmptyTitle>Compatíveis só para imóveis ativos</EmptyTitle>
          <EmptyDescription>
            Os clientes compatíveis são calculados apenas para imóveis com status Ativo. Ative o
            imóvel para ver quem procura algo parecido.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (matches.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserSearchIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhum cliente compatível</EmptyTitle>
          <EmptyDescription>
            Nenhum interesse ativo de cliente combina com este imóvel (finalidade, tipo, faixa de
            preço, quartos, vagas e localização). Você vê apenas os clientes aos quais tem acesso.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clientes compatíveis</CardTitle>
        <CardDescription>
          {matches.length === 1 ? "1 cliente" : `${matches.length} clientes`} com interesse ativo
          compatível, do mais aderente ao menos. Você vê apenas os clientes aos quais tem acesso.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Interesse</TableHead>
                <TableHead className="text-end">Pontuação</TableHead>
                <TableHead>Principais razões</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((match) => (
                <TableRow key={match.clientId}>
                  <TableCell>
                    <ClientName match={match} />
                  </TableCell>
                  <TableCell>{LISTING_PURPOSE_LABELS[match.interestPurpose]}</TableCell>
                  <TableCell className="text-end">
                    <Badge variant={scoreVariant(match.score)} className="tabular-nums">
                      {match.score}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {mainReasons(match.reasons).join(" ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ItemGroup className="gap-2 md:hidden">
          {matches.map((match) => (
            <Item key={match.clientId} variant="outline" size="sm">
              <ItemContent className="min-w-0">
                <ItemTitle>
                  <ClientName match={match} />
                </ItemTitle>
                <ItemDescription>
                  Interesse: {LISTING_PURPOSE_LABELS[match.interestPurpose]}
                </ItemDescription>
                <ItemDescription className="line-clamp-3">
                  {mainReasons(match.reasons).join(" ")}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={scoreVariant(match.score)} className="tabular-nums">
                  {match.score}
                </Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
