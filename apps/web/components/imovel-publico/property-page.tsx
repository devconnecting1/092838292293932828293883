import {
  BathIcon,
  BedDoubleIcon,
  CarIcon,
  ExternalLinkIcon,
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  PhoneIcon,
  RulerIcon,
  ShowerHeadIcon,
  type LucideIcon,
} from "lucide-react"

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

import { PropertyGallery } from "@/components/imovel-publico/property-gallery"
import { PropertyLeadForm } from "@/components/imovel-publico/property-lead-form"
import type { PublicPropertyView } from "@/lib/imovel-publico/view-model"
import type { PropertySpec } from "@/lib/landing/format"

const INTEREST_ANCHOR = "interesse"
const PRIVACY_ANCHOR = "privacidade"

const SPEC_ICONS: Record<PropertySpec["key"], LucideIcon> = {
  area: RulerIcon,
  bedrooms: BedDoubleIcon,
  suites: BathIcon,
  bathrooms: ShowerHeadIcon,
  parking: CarIcon,
}

function BrandMark({ organization }: { organization: PublicPropertyView["organization"] }) {
  if (organization.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- logo https da imobiliária (fora do otimizador).
      <img
        src={organization.logoUrl}
        alt={organization.name}
        width={160}
        height={40}
        loading="eager"
        decoding="async"
        referrerPolicy="no-referrer"
        className="h-9 w-auto max-w-40 object-contain"
      />
    )
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
      >
        {organization.initials}
      </span>
      <span className="truncate font-semibold">{organization.name}</span>
    </span>
  )
}

function WhatsappButton({
  href,
  label = "Chamar no WhatsApp",
  variant = "default",
  className,
}: {
  href: string
  label?: string
  variant?: "default" | "outline"
  className?: string
}) {
  return (
    <Button
      size="lg"
      variant={variant}
      className={className}
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
      nativeButton={false}
    >
      <MessageCircleIcon data-icon="inline-start" />
      {label}
      <span className="sr-only">(abre em nova aba)</span>
    </Button>
  )
}

/** Texto com parágrafos separados por linha em branco. */
function Paragraphs({ text }: { text: string }) {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  return (
    <div className="flex max-w-[68ch] flex-col gap-3 leading-relaxed">
      {blocks.map((block, index) => (
        <p key={index} className="text-pretty whitespace-pre-line">
          {block}
        </p>
      ))}
    </div>
  )
}

/**
 * Página pública do imóvel (Server Component). Cores da marca da imobiliária
 * aplicadas nos tokens do shadcn dentro do wrapper (mesmo tema das landing
 * pages); sem cookies nem scripts de medição.
 */
