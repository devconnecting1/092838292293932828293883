import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Card, CardContent } from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import { CaptureForm } from "@/components/captacao/capture-form"
import { getInitials } from "@/components/crm/utils"
import { issueFormToken } from "@/lib/captacao/anti-bot"
import { brandCssVariables } from "@/lib/captacao/brand"
import { formatPhoneDisplay, telUrl } from "@/lib/captacao/masks"
import {
  getPublicOrganization,
  publicCreciLabel,
  type PublicOrganization,
} from "@/lib/captacao/public-organization"
import { buildCaptureUrl, isValidTenantSlug } from "@/lib/tenant/urls"

type CaptarPageProps = {
  params: Promise<{ slug: string }>
}

/** Canônica: {slug}.raiz/captar (subdomain) ou site/captar/{slug} (host único). */
function captureCanonicalUrl(slug: string) {
  if (!isValidTenantSlug(slug)) {
    return undefined
  }

  try {
    return buildCaptureUrl(slug)
  } catch {
    // Host único sem NEXT_PUBLIC_SITE_URL: sem canonical.
    return undefined
  }
}

function formatPlace(organization: PublicOrganization) {
  return [organization.city, organization.state].filter(Boolean).join("/") || null
}

export async function generateMetadata({ params }: CaptarPageProps): Promise<Metadata> {
  const { slug } = await params
  const organization = await getPublicOrganization(slug)

  if (!organization) {
    return {
      title: "Imobiliária não encontrada",
      robots: { index: false, follow: false },
    }
  }

  const place = formatPlace(organization)
  const title = `Anuncie seu imóvel com ${organization.name}`
  const description = `Quer vender ou alugar seu imóvel${place ? ` em ${place}` : ""}? Envie os dados para ${organization.name} e receba o contato de um corretor.`
  const canonical = captureCanonicalUrl(organization.slug)

  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "pt_BR",
      url: canonical,
    },
  }
}

export default async function CaptarPage({ params }: CaptarPageProps) {
  // O token antirrobô guarda o horário de abertura: a página não pode ser estática.
  await connection()

  const { slug } = await params
  const organization = await getPublicOrganization(slug)

  if (!organization) {
    notFound()
  }

  const place = formatPlace(organization)
  const phoneHref = telUrl(organization.phone)
  // CRECI J da imobiliária ou, para o corretor autônomo, o CRECI F do dono.
  const creciLabel = publicCreciLabel(organization)

  // Cor da marca só em destaques (faixa do cabeçalho e botão de envio), com o
  // texto em branco ou quase preto conforme o contraste. Sem cor: tokens do tema.
  const brandStyle = brandCssVariables(organization.brand.primaryColor)
  const isBranded = brandStyle !== undefined

  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
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
            {place ? (
              <span className={cn("text-sm", isBranded ? "opacity-85" : "text-muted-foreground")}>
                {place}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:py-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
            Anuncie seu imóvel com {organization.name}
          </h1>
          <p className="text-pretty text-muted-foreground">
            Conte um pouco sobre o imóvel que você quer vender ou alugar. Um corretor entra em
            contato para tirar dúvidas e combinar a avaliação, sem compromisso.
          </p>
        </div>
        <Card>
          <CardContent>
            <CaptureForm
              slug={organization.slug}
              organizationName={organization.name}
              token={issueFormToken(organization.slug)}
              brandStyle={brandStyle}
            />
          </CardContent>
        </Card>
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{organization.name}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            {creciLabel ? <span>{creciLabel}</span> : null}
            {place ? <span>{place}</span> : null}
            {organization.phone ? (
              phoneHref ? (
                <a href={phoneHref} className="underline-offset-4 hover:underline">
                  {formatPhoneDisplay(organization.phone)}
                </a>
              ) : (
                <span>{organization.phone}</span>
              )
            ) : null}
            {organization.email ? (
              <a
                href={`mailto:${encodeURIComponent(organization.email)}`}
                className="underline-offset-4 hover:underline"
              >
                {organization.email}
              </a>
            ) : null}
          </p>
          <p>
            Os dados enviados são usados somente para o contato sobre o imóvel informado, conforme a
            Lei Geral de Proteção de Dados (LGPD).
          </p>
        </div>
      </footer>
    </div>
  )
}
