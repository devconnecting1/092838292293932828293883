import type { Metadata } from "next"
import { notFound } from "next/navigation"
import {
  BedDoubleIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  DownloadIcon,
  MessageCircleIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { formatBRL } from "@workspace/core/billing/format"
import { describeRoundTerms, formatRoundTitle } from "@workspace/core/proposals/rounds"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { cn } from "@workspace/ui/lib/utils"

import { getInitials } from "@/components/crm/utils"
import { RegisterProposalView } from "@/components/propostas/register-proposal-view"
import { brandCssVariables } from "@/lib/captacao/brand"
import { telUrl, whatsappUrl } from "@/lib/captacao/masks"
import { formatDateOnly, todayInSaoPaulo } from "@/lib/chaves/datetime"
import { formatArea, formatDateTime } from "@/lib/format"
import type { ProposalDocument } from "@/lib/propostas/document"
import { getSharedProposalDocument } from "@/lib/propostas/share"

/**
 * Página pública da proposta (/proposta/{token}): o corretor manda o endereço
 * no WhatsApp e o cliente lê sem instalar nada nem entrar no CRM.
 *
 * Sem sessão e fora dos buscadores (X-Robots-Tag em next.config.ts, robots.txt
 * e a meta desta página). O acesso é decidido pela RPC get_shared_proposal, que
 * devolve null para token errado, revogado ou vencido — todos viram 404.
 */

// Sempre no servidor, a cada visita: o link pode ser revogado ou vencer, e a
// proposta muda enquanto a negociação anda.
export const dynamic = "force-dynamic"

type PropostaPublicaPageProps = {
  params: Promise<{ token: string }>
}

const NOT_FOUND_METADATA: Metadata = {
  title: "Proposta não encontrada",
  robots: { index: false, follow: false },
}

export async function generateMetadata({ params }: PropostaPublicaPageProps): Promise<Metadata> {
  const { token } = await params
  const document = await getSharedProposalDocument(token)

  if (!document) {
    return NOT_FOUND_METADATA
  }

  // A prévia do WhatsApp mostra título e descrição: nada de valor ou endereço
  // aqui — o link pode ser encaminhado para um grupo.
  return {
    title: `Proposta · ${document.organization.name}`,
    description: `${document.organization.name} enviou uma proposta de ${document.proposal.purposeLabel.toLowerCase()}. Abra para ver valores, condições e validade.`,
    robots: { index: false, follow: false },
  }
}

function formatMoney(value: number | null | undefined) {
  return value == null ? null : formatBRL(Math.round(value * 100))
}

function propertyFeatures(property: ProposalDocument["property"]) {
  if (!property) {
    return []
  }

  return [
    property.bedrooms ? `${property.bedrooms} dormitório(s)` : null,
    property.suites ? `${property.suites} suíte(s)` : null,
    property.bathrooms ? `${property.bathrooms} banheiro(s)` : null,
    property.parkingSpaces ? `${property.parkingSpaces} vaga(s)` : null,
    property.livingArea ? `${formatArea(property.livingArea)} úteis` : null,
    property.lotArea ? `${formatArea(property.lotArea)} de terreno` : null,
  ].filter((item): item is string => Boolean(item))
}

function DataRow({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return null
  }

  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-pretty">{value}</dd>
    </div>
  )
}

