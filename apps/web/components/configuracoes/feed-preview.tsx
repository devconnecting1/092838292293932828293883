import Link from "next/link"
import { CircleAlertIcon, CircleCheckIcon, HouseIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@workspace/ui/components/item"

import type { FeedPreviewState } from "@/lib/portais/feed-preview"
import type { PortalFeedSkippedListing } from "@/lib/portais/vrsync-mapper"

const numberFormat = new Intl.NumberFormat("pt-BR")

/** Só os erros bloqueiam a publicação; avisos (ex.: URL de detalhes) não aparecem aqui. */
function getBlockingMessages(listing: PortalFeedSkippedListing) {
  return [
    ...new Set(
      listing.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message)
    ),
  ]
}

export function FeedPreview({ preview }: { preview: FeedPreviewState }) {
  if (preview.status === "error") {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Prévia indisponível</AlertTitle>
        <AlertDescription>{preview.message}</AlertDescription>
      </Alert>
    )
  }

  const { total, included, skipped, headerIssues } = preview.result
  const stats = [
    { label: "Ativos e marcados para publicar", value: total },
    { label: "Entram no feed", value: included.length },
    { label: "Ficam de fora", value: skipped.length },
  ]

  return (
    <div className="flex flex-col gap-4">
      {headerIssues.length > 0 ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Complete os dados da imobiliária</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 ps-4">
              {headerIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums">
                {numberFormat.format(stat.value)}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {total === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HouseIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum imóvel para publicar</EmptyTitle>
            <EmptyDescription>
              Entram no feed os imóveis com status Ativo e a opção de publicar nos portais marcada
              no cadastro.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link href="/imoveis" />} nativeButton={false}>
              Ver imóveis
            </Button>
          </EmptyContent>
        </Empty>
      ) : skipped.length === 0 ? (
        <Alert>
          <CircleCheckIcon />
          <AlertTitle>Todos os imóveis entram no feed</AlertTitle>
          <AlertDescription>Nenhum problema encontrado nos imóveis publicados.</AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            Corrija estes imóveis para que entrem na próxima leitura do portal:
          </p>
          <ItemGroup className="gap-2">
            {skipped.map((listing) => (
              <Item key={`${listing.id ?? "sem-id"}-${listing.code}`} variant="outline">
                <ItemContent>
                  <ItemTitle>
                    {listing.code}
                    {listing.title ? ` · ${listing.title}` : ""}
                  </ItemTitle>
                  <ul className="flex list-disc flex-col gap-1 ps-4 text-sm text-muted-foreground">
                    {getBlockingMessages(listing).map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </ItemContent>
                {listing.id ? (
                  <ItemActions>
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href={`/imoveis/${listing.id}`} />}
                      nativeButton={false}
                    >
                      Abrir imóvel
                    </Button>
                  </ItemActions>
                ) : null}
              </Item>
            ))}
          </ItemGroup>
        </div>
      )}
    </div>
  )
}
