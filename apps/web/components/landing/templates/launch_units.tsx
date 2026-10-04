import { cn } from "@workspace/ui/lib/utils"

import { HighlightList } from "../sections/highlights"
import { LandingActions } from "../sections/landing-actions"
import { LandingFooter } from "../sections/landing-footer"
import { LandingHeader } from "../sections/landing-header"
import { LeadFormPanel } from "../sections/lead-form-panel"
import {
  LandingImage,
  MediaFallback,
  Section,
  SectionHeading,
  lpButtonClass,
  lpSerifFont,
} from "../sections/primitives"
import { TypologyComparison } from "../sections/typologies"
import { CreciSeal, FinancingNote, UnitsLeft } from "../sections/trust"
import { DISCLAIMERS, launchFacts, type LandingTemplateRenderProps } from "./shared"

/**
 * Tabela de unidades — uma ficha técnica que convida a comparar.
 * As tipologias ficam lado a lado com atributos alinhados linha a linha
 * (área, quartos, valor), cada coluna com "Quero esta planta", que leva a
 * tipologia ao formulário. Hero curto com o nome em destaque e a ficha resumida.
 */
export function LaunchUnitsTemplate({
  vm,
  mode,
  leadForm,
  id,
  formHref,
}: LandingTemplateRenderProps) {
  const name = vm.launch.name
  const banner = vm.theme.images.banners[0] ?? null
  const facts = launchFacts(vm).filter((fact) => fact.label !== "Plantas")
  const unitsId = id("plantas")

  return (
    <>
      <LandingHeader vm={vm} formHref={formHref} variant="solid" />

      <main>
        <section
          aria-labelledby={id("hero-title")}
          className="bg-(--lp-surface-alt) text-(--lp-ink)"
        >
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 @3xl:px-8 @3xl:py-16 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] @4xl:items-center @4xl:gap-14">
            <div className="flex flex-col gap-5">
              {name ? (
                <p
                  className={cn(
                    lpSerifFont,
                    "text-[2rem] leading-tight font-medium @xl:text-[2.75rem]"
                  )}
                >
                  {name}
                </p>
              ) : null}
              <h1
                id={id("hero-title")}
                className="text-[2rem] leading-[1.08] font-semibold tracking-tight text-balance @xl:text-[2.5rem]"
              >
                {vm.copy.headline}
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-pretty text-(--lp-ink-muted)">
                {vm.copy.subheadline}
              </p>

              {facts.length > 0 ? (
                <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-(--lp-line) pt-5">
                  {facts.map((fact) => (
                    <div key={fact.label} className="flex flex-col">
                      <dt className="text-xs text-(--lp-ink-muted)">{fact.label}</dt>
                      <dd className="font-semibold">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <a href={`#${unitsId}`} className={lpButtonClass({ size: "lg" })}>
                  Comparar plantas
                </a>
                <a href={formHref} className={lpButtonClass({ tone: "outline", size: "lg" })}>
                  {vm.copy.ctaLabel}
                </a>
              </div>
              <UnitsLeft label={vm.unitsLeftLabel} />
            </div>

            <div className="relative aspect-4/3 overflow-hidden rounded-(--lp-radius) @4xl:aspect-square">
              {banner ? (
                <LandingImage
                  src={banner}
                  alt={`Imagem ilustrativa${name ? ` do ${name}` : " do empreendimento"}`}
                  width={1200}
                  height={1200}
                  priority
                  sizes="(min-width: 896px) 45vw, 100vw"
                  className="size-full"
                />
              ) : (
                <MediaFallback
                  className="size-full"
                  label={mode === "preview" ? "Banner do empreendimento" : null}
                />
              )}
            </div>
          </div>
        </section>

        <Section id={unitsId} labelledBy={id("units-title")}>
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4 @3xl:flex-row @3xl:items-end @3xl:justify-between @3xl:gap-10">
              <SectionHeading
                id={id("units-title")}
                font="serif"
                title="Compare as plantas"
                description="Valores de referência por tipologia. Escolha uma planta e receba a tabela completa com andar e disponibilidade."
              />
              <FinancingNote text={vm.financingNote} className="@3xl:max-w-xs @3xl:pb-1" />
            </div>
            <TypologyComparison
              typologies={vm.launch.typologies}
              formHref={formHref}
              ctaLabel={vm.copy.ctaLabel}
              label={`Comparação das plantas${name ? ` do ${name}` : ""}`}
              mode={mode}
            />
            {vm.description ? (
              <p className="max-w-[70ch] text-sm leading-relaxed text-(--lp-ink-muted)">
                {vm.description}
              </p>
            ) : null}
          </div>
        </Section>

        <Section
          tone="alt"
          labelledBy={vm.highlights.length > 0 ? id("highlights-title") : undefined}
        >
          {vm.highlights.length > 0 ? (
            <div className="grid gap-10 @4xl:grid-cols-[minmax(0,1fr)_26rem] @4xl:items-start @4xl:gap-16">
              <div className="flex flex-col gap-6">
                <SectionHeading id={id("highlights-title")} font="serif" title="Diferenciais" />
                <HighlightList items={vm.highlights} />
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
          ) : (
            <LeadFormPanel
              id={id("lead-form")}
              title={vm.copy.formTitle}
              description={vm.copy.formDescription}
              size={vm.template.leadFormSize}
              seal={<CreciSeal vm={vm} />}
              className="mx-auto max-w-xl"
            >
              {leadForm}
            </LeadFormPanel>
          )}
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
