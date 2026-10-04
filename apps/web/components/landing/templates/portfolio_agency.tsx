import { BadgeCheckIcon, MailIcon, MapPinIcon, PhoneIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { AboutOrganization } from "../sections/about-organization"
import { Gallery } from "../sections/gallery"
import { HeroBackdrop } from "../sections/hero-backdrop"
import { LandingActions } from "../sections/landing-actions"
import { LandingFooter } from "../sections/landing-footer"
import { LandingHeader } from "../sections/landing-header"
import { LeadFormPanel } from "../sections/lead-form-panel"
import { Section, SectionHeading, lpButtonClass, lpFocus } from "../sections/primitives"
import { PropertyGrid } from "../sections/property-grid"
import { StatsRow } from "../sections/social-proof"
import { Testimonials } from "../sections/testimonials"
import { CreciSeal } from "../sections/trust"
import { DISCLAIMERS, type LandingTemplateRenderProps } from "./shared"

/**
 * Página da imobiliária — institucional que ainda converte.
 * Hero com foto e o nome da casa; "Sobre" com diferenciais em frases grandes
 * separadas por fio; imóveis; depoimentos; e o contato final reúne números,
 * canais e formulário na mesma dobra.
 */
export function PortfolioAgencyTemplate({
  vm,
  mode,
  leadForm,
  id,
  formHref,
}: LandingTemplateRenderProps) {
  const { organization } = vm
  const propertiesId = id("imoveis")
  const team = vm.theme.images.banners.map((url, index) => ({
    url,
    alt: `Foto ${index + 1} da ${organization.name}`,
  }))
  const contactLink = cn(
    "inline-flex items-center gap-2 rounded-sm underline-offset-4 hover:underline",
    lpFocus
  )

  return (
    <>
      <LandingHeader vm={vm} formHref={formHref} variant="overlay" />

      <main>
        <section
          aria-labelledby={id("hero-title")}
          className="relative isolate flex min-h-[34rem] flex-col justify-end overflow-hidden text-(--lp-on-scrim) @3xl:min-h-[40rem]"
        >
          <HeroBackdrop
            imageUrl={vm.theme.images.background}
            mode={mode}
            fallbackLabel="Imagem de fundo"
          />
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-32 pb-12 @3xl:px-8 @3xl:pb-20">
            <h1
              id={id("hero-title")}
              className="max-w-[20ch] text-[2.5rem] leading-[1.04] font-semibold tracking-tight text-balance @xl:text-[3.25rem] @5xl:text-[4rem]"
            >
              {vm.copy.headline}
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-pretty">{vm.copy.subheadline}</p>
            {organization.creciLabel || organization.place ? (
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
                {organization.creciLabel ? (
                  <li className="flex items-center gap-2">
                    <BadgeCheckIcon aria-hidden="true" className="size-4" />
                    {organization.creciLabel}
                  </li>
                ) : null}
                {organization.place ? (
                  <li className="flex items-center gap-2">
                    <MapPinIcon aria-hidden="true" className="size-4" />
                    {organization.place}
                  </li>
                ) : null}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-3 pt-2">
              <a href={formHref} className={lpButtonClass({ tone: "light", size: "lg" })}>
                {vm.copy.ctaLabel}
              </a>
              <a
                href={`#${propertiesId}`}
                className={lpButtonClass({
                  tone: "outline-inverse",
                  size: "lg",
                })}
              >
                Ver imóveis
              </a>
            </div>
          </div>
        </section>

        <Section labelledBy={id("about-title")}>
          <AboutOrganization
            headingId={id("about-title")}
            title={`Sobre a ${organization.name}`}
            organization={organization}
            description={vm.description}
            highlights={vm.highlights}
          />
        </Section>

        {team.length > 0 || mode === "preview" ? (
          <Section className="pt-0 @3xl:pt-0">
            <Gallery
              images={team}
              mode={mode}
              label={`Fotos da ${organization.name}`}
              placeholderCount={vm.template.imageSlots.banners}
              placeholderLabel="Foto da equipe ou do escritório"
            />
          </Section>
        ) : null}

        <Section id={propertiesId} tone="alt" labelledBy={id("properties-title")}>
          <div className="flex flex-col gap-8">
            <SectionHeading id={id("properties-title")} title="Imóveis em destaque" />
            <PropertyGrid
              properties={vm.properties}
              formHref={formHref}
              mode={mode}
              ctaLabel={vm.copy.ctaLabel}
            />
          </div>
        </Section>

        {vm.testimonials.length > 0 ? (
          <Section labelledBy={id("testimonials-title")}>
            <div className="flex flex-col gap-10">
              <SectionHeading id={id("testimonials-title")} title="O que dizem nossos clientes" />
              <Testimonials items={vm.testimonials} />
            </div>
          </Section>
        ) : null}

        <Section tone="alt" labelledBy={id("contact-title")}>
          <div className="grid gap-12 @4xl:grid-cols-[minmax(0,1fr)_26rem] @4xl:items-start @4xl:gap-16">
            <div className="flex flex-col gap-10">
              <SectionHeading
                id={id("contact-title")}
                title="Fale com a gente"
                description="Comprar, vender ou alugar: conte o que você precisa e um corretor da equipe responde."
              />
              <StatsRow stats={vm.socialProof} columns={2} />
              <address className="flex flex-col gap-3 not-italic">
                {organization.phoneHref && organization.phoneDisplay ? (
                  <a href={organization.phoneHref} className={contactLink}>
                    <PhoneIcon aria-hidden="true" className="size-4 text-(--lp-primary-text)" />
                    {organization.phoneDisplay}
                  </a>
                ) : null}
                {organization.email ? (
                  <a href={`mailto:${organization.email}`} className={contactLink}>
                    <MailIcon aria-hidden="true" className="size-4 text-(--lp-primary-text)" />
                    {organization.email}
                  </a>
                ) : null}
                {organization.place ? (
                  <span className="inline-flex items-center gap-2">
                    <MapPinIcon aria-hidden="true" className="size-4 text-(--lp-primary-text)" />
                    {organization.place}
                  </span>
                ) : null}
              </address>
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
        </Section>
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
