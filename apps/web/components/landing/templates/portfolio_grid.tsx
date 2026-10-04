import { cn } from "@workspace/ui/lib/utils"

import { pluralize } from "@/lib/landing/format"

import { HeroBackdrop } from "../sections/hero-backdrop"
import { LandingActions } from "../sections/landing-actions"
import { LandingFooter } from "../sections/landing-footer"
import { LandingHeader } from "../sections/landing-header"
import { LeadFormPanel } from "../sections/lead-form-panel"
import { Section, SectionHeading, lpButtonClass, lpDisplayFont } from "../sections/primitives"
import { PropertyGrid } from "../sections/property-grid"
import { StatsRow } from "../sections/social-proof"
import { Testimonials } from "../sections/testimonials"
import { CreciSeal, FinancingNote } from "../sections/trust"
import { DISCLAIMERS, type LandingTemplateRenderProps } from "./shared"

/**
 * Vitrine de imóveis — os imóveis são o conteúdo.
 * Hero compacto (quem veio do anúncio quer ver opções, não ler), grade de
 * cards com preço em destaque e, no fim, "Não achou?" com prova social ao
 * lado do formulário para capturar quem não encontrou o imóvel certo.
 */
export function PortfolioGridTemplate({
  vm,
  mode,
  leadForm,
  id,
  formHref,
}: LandingTemplateRenderProps) {
  const propertiesId = id("imoveis")
  const count = vm.properties.length

  return (
    <>
      <LandingHeader vm={vm} formHref={formHref} variant="solid" />

      <main>
        <section
          aria-labelledby={id("hero-title")}
          className="relative isolate overflow-hidden text-(--lp-on-scrim)"
        >
          <HeroBackdrop
            imageUrl={vm.theme.images.background}
            mode={mode}
            fallbackLabel="Imagem de fundo"
          />
          <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-12 @3xl:px-8 @3xl:py-16">
            <h1
              id={id("hero-title")}
              className={cn(
                lpDisplayFont,
                "max-w-[22ch] text-[2.25rem] leading-[1.02] font-bold tracking-tight text-balance @xl:text-[3rem]"
              )}
            >
              {vm.copy.headline}
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-pretty">{vm.copy.subheadline}</p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {count > 0 ? (
                <p className="text-sm font-semibold">
                  {pluralize(count, "imóvel selecionado", "imóveis selecionados")}
                </p>
              ) : null}
              <FinancingNote text={vm.financingNote} tone="scrim" />
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <a href={`#${propertiesId}`} className={lpButtonClass({ tone: "light" })}>
                Ver os imóveis
              </a>
              <a href={formHref} className={lpButtonClass({ tone: "outline-inverse" })}>
                {vm.copy.ctaLabel}
              </a>
            </div>
          </div>
        </section>

        <Section id={propertiesId} labelledBy={id("properties-title")}>
          <div className="flex flex-col gap-8">
            <SectionHeading id={id("properties-title")} title="Imóveis selecionados" />
            <PropertyGrid
              properties={vm.properties}
              formHref={formHref}
              mode={mode}
              ctaLabel={vm.copy.ctaLabel}
            />
          </div>
        </Section>

        <Section tone="alt" labelledBy={id("contact-title")}>
          <div className="grid gap-12 @4xl:grid-cols-[minmax(0,1fr)_26rem] @4xl:items-start @4xl:gap-16">
            <div className="flex flex-col gap-10">
              <SectionHeading
                id={id("contact-title")}
                title="Procura algo diferente?"
                description="Conte o bairro, a faixa de valor e quantos quartos você precisa. Um corretor faz a busca e envia opções."
              />
              <StatsRow stats={vm.socialProof} columns={2} />
              <Testimonials items={vm.testimonials} layout="column" />
            </div>
            <div className="@4xl:sticky @4xl:top-6">
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
