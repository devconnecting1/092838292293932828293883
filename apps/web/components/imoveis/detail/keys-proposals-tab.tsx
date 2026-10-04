import Link from "next/link"
import { ArrowUpRightIcon, HandshakeIcon, KeyRoundIcon } from "lucide-react"

import {
  KEY_STATUS_LABELS,
  LISTING_PURPOSE_LABELS,
  PROPOSAL_STATUS_LABELS,
  type KeyStatus,
  type ProposalStatus,
} from "@workspace/core/properties/enums"
import { Badge } from "@workspace/ui/components/badge"
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

import { formatDateOnly } from "@/components/imoveis/detail/format"
import type { KeyItem, ProposalItem } from "@/components/imoveis/detail/types"
import { formatCurrency, formatDate } from "@/lib/format"

const KEY_STATUS_VARIANTS: Record<KeyStatus, "secondary" | "outline" | "destructive"> = {
  available: "secondary",
  checked_out: "outline",
  lost: "destructive",
}

const PROPOSAL_STATUS_VARIANTS: Record<
  ProposalStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  sent: "secondary",
  countered: "secondary",
  accepted: "default",
  rejected: "destructive",
  withdrawn: "outline",
}

export function KeysProposalsTab({
  propertyId,
  keys,
  proposals,
}: {
  propertyId: string
  keys: KeyItem[]
  proposals: ProposalItem[]
}) {
  const query = `imovel=${encodeURIComponent(propertyId)}`

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
      <Card>
        <CardHeader>
          <CardTitle>Chaves</CardTitle>
          <CardDescription>Onde estão as chaves deste imóvel.</CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/chaves?${query}`} />}
              nativeButton={false}
            >
              Ver chaves
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhuma chave cadastrada</EmptyTitle>
                <EmptyDescription>
                  Cadastre e controle as retiradas das chaves no módulo de chaves.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {keys.map((key) => (
                <Item key={key.id} variant="outline" size="sm">
                  <ItemContent className="min-w-0">
                    <ItemTitle>{key.label}</ItemTitle>
                    <ItemDescription>{key.location || "Local não informado"}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={KEY_STATUS_VARIANTS[key.status]}>
                      {KEY_STATUS_LABELS[key.status]}
                    </Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Propostas</CardTitle>
          <CardDescription>
            Propostas recebidas para este imóvel, das mais recentes às mais antigas.
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/propostas?${query}`} />}
              nativeButton={false}
            >
              Ver propostas
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {proposals.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HandshakeIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhuma proposta</EmptyTitle>
                <EmptyDescription>
                  As propostas registradas para este imóvel aparecem aqui.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {proposals.map((proposal) => (
                <Item key={proposal.id} variant="outline" size="sm">
                  <ItemContent className="min-w-0">
                    <ItemTitle>
                      {proposal.clientName ? (
                        <Link href={`/clientes/${proposal.clientId}`} className="hover:underline">
                          {proposal.clientName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Cliente sem acesso</span>
                      )}
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      {LISTING_PURPOSE_LABELS[proposal.purpose]} · Criada em{" "}
                      {formatDate(proposal.createdAt)}
                      {proposal.validUntil
                        ? ` · Válida até ${formatDateOnly(proposal.validUntil)}`
                        : ""}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="flex-col items-end gap-1">
                    <span className="font-medium tabular-nums">
                      {formatCurrency(proposal.amount)}
                      {proposal.purpose === "rent" ? (
                        <span className="text-xs font-normal text-muted-foreground">/mês</span>
                      ) : null}
                    </span>
                    <Badge variant={PROPOSAL_STATUS_VARIANTS[proposal.status]}>
                      {PROPOSAL_STATUS_LABELS[proposal.status]}
                    </Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