export function PublicPropertyPage({
  view,
  orgSlug,
  hasTracking = false,
}: {
  view: PublicPropertyView
  orgSlug: string
  /** A imobiliária configurou Meta Pixel ou tag do Google (carregam só com aceite). */
  hasTracking?: boolean
}) {
  const { organization } = view
  // Barra fixa de contato no celular: espaço extra no fim da página para ela.
  const hasContactBar = Boolean(view.whatsappHref)

  return (
    <div
      style={view.theme.style}
      className="flex min-h-svh flex-col bg-background text-foreground antialiased"
    >
      <a
        href={`#${INTEREST_ANCHOR}`}
        className="sr-only rounded-lg bg-background px-4 py-2 font-medium focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Ir para o formulário de contato
      </a>

      <header className="border-b">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 py-2">
          <BrandMark organization={organization} />
          {view.whatsappHref ? (
            <WhatsappButton
              href={view.whatsappHref}
              label="WhatsApp"
              variant="outline"
              className="hidden sm:inline-flex"
            />
          ) : null}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pt-4 pb-8 lg:pt-8 lg:pb-16">
        <PropertyGallery photos={view.photos} title={view.title} />

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <article className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{view.typeLabel}</Badge>
                {view.purposeLabel ? <Badge variant="outline">{view.purposeLabel}</Badge> : null}
                <Badge variant="outline">Cód. {view.code}</Badge>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
                {view.title}
              </h1>
              {view.place ? (
                <p className="flex items-start gap-2 text-muted-foreground">
                  <MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>{view.place}</span>
                </p>
              ) : null}
            </div>

            {view.prices.length > 0 ? (
              <section aria-label="Valores" className="flex flex-col gap-2">
                <dl className="flex flex-wrap gap-x-8 gap-y-2">
                  {view.prices.map((price) => (
                    <div key={price.label} className="flex flex-col">
                      <dt className="text-sm text-muted-foreground">{price.label}</dt>
                      <dd className="text-2xl font-semibold tracking-tight">
                        {price.amount}
                        {price.suffix ? (
                          <span className="text-base font-normal text-muted-foreground">
                            {price.suffix}
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
                {view.costs.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {view.costs.map((cost) => `${cost.label}: ${cost.value}`).join(" · ")}
                  </p>
                ) : null}
              </section>
            ) : null}

            {view.specs.length > 0 ? (
              <section aria-label="Características principais">
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:flex md:flex-wrap md:gap-6">
                  {view.specs.map((spec) => {
                    const Icon = SPEC_ICONS[spec.key]

                    return (
                      <li key={spec.key} className="flex items-center gap-2">
                        <Icon aria-hidden="true" className="size-5 text-primary" />
                        <span>{spec.value}</span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ) : null}

            <Separator />

            {view.description ? (
              <section aria-labelledby="descricao" className="flex flex-col gap-3">
                <h2 id="descricao" className="text-lg font-semibold">
                  Sobre o imóvel
                </h2>
                <Paragraphs text={view.description} />
              </section>
            ) : null}

            {view.features.length > 0 ? (
              <section aria-labelledby="diferenciais" className="flex flex-col gap-3">
                <h2 id="diferenciais" className="text-lg font-semibold">
                  Diferenciais
                </h2>
                <ul className="flex flex-wrap gap-2">
                  {view.features.map((feature) => (
                    <li key={feature}>
                      <Badge variant="secondary">{feature}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="detalhes" className="flex flex-col gap-3">
              <h2 id="detalhes" className="text-lg font-semibold">
                Detalhes
              </h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {view.facts.map((fact) => (
                  <div key={fact.label} className="flex flex-col">
                    <dt className="text-sm text-muted-foreground">{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
              {view.links.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {view.links.map((link) => (
                    <Button
                      key={link.kind}
                      variant="outline"
                      render={
                        <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" />
                      }
                      nativeButton={false}
                    >
                      <ExternalLinkIcon data-icon="inline-start" />
                      {link.label}
                      <span className="sr-only">(abre em nova aba)</span>
                    </Button>
                  ))}
                </div>
              ) : null}
            </section>
          </article>

          <aside className="lg:sticky lg:top-6">
            <Card id={INTEREST_ANCHOR} className="scroll-mt-4">
              <CardHeader>
                <CardTitle className="text-base">Tenho interesse</CardTitle>
                <CardDescription>
                  Deixe seu contato e {organization.name} retorna para tirar dúvidas ou agendar uma
                  visita.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {view.whatsappHref ? (
                  <>
                    <WhatsappButton
                      href={view.whatsappHref}
                      label="Falar agora no WhatsApp"
                      className="hidden h-11 w-full lg:inline-flex"
                    />
                    <p className="hidden text-center text-sm text-muted-foreground lg:block">
                      ou envie seus dados
                    </p>
                  </>
                ) : null}
                <PropertyLeadForm
                  orgSlug={orgSlug}
                  propertyCode={view.code}
                  organizationName={organization.name}
                  interests={view.interests}
                  defaultInterest={view.defaultInterest}
                  whatsappHref={view.whatsappHref}
                  privacyHref={`#${PRIVACY_ANCHOR}`}
                />
              </CardContent>
            </Card>
          </aside>
        </div>

        <section
          id={PRIVACY_ANCHOR}
          aria-labelledby="privacidade-titulo"
          className="flex scroll-mt-4 flex-col gap-2 rounded-xl bg-muted p-4 text-sm"
        >
          <h2 id="privacidade-titulo" className="font-semibold">
            Como usamos seus dados
          </h2>
          <p>
            {organization.name}
            {organization.creciLabel ? ` (${organization.creciLabel})` : ""} é a responsável pelos
            dados enviados neste formulário: nome, telefone ou WhatsApp e, se você informar, e-mail,
            interesse e mensagem. Eles servem só para retornar o seu contato sobre este imóvel e o
            atendimento imobiliário, com base no seu consentimento (art. 7º, I, da LGPD).
          </p>
          {hasTracking ? (
            <p className="text-muted-foreground">
              Com o seu aceite no aviso de cookies, esta página ativa cookies de medição de
              parceiros (Meta Pixel e Google tag) para {organization.name} medir a visita e o envio
              do contato nos anúncios, sem enviar seus dados pessoais a eles (art. 7º, I). Sem
              aceite, nada é carregado; a escolha fica guardada em um cookie próprio por 180 dias.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Esta página não usa cookies nem ferramentas de medição de parceiros.
            </p>
          )}
          <p className="text-muted-foreground">
            Se o link trouxer parâmetros de campanha (utm) ou de anúncio, eles seguem com o
            formulário para a imobiliária saber de onde veio o contato (legítimo interesse, art. 7º,
            IX). Para evitar envios abusivos, usamos um código calculado a partir do seu IP, sem
            guardar o IP.
          </p>
          <p className="text-muted-foreground">
            Você pode pedir acesso, correção ou exclusão dos seus dados e revogar o consentimento
            diretamente com {organization.name}
            {organization.email ? ` (${organization.email})` : ""}.
          </p>
        </section>
      </main>

      <footer className="border-t bg-muted/40">
        <div
          className={cn(
            "mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-8 pb-8 text-sm",
            hasContactBar && "pb-24 lg:pb-8"
          )}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-2">
              <BrandMark organization={organization} />
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                {organization.creciLabel ? <li>{organization.creciLabel}</li> : null}
                {organization.place ? <li>{organization.place}</li> : null}
              </ul>
            </div>
            <address className="flex flex-col gap-2 not-italic">
              {organization.phoneHref && organization.phoneDisplay ? (
                <a
                  href={organization.phoneHref}
                  className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
                >
                  <PhoneIcon aria-hidden="true" className="size-4" />
                  {organization.phoneDisplay}
                </a>
              ) : null}
              {organization.email ? (
                <a
                  href={`mailto:${organization.email}`}
                  className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
                >
                  <MailIcon aria-hidden="true" className="size-4" />
                  {organization.email}
                </a>
              ) : null}
            </address>
          </div>
          <p className="text-xs text-muted-foreground">
            Valores e disponibilidade sujeitos a alteração sem aviso. © {organization.name}
          </p>
        </div>
      </footer>

      {hasContactBar && view.whatsappHref ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-6xl gap-2">
            <WhatsappButton href={view.whatsappHref} label="WhatsApp" className="h-11 flex-1" />
            <Button
              size="lg"
              variant="outline"
              className="h-11 flex-1"
              render={<a href={`#${INTEREST_ANCHOR}`} />}
              nativeButton={false}
            >
              Tenho interesse
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