export default async function PropostaPublicaPage({ params }: PropostaPublicaPageProps) {
  const { token } = await params
  const document = await getSharedProposalDocument(token)

  if (!document) {
    notFound()
  }

  const { organization, proposal, property, client, broker } = document
  const brandStyle = brandCssVariables(organization.brand.primaryColor)
  const isBranded = brandStyle !== undefined
  const place = [organization.city, organization.state].filter(Boolean).join("/")
  const creciLabel = organization.creci
    ? /^creci/i.test(organization.creci)
      ? organization.creci
      : `CRECI ${organization.creci}`
    : null

  const isExpired = proposal.validUntil !== null && proposal.validUntil < todayInSaoPaulo()
  const decision =
    proposal.status === "accepted"
      ? { label: "Proposta aceita", variant: "default" as const }
      : proposal.status === "rejected"
        ? { label: "Proposta recusada", variant: "destructive" as const }
        : proposal.status === "withdrawn"
          ? { label: "Proposta retirada", variant: "outline" as const }
          : null

  const brokerPhone = broker?.phone ?? organization.phone
  const brokerWhatsapp = whatsappUrl(brokerPhone)
  const brokerTel = telUrl(brokerPhone)
  const features = propertyFeatures(property)
  const terms = describeRoundTerms(proposal.terms, (value) => formatBRL(Math.round(value * 100)))

  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <RegisterProposalView token={token} />

      <header
        style={brandStyle}
        className={cn(
          "border-b",
          isBranded ? "bg-primary text-primary-foreground" : "bg-background"
        )}
      >
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-4">
          <Avatar className="size-10 rounded-lg after:rounded-lg">
            {organization.brand.logoUrl ? (
              <AvatarImage
                src={organization.brand.logoUrl}
                alt={`Logo de ${organization.name}`}
                className="rounded-lg bg-background object-contain"
              />
            ) : null}
            <AvatarFallback
              className={cn(
                "rounded-lg",
                isBranded ? "bg-background text-foreground" : "bg-primary text-primary-foreground"
              )}
            >
              {getInitials(organization.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{organization.name}</span>
            {creciLabel || place ? (
              <span className={cn("text-sm", isBranded ? "opacity-85" : "text-muted-foreground")}>
                {[creciLabel, place].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:py-12">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
              Proposta de {proposal.purposeLabel.toLowerCase()}
            </h1>
            {decision ? <Badge variant={decision.variant}>{decision.label}</Badge> : null}
            {proposal.round ? (
              <Badge variant="outline">
                {formatRoundTitle(proposal.round.number, proposal.round.kind)}
              </Badge>
            ) : null}
          </div>
          <p className="text-pretty text-muted-foreground">
            {client?.name ? `${client.name}, esta ` : "Esta "}é a proposta registrada por{" "}
            {organization.name}
            {property ? ` para o imóvel ${property.code}` : ""}. Guarde ou baixe o PDF para conferir
            com calma.
          </p>
        </div>

        {isExpired && !decision ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Validade vencida</AlertTitle>
            <AlertDescription>
              Esta proposta valia até {formatDateOnly(proposal.validUntil)}. Fale com o corretor
              para renovar as condições.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardDescription>
              {proposal.round?.kind === "owner_counter"
                ? "Contraproposta do proprietário para"
                : "Valor proposto para"}{" "}
              {proposal.purposeLabel.toLowerCase()}
            </CardDescription>
            <CardTitle className="text-3xl tabular-nums md:text-4xl">
              {formatBRL(Math.round(proposal.amount * 100))}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="flex flex-col gap-4">
              {terms.map((term) => (
                <DataRow key={term.label} label={term.label} value={term.value} />
              ))}
              <DataRow label="Forma de pagamento" value={proposal.paymentTerms} />
              <DataRow label="Condições" value={proposal.conditions} />
              <DataRow
                label="Validade"
                value={
                  proposal.validUntil
                    ? `Até ${formatDateOnly(proposal.validUntil)}`
                    : "Sem prazo definido"
                }
              />
            </dl>
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button render={<a href={`/proposta/${token}/pdf`} />} nativeButton={false}>
                <DownloadIcon data-icon="inline-start" />
                Baixar em PDF
              </Button>
              {brokerWhatsapp ? (
                <Button
                  variant="outline"
                  render={
                    <a href={brokerWhatsapp} target="_blank" rel="noopener noreferrer nofollow" />
                  }
                  nativeButton={false}
                >
                  <MessageCircleIcon data-icon="inline-start" />
                  Falar com o corretor
                </Button>
              ) : brokerTel ? (
                <Button variant="outline" render={<a href={brokerTel} />} nativeButton={false}>
                  <MessageCircleIcon data-icon="inline-start" />
                  Ligar para o corretor
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {property ? (
          <Card>
            <CardHeader>
              <CardTitle>Imóvel</CardTitle>
              <CardDescription>
                {[property.code, property.typeLabel, property.usageLabel]
                  .filter(Boolean)
                  .join(" · ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="font-medium text-pretty">{property.title}</p>
              <dl className="grid gap-4 sm:grid-cols-2">
                <DataRow label="Endereço" value={property.address} />
                <DataRow label="CEP" value={property.postalCode} />
                <DataRow label="Condomínio" value={property.condominiumName} />
                <DataRow label="Valor anunciado" value={formatMoney(property.listedPrice)} />
                <DataRow label="Taxa de condomínio" value={formatMoney(property.condoFee)} />
                <DataRow label="IPTU (anual)" value={formatMoney(property.iptuYearly)} />
              </dl>
              {features.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <BedDoubleIcon className="size-4 text-muted-foreground" />
                  {features.map((feature) => (
                    <Badge key={feature} variant="secondary">
                      {feature}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Proponente</CardTitle>
            <CardDescription>Quem faz a proposta.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DataRow label="Nome" value={client?.name ?? null} />
              <DataRow
                label={client?.kind === "pj" ? "CNPJ" : "CPF"}
                value={client?.document ?? null}
              />
              <DataRow label="Telefone" value={client?.phone ?? null} />
              <DataRow label="E-mail" value={client?.email ?? null} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Corretor responsável</CardTitle>
            <CardDescription>Tire suas dúvidas antes de assinar.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DataRow label="Nome" value={broker?.name ?? organization.name} />
              <DataRow label="CRECI" value={broker?.creci ?? creciLabel} />
              <DataRow label="Telefone" value={brokerPhone} />
              <DataRow label="E-mail" value={broker?.email ?? organization.email} />
            </dl>
          </CardContent>
        </Card>

        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Como assinar</AlertTitle>
          <AlertDescription>
            Baixe o PDF, assine no campo do proponente e devolva para o corretor. A proposta só
            vincula as partes depois do aceite do proprietário.
          </AlertDescription>
        </Alert>
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            {organization.legalName ?? organization.name}
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            {creciLabel ? <span>{creciLabel}</span> : null}
            {organization.cnpj ? <span>CNPJ {organization.cnpj}</span> : null}
            {place ? <span>{place}</span> : null}
            {organization.phone ? <span>{organization.phone}</span> : null}
            {organization.email ? <span>{organization.email}</span> : null}
          </p>
          <p className="flex items-center gap-2">
            <CalendarClockIcon className="size-4" />
            Página gerada em {formatDateTime(document.generatedAt)}.
          </p>
        </div>
      </footer>
    </div>
  )
}
