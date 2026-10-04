import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, ExternalLinkIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { CaixaFavoriteButton } from "@/components/caixa/caixa-favorite-button"
import { CaixaGallery } from "@/components/caixa/caixa-gallery"
import { CaixaLinkPanel } from "@/components/caixa/caixa-link-panel"
import { caixaListingTitle } from "@/components/caixa/caixa-listing-card"
import { CaixaSourceNotice } from "@/components/caixa/caixa-source-notice"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { requireMembership } from "@/lib/auth/session"
import { CAIXA_BASE_PATH, CAIXA_MISSING_FIELDS_NOTICE } from "@/lib/caixa/constants"
import { getCaixaListing } from "@/lib/caixa/detail-queries"
import { getCaixaCatalogStatus } from "@/lib/caixa/list-queries"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import { formatBrDate } from "@workspace/core/caixa/normalize"

import { formatArea, formatCurrency, formatDate } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 })

type CaixaDetailPageProps = {
  params: Promise<{ numero: string }>
}

export async function generateMetadata({ params }: CaixaDetailPageProps): Promise<Metadata> {
  const { numero } = await params

  return { title: `Imóvel ${numero} da Caixa` }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  )
}

export default async function CaixaListingPage({ params }: CaixaDetailPageProps) {
  const [{ membership }, { numero }] = await Promise.all([requireMembership(), params])
  const supabase = await createClient()

  const [detail, status] = await Promise.all([
    getCaixaListing(supabase, membership.organizationId, numero),
    getCaixaCatalogStatus(supabase),
  ])

  if (!detail) {
    notFound()
  }

  const { listing, links } = detail
  const title = caixaListingTitle(listing)
  // O mesmo interruptor da lista: uma variável desliga todas as fotos.
  const photosEnabled = areCaixaPhotosEnabled()

  return (
    <PageShell variant="record" aside={<CaixaLinkPanel numero={listing.numero} links={links} />}>
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          render={<Link href={CAIXA_BASE_PATH} />}
          nativeButton={false}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Imóveis da Caixa
        </Button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PageHeading title={title} description={listing.endereco} />
          <div className="flex shrink-0 items-center gap-2">
            <CaixaFavoriteButton
              numero={listing.numero}
              isFavorite={listing.isFavorite}
              withLabel
            />
            <Button
              size="sm"
              render={<a href={listing.link} target="_blank" rel="noopener noreferrer" />}
              nativeButton={false}
            >
              Ver no site da Caixa
              <ExternalLinkIcon data-icon="inline-end" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">Imóvel nº {listing.numero}</Badge>
          {listing.modalidade ? <Badge variant="secondary">{listing.modalidade}</Badge> : null}
          {/* O percentual é o publicado pela Caixa (coluna "Desconto" do
              arquivo). Não existe cálculo próprio aqui: em boa parte dos
              imóveis o preço é maior que a avaliação. */}
          {listing.desconto !== null && listing.desconto > 0 ? (
            <Badge>{percentFormat.format(listing.desconto)}% de desconto</Badge>
          ) : null}
        </div>

        {listing.saiuDaListaEm ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Este imóvel saiu da lista da Caixa</AlertTitle>
            <AlertDescription>
              Ele deixou de aparecer na lista pública em {formatDate(listing.saiuDaListaEm)}.
              Costuma significar que foi vendido ou retirado. Confirme no site da Caixa.
            </AlertDescription>
          </Alert>
        ) : null}

        <CaixaSourceNotice status={status} />

        <CaixaGallery numero={listing.numero} enabled={photosEnabled} alt={title} />

        <Card>
          <CardHeader>
            <CardTitle>Valores publicados pela Caixa</CardTitle>
            <CardDescription>
              Exatamente como estão na lista pública, sem nenhuma conta nossa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fact label="Valor de venda" value={formatCurrency(listing.preco)} />
              <Fact
                label="Valor de avaliação"
                value={
                  listing.valorAvaliacao === null
                    ? "Não informado"
                    : formatCurrency(listing.valorAvaliacao)
                }
              />
              <Fact
                label="Desconto publicado"
                value={
                  listing.desconto === null || listing.desconto === 0
                    ? "Sem desconto publicado"
                    : `${percentFormat.format(listing.desconto)}%`
                }
              />
              <Fact label="Modalidade" value={listing.modalidade ?? "Não informada"} />
              <Fact
                label="Financiamento Caixa"
                value={
                  listing.aceitaFinanciamento === null
                    ? "Não informado"
                    : listing.aceitaFinanciamento
                      ? "Aceita"
                      : "Não aceita"
                }
              />
              <Fact label="Visto na lista de" value={formatBrDate(listing.listaGeradaEm) ?? "—"} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>O imóvel</CardTitle>
            <CardDescription>Campos derivados da descrição da própria Caixa.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fact label="Cidade / UF" value={`${listing.cidade}/${listing.uf}`} />
              <Fact label="Bairro" value={listing.bairro ?? "Não informado"} />
              <Fact
                label="Área total"
                value={listing.areaTotal === null ? "—" : formatArea(listing.areaTotal)}
              />
              <Fact
                label="Área privativa"
                value={listing.areaPrivativa === null ? "—" : formatArea(listing.areaPrivativa)}
              />
              <Fact
                label="Área do terreno"
                value={listing.areaTerreno === null ? "—" : formatArea(listing.areaTerreno)}
              />
              <Fact
                label="Quartos e vagas"
                value={
                  [
                    listing.quartos === null ? null : `${listing.quartos} quarto(s)`,
                    listing.vagas === null ? null : `${listing.vagas} vaga(s)`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                    .trim() || "—"
                }
              />
            </dl>
            {listing.descricao ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">Descrição publicada pela Caixa</p>
                <p className="text-sm">{listing.descricao}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>O que não está aqui</AlertTitle>
          <AlertDescription>
            <p>{CAIXA_MISSING_FIELDS_NOTICE}</p>
            <p className="text-xs">
              Datas de leilão, edital, leiloeiro, CEP e comarca também só existem na página do
              imóvel no site da Caixa. Comissão de venda depende de credenciamento junto à Caixa.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    </PageShell>
  )
}
