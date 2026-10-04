import { cn } from "@workspace/ui/lib/utils"

import { Countdown } from "../sections/countdown"
import { HighlightList } from "../sections/highlights"
import { LandingActions } from "../sections/landing-actions"
import { LandingFooter } from "../sections/landing-footer"
import { LandingHeader } from "../sections/landing-header"
import { LeadFormPanel } from "../sections/lead-form-panel"
import {
  LandingImage,
  MediaFallback,
  Paragraphs,
  Section,
  SectionHeading,
  lpButtonClass,
  lpDisplayFont,
} from "../sections/primitives"
import { PropertyGrid } from "../sections/property-grid"
import { SocialProof } from "../sections/social-proof"
import { CreciSeal, FinancingNote } from "../sections/trust"
import { DISCLAIMERS, PreviewHint, type LandingTemplateRenderProps } from "./shared"

/**
 * Condição especial — a oferta como um cupom.
 * O hero é um ticket destacável (recorte lateral e picote tracejado) sobre a
 * faixa da marca, com a condição em corpo condensado e o prazo na parte de
 * baixo. Benefícios, prova social e formulário ficam lado a lado em seguida.
 */
export function CampaignOfferTemplate({
  vm,
  mode,
  leadForm,
  id,
  formHref,
}: LandingTemplateRenderProps) {
  const banner = vm.theme.images.banners[0] ?? null
  const hasBenefits = vm.highlights.length > 0 || Boolean(vm.description)

  return (
    <>
      <LandingHeader vm={vm} formHref={formHref} variant="solid" />

      <main>
        <section
          aria-labelledby={id("hero-title")}
          className="grid bg-(--lp-primary) text-(--lp-on-primary) @4xl:min-h-[36rem] @4xl:grid-cols-2"
        >
          <div className="relative h-52 @xl:h-72 @4xl:order-last @4xl:h-auto">
            {banner ? (
              <LandingImage
                src={banner}
                alt=""
                width={1200}
                height={1200}
                priority
                sizes="(min-width: 896px) 50vw, 100vw"
                className="absolute inset-0 size-full"
              />
            ) : (
              <MediaFallback
                className="absolute inset-0 size-full"
                label={mode === "preview" ? "Banner da campanha" : null}
              />
            )}
          </div>

          <div className="flex flex-col justify-center px-4 pb-12 @3xl:px-10 @4xl:py-16">
            <div className="relative mx-auto -mt-16 w-full max-w-xl rounded-[calc(var(--lp-radius)*1.5)] bg-(--lp-surface) text-(--lp-ink) shadow-[0_30px_60px_-30px_rgb(0_0_0/0.55)] @4xl:mt-0">
              <div className="flex flex-col gap-4 p-6 @xl:p-9">
                <h1
                  id={id("hero-title")}
                  className={cn(
                    lpDisplayFont,
                    "text-[2.375rem] leading-none font-extrabold tracking-tight text-balance @xl:text-[3.25rem]"
                  )}
                >
                  {vm.copy.headline}
                </h1>
                <p className="text-lg leading-relaxed text-pretty text-(--lp-ink-muted)">
                  {vm.copy.subheadline}
                </p>
                <FinancingNote text={vm.financingNote} />
              </div>

              <div
                aria-hidden="true"
                className="relative border-t-2 border-dashed border-(--lp-line)"
              >
                <span className="absolute top-1/2 -left-3 size-6 -translate-y-1/2 rounded-full bg-(--lp-primary)" />
                <span className="absolute top-1/2 -right-3 size-6 -translate-y-1/2 rounded-full bg-(--lp-primary)" />
              </div>

              <div className="flex flex-col gap-5 p-6 @xl:p-9">
                {vm.countdownUntil ? (
                  <Countdown
                    until={vm.countdownUntil}
                    caption="Condição válida até"
                    expiredMessage="Esta condição foi encerrada. Fale com a gente para conhecer as ofertas atuais."
                    size="md"
                  />
                ) : null}
                <a
                  href={formHref}
                  className={lpButtonClass({
                    size: "lg",
                    className: "w-full @xl:w-auto @xl:self-start",
                  })}
                >
                  {vm.copy.ctaLabel}
                </a>
              </div>
            </div>
          </div>
        </section>

        <Section labelledBy={hasBenefits ? id("benefits-title") : id("proof-title")}>
          <div className="grid gap-12 @4xl:grid-cols-[minmax(0,1fr)_26rem] @4xl:items-start @4xl:gap-16">
            <div className="flex flex-col gap-14">
              {hasBenefits ? (
                <div className="flex flex-col gap-7">
                  <SectionHeading
                    id={id("benefits-title")}
                    title="O que está incluído na condição"
                  />
                  <HighlightList items={vm.highlights} />
                  {vm.description ? (
                    <div className="flex flex-col gap-2 rounded-(--lp-radius) bg-(--lp-surface-alt) p-5">
                      <h3 className="text-sm font-semibold">Regras da condição</h3>
                      <Paragraphs text={vm.description} className="text-sm text-(--lp-ink-muted)" />
                    </div>
                  ) : null}
                </div>
              ) : (
                <PreviewHint mode={mode}>
                  Adicione os benefícios e as regras da condição no editor.
                </PreviewHint>
              )}

              <SocialProof
                headingId={id("proof-title")}
                title="Quem já aproveitou"
                stats={vm.socialProof}
                testimonials={vm.testimonials}
                layout="column"
              />
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

        {vm.properties.length > 0 || mode === "preview" ? (
          <Section tone="alt" labelledBy={id("properties-title")}>
            <div className="flex flex-col gap-8">
              <SectionHeading
                id={id("properties-title")}
                title="Imóveis participantes"
                description="Escolha um imóvel e peça a simulação com a condição aplicada."
              />
              <PropertyGrid
                properties={vm.properties}
                formHref={formHref}
                mode={mode}
                ctaLabel={vm.copy.ctaLabel}
              />
            </div>
          </Section>
        ) : null}
      </main>

      <LandingFooter vm={vm} disclaimer={DISCLAIMERS.offer} />
      <LandingActions
        formHref={formHref}
        ctaLabel={vm.copy.ctaLabel}
        whatsappHref={vm.whatsappHref}
        mode={mode}
      />
    </>
  )
}
