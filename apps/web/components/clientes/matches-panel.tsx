import Link from "next/link"
import { CalendarPlusIcon, HouseIcon } from "lucide-react"

import { LISTING_PURPOSE_LABELS, PROPERTY_TYPE_LABELS } from "@workspace/core/properties/enums"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
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

import { AppointmentFormDialog } from "@/components/agenda/appointment-form-dialog"
import { formatCurrency } from "@/lib/format"
import type { Role } from "@/lib/auth/roles"
import { canScheduleAppointments } from "@/lib/agenda/permissions"
import type { ClientMatchItem } from "@/lib/clientes/detail-queries"
import type { ClientOption, MemberOption } from "@/lib/clientes/options"

type MatchesPanelProps = {
  matches: ClientMatchItem[]
  hasActiveInterests: boolean
  client: ClientOption
  members: MemberOption[]
  currentUserId: string
  role: Role
}

function describePrice(match: ClientMatchItem) {
  const prices: string[] = []

  if (match.interestPurpose !== "rent" && match.salePrice !== null) {
    prices.push(`Venda ${formatCurrency(match.salePrice)}`)
  }

  if (match.interestPurpose !== "sale" && match.rentPrice !== null) {
    prices.push(`Locação ${formatCurrency(match.rentPrice)}`)
  }

  return prices.join(" · ") || "Preço não informado"
}

function describeRooms(match: ClientMatchItem) {
  const parts: string[] = []

  if (match.bedrooms !== null)
    parts.push(`${match.bedrooms} ${match.bedrooms === 1 ? "quarto" : "quartos"}`)
  if (match.parkingSpaces !== null) {
    parts.push(`${match.parkingSpaces} ${match.parkingSpaces === 1 ? "vaga" : "vagas"}`)
  }

  return parts
}

export function MatchesPanel({
  matches,
  hasActiveInterests,
  client,
  members,
  currentUserId,
  role,
}: MatchesPanelProps) {
  if (matches.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HouseIcon />
          </EmptyMedia>
          <EmptyTitle>
            {hasActiveInterests
              ? "Nenhum imóvel compatível no momento"
              : "Sem perfil de busca ativo"}
          </EmptyTitle>
          <EmptyDescription>
            {hasActiveInterests
              ? "Nenhum imóvel ativo atende aos perfis de busca deste cliente. Ajuste o perfil ou volte quando novos imóveis forem cadastrados."
              : "Cadastre ou ative um perfil de busca para ver os imóveis ativos que combinam com o cliente."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const canSchedule = canScheduleAppointments(role)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Imóveis ativos que atendem aos perfis de busca ativos, do mais ao menos compatível.
      </p>
      <ItemGroup className="gap-2">
        {matches.map((match) => {
          const location = [match.neighborhood, match.city].filter(Boolean).join(", ")
          const details = [
            PROPERTY_TYPE_LABELS[match.type],
            LISTING_PURPOSE_LABELS[match.purpose],
            location,
            ...describeRooms(match),
          ]
            .filter(Boolean)
            .join(" · ")

          return (
            <Item key={match.propertyId} variant="outline" role="listitem">
              <ItemContent className="min-w-0">
                <ItemTitle>
                  <Link
                    href={`/imoveis/${match.propertyId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {match.code} · {match.title}
                  </Link>
                </ItemTitle>
                <ItemDescription>{details}</ItemDescription>
                <p className="text-sm font-medium tabular-nums">{describePrice(match)}</p>
              </ItemContent>
              <ItemActions className="flex-wrap">
                <Badge
                  variant={
                    match.score >= 75 ? "default" : match.score >= 50 ? "secondary" : "outline"
                  }
                  title={match.reasons.join("\n")}
                >
                  {match.score}% compatível
                </Badge>
                {canSchedule ? (
                  <AppointmentFormDialog
                    members={members}
                    currentUserId={currentUserId}
                    role={role}
                    defaults={{
                      client,
                      property: {
                        id: match.propertyId,
                        label: `${match.code} · ${match.title}`,
                        description: location || null,
                      },
                    }}
                    trigger={<Button variant="outline" size="sm" />}
                  >
                    <CalendarPlusIcon data-icon="inline-start" />
                    Agendar visita
                  </AppointmentFormDialog>
                ) : null}
              </ItemActions>
            </Item>
          )
        })}
      </ItemGroup>
    </div>
  )
}
