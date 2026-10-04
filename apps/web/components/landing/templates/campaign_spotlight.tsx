import { MapPinIcon, type LucideIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

import { formatCurrency } from "@/lib/format"
import type { PropertySpec } from "@/lib/landing/format"

import { BrokerCard } from "../sections/broker-card"
import { Gallery } from "../sections/gallery"
import { HeroBackdrop } from "../sections/hero-backdrop"
import { LandingActions } from "../sections/landing-actions"
import { LandingFooter } from "../sections/landing-footer"
import { LandingHeader } from "../sections/landing-header"
import { LeadFormPanel } from "../sections/lead-form-panel"
import { LocationBlock } from "../sections/location"
import { Paragraphs, Section, SectionHeading, lpDisplayFont } from "../sections/primitives"
import { PROPERTY_SPEC_ICONS } from "../sections/property-card"
import { PropertiesEmpty } from "../sections/property-grid"
import { SocialProof, hasSocialProof } from "../sections/social-proof"
import { CreciSeal, FinancingNote } from "../sections/trust"
import { ClosingCta, DISCLAIMERS, type LandingTemplateRenderProps } from "./shared"

const SPEC_LABELS: Record<PropertySpec["key"], string> = {
  area: "Área",
  bedrooms: "Quartos",
  suites: "Suítes",
  bathrooms: "Banheiros",
  parking: "Vagas",
}

type HeroFact = { key: string; label: string; icon: LucideIcon | null }

/**
 * Imóvel em destaque — um imóvel, uma decisão.
 * Hero em tela cheia com a foto; o preço em corpo condensado extra-negrito é
 * a peça principal, com a régua de destaques logo abaixo. Formulário ao lado
 * no desktop e logo após a régua no mobile.
 */
export function CampaignSpotlightTemplate({
  vm,
  mode,
  leadForm,
  id,
  formHref,
}: LandingTemplateRenderProps) {
  const property = vm.featured
  const [price, otherPrice] = property?.prices ?? []
  const background = vm.theme.images.background
  const heroImage = background ?? property?.coverUrl ?? null
  const heroAlt = !background && property ? `Foto do imóvel: ${property.title}` : ""

  const facts: HeroFact[] =
    vm.highlights.length > 0
      ? vm.highlights.slice(0, 3).map((label, index) => ({
          key: `destaque-${index}`,
          label,
          icon: null,
        }))
      : (property?.specs ?? []).slice(0, 4).map((spec) => ({
          key: spec.key,
          label: spec.value,
          icon: PROPERTY_SPEC_ICONS[spec.key],
        }))

  const photos = (property?.mediaUrls ?? []).filter((url) => url !== heroImage).slice(0, 6)
  const galleryImages = photos.map((url, index) => ({
    url,
    alt: `Foto ${index + 1} de ${photos.length}: ${property?.title ?? "imóvel"}`,
  }))

  const details = property
    ? [
        ...(property.code ? [{ label: "Código", value: property.code }] : []),
        ...property.specs.map((spec) => ({
          label: SPEC_LABELS[spec.key],
          value: spec.value,
        })),
        ...(property.condoFee
          ? [
              {
                label: "Condomínio",
                value: `${formatCurrency(property.condoFee)}/mês`,
              },
            ]
          : []),
      ]
    : []

  return (
    <>
      <LandingHeader vm={vm} formHref={formHref} variant="overlay" />

      <main>
        <section
          aria-labelledby={id("hero-title")}
          className="relative isolate overflow-hidden text-(--lp-on-scrim)"
        >
          <HeroBackdrop
            imageUrl={heroImage}
            alt={heroAlt}
            scrim="left"
            mode={mode}
            fallbackLabel="Imagem de fundo ou foto de capa do imóvel"
          />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-28 pb-12 @3xl:px-8 @3xl:pt-36 @5xl:grid-cols-[minmax(0,1fr)_25rem] @5xl:items-start @5xl:gap-14 @5xl:pb-20">
            <div className="flex flex-col gap-6 @5xl:pt-4">
              {property ? (
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium">
                  <span>
                    {property.typeLabel}
                    {property.purposeLabel ? ` para ${property.purposeLabel.toLowerCase()}` : ""}
                  </span>
                  {property.place ? (
                    <span className="flex items-center gap-1.5">
                      <MapPinIcon aria-hidden="true" className="size-4" />
                      {property.place}
                    </span>
                  ) : null}
                </p>
              ) : null}

              <h1
                id={id("hero-title")}
                className={cn(
                  lpDisplayFont,
                  "max-w-[18ch] text-[2.5rem] leading-[0.98] font-bold tracking-tight text-balance @xl:text-[3.25rem] @5xl:text-[4.25rem]"
                )}
              >
                {vm.copy.headline}
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-pretty">{vm.copy.subheadline}</p>

              {price ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium">{price.label}</p>
                  <p
                    className={cn(
                      lpDisplayFont,
                      "text-[2.75rem] leading-none font-extrabold tracking-tight tabular-nums @xl:text-[3.75rem]"
                    )}
                  >
                    {price.amount}
                    {price.suffix ? (
                      <span className="ms-1 text-xl font-semibold">{price.suffix}</span>
                    ) : null}
                  </p>
                  {otherPrice || property?.condoFee ? (
                    <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                      {otherPrice ? (
                        <span>
                          {otherPrice.label} {otherPrice.amount}
                          {otherPrice.suffix}
                        </span>
                      ) : null}
                      {property?.condoFee ? (
                        <span>Condomínio {formatCurrency(property.condoFee)}/mês</span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <FinancingNote text={vm.financingNote} tone="scrim" />

              {facts.length > 0 ? (
                <ul className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-current/40 pt-5 @xl:flex @xl:flex-wrap @xl:gap-x-8">
                  {facts.map((fact) => {
                    const Icon = fact.icon
                    return (
                      <li key={fact.key} className="flex items-center gap-2 font-medium">
                        {Icon ? (
                          <Icon aria-hidden="true" className="size-5 shrink-0" />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full bg-current"
                          />
                        )}
                        {fact.label}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>

            <LeadFormPanel
              id={id("lead-form")}
              title={vm.copy.formTitle}
              description={vm.copy.formDescription}
              size={vm.template.leadFormSize}
              seal={<CreciSeal vm={vm} />}
            >
              {leadForm}
            </LeadFormPanel>
          </div>
        </section>

        {hasSocialProof(vm.socialProof, vm.testimonials) ? (
          <Section tone="alt" labelledBy={id("proof-title")}>
            <SocialProof
              headingId={id("proof-title")}
              title="Quem negociou com a gente"
              stats={vm.socialProof}
              testimonials={vm.testimonials}
            />
          </Section>
        ) : null}

        {property ? (
          <Section labelledBy={id("details-title")}>
            <div className="grid gap-10 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @4xl:gap-16">
              <div className="flex flex-col gap-6">
                <SectionHeading
                  id={id("details-title")}
                  title="Sobre o imóvel"
                  description={property.title !== vm.copy.headline ? property.title : undefined}
                />
                {vm.description ? <Paragraphs text={vm.description} /> : null}
                {property.features.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    <h3 className="font-semibold">Itens e comodidades</h3>
                    <ul className="flex flex-wrap gap-2">
                      {property.features.map((feature) => (
                        <li key={feature}>
                          <Badge variant="outline">{feature}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              {details.length > 0 ? (
                <dl className="grid grid-cols-2 content-start gap-px overflow-hidden rounded-(--lp-radius) border border-(--lp-line) bg-(--lp-line)">
                  {details.map((detail) => (
                    <div key={detail.label} className="flex flex-col gap-1 bg-(--lp-surface) p-4">
                      <dt className="text-xs text-(--lp-ink-muted)">{detail.label}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </Section>
        ) : (
          <Section>
            <PropertiesEmpty mode={mode} formHref={formHref} ctaLabel={vm.copy.ctaLabel} />
          </Section>
        )}

        {galleryImages.length > 0 ? (
          <Section tone="alt" labelledBy={id("gallery-title")}>
            <div className="flex flex-col gap-8">
              <SectionHeading id={id("gallery-title")} title="Fotos do imóvel" />
              <Gallery images={galleryImages} mode={mode} label="Fotos do imóvel" />
            </div>
          </Section>
        ) : null}

        {property?.place ? (
          <Section labelledBy={id("location-title")}>
            <LocationBlock
              headingId={id("location-title")}
              title="Onde fica"
              place={property.place}
              description="O endereço completo é informado pelo corretor ao agendar a visita."
            />
          </Section>
        ) : null}

        {vm.broker ? (
          <Section className="pt-0 @3xl:pt-0">
            <BrokerCard
              broker={vm.broker}
              organization={vm.organization}
              whatsappHref={vm.whatsappHref}
              headingId={id("broker-title")}
            />
          </Section>
        ) : null}

        <ClosingCta
          headingId={id("closing-title")}
          title="Quer conhecer o imóvel pessoalmente?"
          formHref={formHref}
          ctaLabel={vm.copy.ctaLabel}
        />
      </main>

      <LandingFooter vm={vm} disclaimer={DISCLAIMERS.property} />
      <LandingActions
        formHref={formHref}
        ctaLabel={vm.copy.ctaLabel}
        whatsappHref={vm.whatsappHref}
        mode={mode}
      />
    </>
  )
}
