import { cn } from "@workspace/ui/lib/utils"

import { Gallery } from "../sections/gallery"
import { HeroBackdrop } from "../sections/hero-backdrop"
import { HighlightList } from "../sections/highlights"
import { LandingActions } from "../sections/landing-actions"
import { LandingFooter } from "../sections/landing-footer"
import { LandingHeader } from "../sections/landing-header"
import { LeadFormPanel } from "../sections/lead-form-panel"
import { LocationBlock } from "../sections/location"
import {
  Paragraphs,
  Section,
  SectionHeading,
  lpButtonClass,
  lpSerifFont,
} from "../sections/primitives"
import { TypologyCards } from "../sections/typologies"
import { CreciSeal, FinancingNote, UnitsLeft } from "../sections/trust"
import { DISCLAIMERS, launchFacts, type LandingTemplateRenderProps } from "./shared"

/**
 * Lançamento completo — o book da incorporadora em forma de página.
 * O nome do empreendimento em corpo grande é a assinatura;
 * logo abaixo, a ficha técnica numa faixa escura (entrega, construtora,
 * localização, plantas). Galeria, tipologias, localização e o pedido do book
 * numa faixa escura com o formulário.
 */
export function LaunchShowcaseTemplate({
  vm,
  mode,
  leadForm,
  id,
  formHref,
}: LandingTemplateRenderProps) {
  const name = vm.launch.name
  const facts = launchFacts(vm)
  const heroImage = vm.theme.images.background ?? vm.theme.images.banners[0] ?? null
  const banners = vm.theme.images.banners.map((url, index) => ({
    url,
    alt: `Imagem ilustrativa ${index + 1}${name ? ` do ${name}` : " do empreendimento"}`,
  }))
  const showGallery = banners.length > 0 || mode === "preview"
  const showTypologies = vm.launch.typologies.length > 0 || mode === "preview"

  return (
    <>
      <LandingHeader vm={vm} formHref={formHref} variant="overlay" />

      <main>
        <section
          aria-labelledby={id("hero-title")}
          className="relative isolate flex min-h-[38rem] flex-col justify-end overflow-hidden text-(--lp-on-scrim) @3xl:min-h-[46rem]"
        >
          <HeroBackdrop
            imageUrl={heroImage}
            mode={mode}
            fallbackLabel="Imagem de fundo do empreendimento"
          />
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-32 pb-12 @3xl:px-8 @3xl:pb-16">
            {vm.launch.developer ? (
              <p className="text-sm font-medium">Um empreendimento {vm.launch.developer}</p>
            ) : null}
            <h1
              id={id("hero-title")}
              className={cn(
                lpSerifFont,
                "max-w-[14ch] text-[3rem] leading-[0.95] font-medium text-balance @xl:text-[4.25rem] @5xl:text-[5.75rem]"
              )}
            >
              {name ?? vm.copy.headline}
            </h1>
            {name ? (
              <p className="max-w-2xl text-xl leading-snug text-balance @3xl:text-2xl">
                {vm.copy.headline}
              </p>
            ) : null}
            <p className="max-w-xl leading-relaxed text-pretty">{vm.copy.subheadline}</p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <a href={formHref} className={lpButtonClass({ tone: "light", size: "lg" })}>
                {vm.copy.ctaLabel}
              </a>
              <UnitsLeft label={vm.unitsLeftLabel} />
            </div>
          </div>
        </section>

        {facts.length > 0 ? (
          <section
            aria-label="Ficha do empreendimento"
            className="bg-(--lp-secondary) px-4 text-(--lp-on-secondary) @3xl:px-8"
          >
            <dl className="mx-auto grid max-w-6xl grid-cols-2 @3xl:grid-cols-4">
              {facts.map((fact, index) => (
                <div
                  key={fact.label}
                  className={cn(
                    "flex flex-col gap-1 py-5 pe-4 @3xl:border-s @3xl:border-(--lp-secondary-border) @3xl:px-6 @3xl:py-7",
                    index > 1 && "border-t border-(--lp-secondary-border) @3xl:border-t-0",
                    index === 0 && "@3xl:border-s-0 @3xl:ps-0"
                  )}
                >
                  <dt className="text-sm text-(--lp-on-secondary-muted)">{fact.label}</dt>
                  <dd className="text-lg leading-snug font-semibold text-balance">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {vm.description || vm.highlights.length > 0 || vm.financingNote ? (
          <Section labelledBy={id("about-title")}>
            <div className="grid gap-10 @4xl:grid-cols-2 @4xl:gap-16">
              <div className="flex flex-col gap-6">
                <SectionHeading id={id("about-title")} font="serif" title="O empreendimento" />
                {vm.description ? <Paragraphs text={vm.description} /> : null}
                <FinancingNote text={vm.financingNote} />
              </div>
              {vm.highlights.length > 0 ? (
                <div className="flex flex-col gap-5 @4xl:pt-3">
                  <h3 className="text-lg font-semibold">Diferenciais</h3>
                  <HighlightList items={vm.highlights} />
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}

        {showGallery ? (
          <Section tone="alt" labelledBy={id("gallery-title")}>
            <div className="flex flex-col gap-8">
              <SectionHeading id={id("gallery-title")} font="serif" title="Imagens" />
              <Gallery
                images={banners}
                mode={mode}
                label="Galeria de imagens do empreendimento"
                placeholderCount={Math.min(3, vm.template.imageSlots.banners)}
                placeholderLabel="Banner"
              />
            </div>
          </Section>
        ) : null}

        {showTypologies ? (
          <Section labelledBy={id("plans-title")}>
            <div className="flex flex-col gap-8">
              <SectionHeading
                id={id("plans-title")}
                font="serif"
                title="Plantas"
                description="Valores de referência. Peça a tabela com a disponibilidade atual de unidades."
              />
              <TypologyCards
                typologies={vm.launch.typologies}
                formHref={formHref}
                ctaLabel={vm.copy.ctaLabel}
                mode={mode}
              />
            </div>
          </Section>
        ) : null}

        {vm.launch.place ? (
          <Section tone="alt" labelledBy={id("location-title")}>
            <LocationBlock
              headingId={id("location-title")}
              title="Localização"
              place={vm.launch.place}
              font="serif"
            />
          </Section>
        ) : null}

        <Section tone="dark" labelledBy={id("book-title")}>
          <div className="grid gap-10 @4xl:grid-cols-[minmax(0,1fr)_26rem] @4xl:items-center @4xl:gap-16">
            <div className="flex flex-col gap-6">
              <SectionHeading
                id={id("book-title")}
                font="serif"
                tone="dark"
                title="Receba o material completo"
                description={`Plantas, tabela de valores e condições de pagamento${name ? ` do ${name}` : ""}. Um corretor tira suas dúvidas e combina a melhor forma de você conhecer o empreendimento.`}
              />
              <UnitsLeft label={vm.unitsLeftLabel} />
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

      <LandingFooter vm={vm} disclaimer={DISCLAIMERS.launch} />
      <LandingActions
        formHref={formHref}
        ctaLabel={vm.copy.ctaLabel}
        whatsappHref={vm.whatsappHref}
        mode={mode}
      />
    </>
  )
}
